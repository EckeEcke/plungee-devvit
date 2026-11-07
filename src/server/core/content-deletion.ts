import { redis, reddit } from '@devvit/web/server'
import { deleteCommunityStats } from './community-stats'

const QUEUE = 'plungee:v1:content-deletions'
const USERS = 'plungee:v1:privacy:users'
const validPost = (id: string) => /^t3_[a-z0-9]+$/.test(id)
export const deletedPostKey = (postId: string) => `plungee:v1:post:${postId}:deleted`

async function knownUsers(authorId?: string): Promise<string[]> {
  const users = new Set(Object.keys(await redis.hGetAll(USERS)))
  if (authorId && /^t2_[a-z0-9]+$/.test(authorId)) {
    await redis.hSetNX(USERS, authorId, '1')
    users.add(authorId)
  }
  return [...users]
}

/** Keep only a content-free tombstone so old posts cannot be reindexed or played. */
export async function deletePostContent(postId: string, authorId?: string): Promise<void> {
  if (!validPost(postId)) throw new Error('Invalid deleted post ID.')
  const tracked = await redis.hGet('plungee:v1:privacy:posts', postId)
  const stored = await redis.get(`plungee:v1:post:${postId}:level`)
  const scores = await redis.hGetAll(`plungee:v1:post:${postId}:scores`)
  let appPost = Boolean(tracked || stored || Object.keys(scores).length || await redis.get(deletedPostKey(postId)))
  if (!appPost) {
    try {
      const raw = await (await reddit.getPostById(postId as `t3_${string}`)).getPostData()
      appPost = ['campaign', 'practice', 'weekly', 'weeklyReplay', 'community', 'challenge', 'editor'].includes(String(raw?.kind))
    } catch (error) {
      if (!(error instanceof Error) || !/404 Not Found/.test(error.message)) throw error
    }
  }
  if (!appPost) return
  await redis.hSet(QUEUE, { [postId]: postId })
  await redis.set(deletedPostKey(postId), '1')
  const base = `plungee:v1:post:${postId}`
  const users = new Set(await knownUsers(authorId))
  for (const suffix of ['scores', 'players', 'reports']) {
    for (const id of Object.keys(await redis.hGetAll(`${base}:${suffix}`))) users.add(id)
  }
  // Delete live run payloads before their indexes disappear.
  await deleteCommunityStats(postId)
  for (const userId of users) {
    if (!/^t2_[a-z0-9]+$/.test(userId)) continue
    for (const version of ['v1', 'v2']) {
      for (const suffix of ['scores', 'levels']) await redis.hDel(`plungee:${version}:user:${userId}:${suffix}`, [postId])
    }
    const prefix = `plungee:v1:user:${userId}`
    for (const suffix of ['comments', 'brag-runs', 'reports', 'community-stats', 'privacy-posts']) await redis.hDel(`${prefix}:${suffix}`, [postId])
    for (const [runId, target] of Object.entries(await redis.hGetAll(`${prefix}:community-runs`))) {
      if (target !== postId) continue
      await redis.del(`plungee:v1:community-run:${runId}`)
      await redis.hDel(`${prefix}:community-runs`, [runId])
    }
    await redis.del(`${prefix}:comment-lock:${postId}`)
  }
  await redis.del(...['level', 'meta', 'scores', 'leaderboard', 'players', 'reports', 'moderation'].map(suffix => `${base}:${suffix}`))
  await redis.zRem('plungee:v1:community:levels', [postId])
  await redis.hDel('plungee:v1:privacy:posts', [postId])
  // The Reddit deletion already removes Reddit content; clear our custom app data too.
  try {
    const post = await reddit.getPostById(postId as `t3_${string}`)
    await post.setPostData({})
  } catch (error) {
    // A confirmed missing post cannot be accessed to update its custom data.
    if (!(error instanceof Error) || !/404 Not Found/.test(error.message)) throw error
  }
  await redis.hDel(QUEUE, [postId])
}

/** Comment bodies are not cached; delete only the matching stored posting reference. */
export async function deleteCommentContent(commentId: string, postId: string, authorId?: string): Promise<void> {
  if (!/^t1_[a-z0-9]+$/.test(commentId) || !validPost(postId)) throw new Error('Invalid deleted comment ID.')
  if (!await redis.hGet('plungee:v1:privacy:posts', postId) &&
      !(authorId && await redis.hGet(`plungee:v1:user:${authorId}:comments`, postId) === commentId)) return
  await redis.hSet(QUEUE, { [commentId]: postId })
  for (const id of await knownUsers(authorId)) {
    const key = `plungee:v1:user:${id}:comments`
    if (await redis.hGet(key, postId) === commentId) await redis.hDel(key, [postId])
  }
  await redis.hDel(QUEUE, [commentId])
}

export async function retryContentDeletions(): Promise<void> {
  const page = await redis.hScan(QUEUE, 0, '*', 10)
  for (const entry of page.fieldValues) {
    try {
      if (entry.field.startsWith('t3_')) await deletePostContent(entry.field)
      else await deleteCommentContent(entry.field, entry.value)
    } catch { console.error('Deleted-content cleanup deferred for retry.') }
  }
}
