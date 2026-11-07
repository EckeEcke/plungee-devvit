import { context, redis, reddit, scheduler } from '@devvit/web/server'
import type { JsonObject } from '@devvit/shared-types/json.js'
import { deletedPostKey, retryContentDeletions } from './content-deletion'

const USERS = 'plungee:v1:privacy:users'
const POSTS = 'plungee:v1:privacy:posts'
const JOB = 'plungee:v1:privacy:job'
const DAY = 86400000
const refs = (id: string) => `plungee:v1:user:${id}:privacy-posts`
const missingKey = (id: string) => `plungee:v1:user:${id}:privacy-missing`
const validUser = (id: string) => /^t2_[a-z0-9]+$/i.test(id)
const validPost = (id: string) => /^t3_[a-z0-9]+$/i.test(id)

/** Register before writing identity data. No client-provided identity is accepted here. */
export async function trackPrivacyUser(id: string, postId?: string): Promise<void> {
  if (!validUser(id)) return
  await redis.hSetNX(USERS, id, '1')
  if (postId && validPost(postId)) {
    await redis.hSetNX(POSTS, postId, '1')
    await redis.hSetNX(refs(id), postId, '1')
  }
}

export async function trackPrivacyContext(): Promise<void> {
  if (context.postId) await redis.hSetNX(POSTS, context.postId, '1')
  if (context.userId) await trackPrivacyUser(String(context.userId), context.postId)
}

/** Called by publishers before returning a new user-authored post to the client. */
export async function trackPrivacyPost(postId: string, creatorId?: string): Promise<void> {
  if (!validPost(postId)) return
  if (await redis.get(deletedPostKey(postId))) return
  await redis.hSetNX(POSTS, postId, '1')
  if (creatorId) await trackPrivacyUser(creatorId, postId)
}

/** Discover legacy score/report/player rows even if their author never visits again. */
export async function indexPrivacyPost(postId: string): Promise<void> {
  if (await redis.get(deletedPostKey(postId))) return
  await trackPrivacyPost(postId)
  for (const suffix of ['scores', 'players', 'reports']) {
    const records = await redis.hGetAll(`plungee:v1:post:${postId}:${suffix}`)
    for (const id of Object.keys(records)) await trackPrivacyUser(id, postId)
  }
  const moderation = await redis.get(`plungee:v1:post:${postId}:moderation`)
  if (moderation) {
    const record = JSON.parse(moderation)
    if (typeof record.userId === 'string') await trackPrivacyUser(record.userId, postId)
  }
  const post = await reddit.getPostById(postId as `t3_${string}`)
  const raw = await post.getPostData() as Record<string, unknown> | undefined
  if (typeof raw?.creatorUserId === 'string') await trackPrivacyUser(raw.creatorUserId, postId)
}

/** Remove identifying properties from app-owned postData while preserving the level. */
export function withoutAuthorIdentity(raw: Record<string, unknown>): Record<string, unknown> {
  const result = { ...raw }
  for (const key of ['creatorUserId', 'creatorUsername', 'creatorName', 'creatorAvatarUrl', 'authorId', 'author', 'authorName', 'authorUrl', 'authorFlair', 'avatarUrl', 'profileUrl', 'username', 'userId']) delete result[key]
  return result
}

/** Idempotent: retain the registry entry until every cleanup step has succeeded. */
export async function eraseAccountIdentity(id: string): Promise<void> {
  if (!validUser(id)) throw new Error('Invalid stored user ID.')
  const prefix = `plungee:v1:user:${id}`
  await redis.set(`${prefix}:privacy-erasing`, '1')
  const postIds = new Set(Object.keys(await redis.hGetAll(refs(id))))
  const owned = new Set<string>()
  for (const version of ['v1', 'v2']) {
    for (const suffix of ['scores', 'levels']) {
      const records = await redis.hGetAll(`plungee:${version}:user:${id}:${suffix}`)
      for (const postId of Object.keys(records)) {
        postIds.add(postId)
        if (suffix === 'levels') owned.add(postId)
      }
    }
  }
  for (const suffix of ['community-stats', 'reports', 'comments', 'brag-runs']) {
    for (const postId of Object.keys(await redis.hGetAll(`${prefix}:${suffix}`))) postIds.add(postId)
  }
  const runs = await redis.hGetAll(`${prefix}:community-runs`)
  for (const [runId, postId] of Object.entries(runs)) {
    postIds.add(postId)
    await redis.del(`plungee:v1:community-run:${runId}`)
  }
  for (const postId of postIds) {
    if (!validPost(postId)) continue
    const base = `plungee:v1:post:${postId}`
    for (const suffix of ['scores', 'players', 'reports']) await redis.hDel(`${base}:${suffix}`, [id])
    await redis.zRem(`${base}:leaderboard`, [id])
    const moderation = await redis.get(`${base}:moderation`)
    if (moderation) {
      const record = JSON.parse(moderation)
      if (record.userId === id) { delete record.userId; await redis.set(`${base}:moderation`, JSON.stringify(record)) }
    }
    // PostData is also hosted app storage; removing Redis records alone is insufficient.
    const post = await redis.get(deletedPostKey(postId)) ? null : await reddit.getPostById(postId as `t3_${string}`)
    const raw = await post?.getPostData() as Record<string, unknown> | undefined
    if (raw?.creatorUserId === id) {
      owned.add(postId)
      await post!.setPostData(withoutAuthorIdentity(raw) as JsonObject)
    }
    if (owned.has(postId)) {
      const encoded = await redis.get(`${base}:meta`)
      if (encoded) {
        const meta = JSON.parse(encoded)
        // Community titles and level layouts remain; attribution is no longer identifying.
        await redis.set(`${base}:meta`, JSON.stringify({ ...withoutAuthorIdentity(meta), author: 'Deleted user' }))
      }
    }
    await redis.del(`${prefix}:comment-lock:${postId}`)
  }
  for (const version of ['v1', 'v2']) {
    for (const suffix of ['scores', 'levels']) await redis.del(`plungee:${version}:user:${id}:${suffix}`)
  }
  await redis.del(...['draft', 'comments', 'brag-runs', 'community-stats', 'community-runs', 'reports', 'privacy-posts', 'privacy-missing', 'privacy-erasing'].map(suffix => `${prefix}:${suffix}`))
  await redis.hDel(USERS, [id])
}

