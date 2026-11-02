import { Hono } from 'hono'
import { context, redis } from '@devvit/web/server'
import { deleteOwnScores } from '../core/scores'
import { deleteOwnCommunityStats, deleteCommunityStats } from '../core/community-stats'

export const data = new Hono()
data.delete('/my-data', async c => {
  if (!context.userId) return c.json({ error: 'Sign in required.' }, 401)
  const id = String(context.userId)
  await deleteOwnScores()
  await deleteOwnCommunityStats()
  const oldIndex = `plungee:v1:user:${id}:levels`
  const newIndex = `plungee:v2:user:${id}:levels`
  const levels = { ...await redis.hGetAll(oldIndex), ...await redis.hGetAll(newIndex) }
  for (const postId of Object.keys(levels)) {
    await deleteCommunityStats(postId)
    await redis.del(`plungee:v1:post:${postId}:level`, `plungee:v1:post:${postId}:meta`)
    await redis.zRem('plungee:v1:community:levels', [postId])
  }
  await redis.del(oldIndex, newIndex, `plungee:v1:user:${id}:draft`, `plungee:v1:user:${id}:comments`, `plungee:v1:user:${id}:brag-runs`)
  return c.json({ deleted: true })
})
