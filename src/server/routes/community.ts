import { Hono } from 'hono'
import { context, redis, reddit } from '@devvit/web/server'
import { compileLevel, decodeInputs, simulate, validateLevel, LEVEL_ROWS, LEVEL_COLS, TICK_RATE, type LevelData } from '../../client/plungee/sim'
import { levelHash } from '../../client/plungee/editor/hash'
import type { CommunityLevelMeta } from '../../shared/api'
import { indexCommunityBatch } from '../core/catalog'
import { isCommunityBlocked } from '../core/moderation'
import { hasControlCharacters } from '../../shared/text'

export const community = new Hono()
const TTL = 90 * 86400
const draftKey = () => `plungee:v1:user:${context.userId}:draft`
const communityIndex = 'plungee:v1:community:levels'
const metaKey = (postId: string) => `plungee:v1:post:${postId}:meta`

community.get('/community', async c => {
  await indexCommunityBatch()
  // Backfill this user's posts published before the shared catalogue existed.
  if (context.userId) {
    const own = await redis.hGetAll(`plungee:v1:user:${context.userId}:levels`)
    for (const postId of Object.keys(own)) {
      if (await isCommunityBlocked(postId)) continue
      if (await redis.get(metaKey(postId))) continue
      const stored = await redis.get(`plungee:v1:post:${postId}:level`)
      if (!stored) continue
      try {
        const post = await reddit.getPostById(postId as `t3_${string}`)
        const level = JSON.parse(stored) as LevelData
        const meta: CommunityLevelMeta = { id: postId, title: level.title ?? post.title, author: post.authorName, size: level.size, createdAt: post.createdAt.getTime() }
        await redis.set(metaKey(postId), JSON.stringify(meta))
        await redis.set(`plungee:v1:post:${postId}:level`, stored)
        await redis.hSet(`plungee:v2:user:${context.userId}:levels`, { [postId]: own[postId]! })
        await redis.zAdd(communityIndex, { member: postId, score: meta.createdAt })
      } catch (error) { console.error('Could not index existing community post', postId, error) }
    }
  }
  const offset = Math.max(0, Math.floor(Number(c.req.query('offset')) || 0))
  const limit = 20
  const members = await redis.zRange(communityIndex, 0, -1)
  const levels: CommunityLevelMeta[] = []
  for (const entry of members.reverse()) {
    if (await isCommunityBlocked(entry.member)) continue
    const [meta, level] = await Promise.all([
      redis.get(metaKey(entry.member)), redis.get(`plungee:v1:post:${entry.member}:level`),
    ])
    if (!meta || !level) {
      await redis.zRem(communityIndex, [entry.member])
      continue
    }
    levels.push(JSON.parse(meta) as CommunityLevelMeta)
  }
  return c.json({ levels: levels.slice(offset, offset + limit), total: levels.length })
})

community.get('/editor/draft', async c => {
  if (!context.userId) return c.json({ error: 'Sign in to use the editor.' }, 401)
  const value = await redis.get(draftKey())
  return c.json(value ? JSON.parse(value) : null)
})
community.put('/editor/draft', async c => {
  if (!context.userId) return c.json({ error: 'Sign in to save drafts.' }, 401)
  const text = await c.req.text()
  if (text.length > 200000) return c.json({ error: 'Draft too large.' }, 413)
  try {
    const value = JSON.parse(text)
    if (!value?.level || value.level.v !== 1 || !Object.hasOwn(LEVEL_ROWS, value.level.size) || !Array.isArray(value.level.tiles) || !Array.isArray(value.level.entities)) throw new Error()
    if (value.level.tiles.length !== LEVEL_ROWS[value.level.size as keyof typeof LEVEL_ROWS] || value.level.tiles.some((row: unknown) => typeof row !== 'string' || row.length !== LEVEL_COLS)) throw new Error()
    await redis.set(draftKey(), text)
    await redis.expire(draftKey(), TTL)
    return c.json({ saved: true })
  } catch { return c.json({ error: 'Invalid draft.' }, 400) }
})
community.delete('/editor/draft', async c => {
  if (!context.userId) return c.json({ error: 'Sign in required.' }, 401)
  await redis.del(draftKey())
  return c.json({ deleted: true })
})
community.post('/community', async c => {
  if (!context.userId || !context.subredditName) return c.json({ error: 'Sign in to publish a Reddit level.' }, 401)
  const text = await c.req.text()
  if (text.length > 200000) return c.json({ error: 'Level too large.' }, 413)
  try {
    const value = JSON.parse(text) as { title: string; level: LevelData; replay: string }
    if (typeof value.title !== 'string' || value.title.trim().length < 3 || value.title.trim().length > 32 || hasControlCharacters(value.title)) throw new Error('Invalid title.')
    if (!value.level || typeof value.replay !== 'string' || value.replay.length > 120000) throw new Error('Invalid level or replay.')
    value.level.title = value.title.trim()
    if (validateLevel(value.level).length) throw new Error('Invalid level.')
    const result = simulate(compileLevel(value.level), decodeInputs(value.replay))
    if (!result.finished) throw new Error('Complete your level before publishing.')
    const time = (Math.floor(result.ticks * 100 / TICK_RATE) / 100).toFixed(2)
    const deaths = result.deaths === 0 ? 'without dying' : `with ${result.deaths} ${result.deaths === 1 ? 'death' : 'deaths'}`
    const postText = `I made this Plungee level and finished it in ${time} s ${deaths}. Think you can do better? Give it a try!`
    const levelKey = `community:${levelHash(value.level)}`
    const closesAt = Date.now() + 7 * 86400000
    const post = await reddit.submitCustomPost({
      subredditName: context.subredditName, entry: 'default', runAs: 'USER',
      title: `I built this level. Can you beat my time? · ${value.title.trim()}`,
      userGeneratedContent: { text: postText },
      textFallback: { text: postText },
      postData: { kind: 'community', levelKey, closesAt, creatorUserId: String(context.userId) },
    })
    // The creator test proves solvability and supplies the post copy only.
    // Do not record a score here; regular play uses /api/verify for every user.
    const key = `plungee:v1:post:${post.id}:level`
    await redis.set(key, JSON.stringify(value.level))
    const userKey = `plungee:v2:user:${context.userId}:levels`
    await redis.hSet(userKey, { [post.id]: JSON.stringify({ levelKey, title: value.title.trim() }) })
    const meta: CommunityLevelMeta = {
      id: post.id, title: value.title.trim(), author: context.username ?? 'Deleted user',
      size: value.level.size, createdAt: Date.now(),
    }
    await redis.set(metaKey(post.id), JSON.stringify(meta))
    await redis.zAdd(communityIndex, { member: post.id, score: meta.createdAt })
    return c.json({ postId: post.id })
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Could not publish level.' }, 400)
  }
})

/** Removes this user's stored community-level data; never deletes their Reddit posts. */
community.delete('/community/mine', async c => {
  if (!context.userId) return c.json({ error: 'Sign in required.' }, 401)
  const userKey = `plungee:v2:user:${context.userId}:levels`
  const legacyKey = `plungee:v1:user:${context.userId}:levels`
  const levels = { ...await redis.hGetAll(legacyKey), ...await redis.hGetAll(userKey) }
  for (const postId of Object.keys(levels)) {
    await redis.del(`plungee:v1:post:${postId}:level`)
    await redis.del(metaKey(postId))
    await redis.zRem(communityIndex, [postId])
  }
  await redis.del(userKey, legacyKey)
  return c.json({ deleted: true })
})