/** Undefined can also mean suspended: require additional evidence or a retention fallback. */
export async function checkPrivacyUser(id: string, now = Date.now()): Promise<'kept' | 'pending' | 'erased'> {
  if (await redis.get(`plungee:v1:user:${id}:privacy-erasing`)) {
    await eraseAccountIdentity(id)
    return 'erased'
  }
  let user
  try { user = await reddit.getUserById(id as `t2_${string}`) }
  catch (error) { await redis.del(missingKey(id)); throw error }
  if (user && user.username !== '[deleted]') { await redis.del(missingKey(id)); return 'kept' }
  let deleted = user?.username === '[deleted]'
  if (!deleted) {
    const posts = await redis.hGetAll(refs(id))
    for (const postId of Object.keys(posts)) {
      const post = await reddit.getPostById(postId as `t3_${string}`)
      const raw = await post.getPostData() as Record<string, unknown> | undefined
      // A deleted post can hide the author of a still-active account, so exclude it.
      if (post.removedByCategory !== 'deleted' && post.authorName === '[deleted]' && raw?.creatorUserId === id) { deleted = true; break }
    }
  }
  if (!deleted) {
    const firstMissing = await redis.get(missingKey(id))
    if (!firstMissing || !Number.isFinite(Number(firstMissing)) || Number(firstMissing) > now) {
      await redis.set(missingKey(id), String(now))
      return 'pending'
    }
    // A successful missing response is rechecked daily. Exceptions never advance this path.
    if (now - Number(firstMissing) < 30 * DAY) return 'pending'
  }
  await eraseAccountIdentity(id)
  return 'erased'
}

type JobState = { day: string; phase: 'discover' | 'posts' | 'users' | 'done'; after?: string; cursor: number }

/** Small resumable batches avoid limiting daily coverage to the first users in the registry. */
export async function runDailyPrivacyCleanup(start = true, now = Date.now()): Promise<void> {
  const lock = `${JOB}:lock`
  const token = crypto.randomUUID()
  if (await redis.set(lock, token, { nx: true, expiration: new Date(now + 120000) }) !== 'OK') return
  let more: boolean
  try {
    await retryContentDeletions()
    const encoded = await redis.get(JOB)
    let state = encoded ? JSON.parse(encoded) as JobState : null
    const day = new Date(now).toISOString().slice(0, 10)
    if (!state || (state.phase === 'done' && state.day !== day)) {
      if (!start) return
      state = { day, phase: 'discover', cursor: 0 }
      // Persist before the first API request so recovery can retry initial failures too.
      await redis.set(JOB, JSON.stringify(state))
    }
    if (state.phase === 'done') return
    if (state.phase === 'discover') {
      if (!context.subredditName) throw new Error('Subreddit unavailable.')
      const posts = await reddit.getNewPosts({ subredditName: context.subredditName, limit: 10, ...(state.after ? { after: state.after } : {}) }).all()
      for (const post of posts) {
        if (!post.title.includes('Plungee') && !post.title.startsWith('Can you beat my time?') && !post.title.startsWith('I built this level.')) continue
        try {
          const raw = await post.getPostData() as Record<string, unknown> | undefined
          if (['campaign', 'practice', 'weekly', 'weeklyReplay', 'challenge', 'community', 'editor'].includes(String(raw?.kind))) await indexPrivacyPost(post.id)
        } catch { console.error('Privacy post discovery deferred; existing registry retained.') }
      }
      if (posts.length < 10) {
        for (const entry of await redis.zRange('plungee:v1:community:levels', 0, -1)) await trackPrivacyPost(entry.member)
        state = { day: state.day, phase: 'posts', cursor: 0 }
      } else state.after = posts[posts.length - 1]!.id
    } else if (state.phase === 'posts') {
      const page = await redis.hScan(POSTS, state.cursor, '*', 10)
      for (const entry of page.fieldValues) {
        try { await indexPrivacyPost(entry.field) }
        catch { console.error('Privacy post inventory deferred; post retained for retry.') }
      }
      state = { day: state.day, phase: page.cursor === 0 ? 'users' : 'posts', cursor: page.cursor }
    } else {
      const page = await redis.hScan(USERS, state.cursor, '*', 10)
      for (const entry of page.fieldValues) {
        // One API failure must not abort the scan or erase this user's data.
        try { await checkPrivacyUser(entry.field, now) }
        catch { console.error('Privacy account check deferred; data retained for retry.') }
      }
      state = { day: state.day, phase: page.cursor === 0 ? 'done' : 'users', cursor: page.cursor }
    }
    await redis.set(JOB, JSON.stringify(state))
    more = state.phase !== 'done'
  } finally {
    if (await redis.get(lock) === token) await redis.del(lock)
  }
  if (more) await scheduler.runJob({ name: 'privacy-cleanup-batch', runAt: new Date(Date.now() + 1000) })
}
