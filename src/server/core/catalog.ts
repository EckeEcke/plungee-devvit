import { context, redis, reddit } from '@devvit/web/server'
import type { CommunityLevelMeta } from '../../shared/api'
import type { LevelData } from '../../client/plungee/sim'
import { isCommunityBlocked } from './moderation'

/** Resumable backfill of already-published levels, independent of the author's visits. */
export async function indexCommunityBatch(): Promise<void> {
  if (!context.subredditName) return
  const cursorKey = 'plungee:v2:community:migration'
  const cursor = await redis.get(cursorKey)
  if (cursor === 'done') return
  const posts = await reddit.getNewPosts({ subredditName: context.subredditName, limit: 25, ...(cursor ? { after: cursor } : {}) }).all()
  for (const post of posts) {
    if (await isCommunityBlocked(post.id)) continue
    if (!post.title.startsWith('Plungee Community Level') && !post.title.startsWith('I built this level. Can you beat my time?')) continue
    const raw = await post.getPostData()
    if (raw?.kind !== 'community' || typeof raw.creatorUserId !== 'string') continue
    const key = `plungee:v1:post:${post.id}:level`
    const stored = await redis.get(key)
    if (!stored) continue
    const level = JSON.parse(stored) as LevelData
    const meta: CommunityLevelMeta = { id: post.id, title: level.title ?? post.title, author: post.authorName, size: level.size, createdAt: post.createdAt.getTime() }
    await redis.set(key, stored)
    await redis.set(`plungee:v1:post:${post.id}:meta`, JSON.stringify(meta))
    await redis.zAdd('plungee:v1:community:levels', { member: post.id, score: meta.createdAt })
    await redis.hSet(`plungee:v2:user:${raw.creatorUserId}:levels`, { [post.id]: JSON.stringify({ title: meta.title }) })
  }
  await redis.set(cursorKey, posts.length < 25 ? 'done' : posts[posts.length - 1]!.id)
}
