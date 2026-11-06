import { Hono } from 'hono'
import { context, redis, reddit } from '@devvit/web/server'
import { canModerateLevels, moderationKey, clearCommunityReports, communityReportCount } from '../core/moderation'
import type { CommunityLevelMeta } from '../../shared/api'
import { deleteCommunityStats } from '../core/community-stats'
import { trackPrivacyUser } from '../core/privacy'

export const moderation = new Hono()
moderation.use('*', async (c, next) => {
  c.header('Cache-Control', 'private, no-store')
  try {
    if (!await canModerateLevels()) return c.json({ error: 'Subreddit post-moderation permission required.' }, 403)
  } catch { return c.json({ error: 'Could not verify moderator permissions.' }, 503) }
  await next()
})
moderation.get('/access', c => c.json({ allowed: true }))
moderation.get('/levels', async c => {
  const members = await redis.zRange('plungee:v1:community:levels', 0, -1)
  const levels: (CommunityLevelMeta & { unpublished: boolean })[] = []
  for (const { member } of members.reverse()) {
    const [raw, stored, state] = await Promise.all([
      redis.get(`plungee:v1:post:${member}:meta`), redis.get(`plungee:v1:post:${member}:level`), redis.get(moderationKey(member)),
    ])
    if (raw && stored) levels.push({ ...JSON.parse(raw), unpublished: Boolean(state), reportCount: await communityReportCount(member) })
  }
  const offset = Math.max(0, Math.floor(Number(c.req.query('offset')) || 0))
  return c.json({ levels: levels.slice(offset, offset + 20), total: levels.length })
})
moderation.post('/levels/:postId', async c => {
  const id = c.req.param('postId')
  if (!/^t3_[a-z0-9]+$/.test(id)) return c.json({ error: 'Invalid post ID.' }, 400)
  await trackPrivacyUser(String(context.userId), id)
  let input: { action?: unknown; confirmation?: unknown }
  try { input = await c.req.json() } catch { return c.json({ error: 'Invalid request.' }, 400) }
  if (!['unpublish', 'restore', 'delete'].includes(String(input?.action))) return c.json({ error: 'Unknown action.' }, 400)
  const meta = await redis.get(`plungee:v1:post:${id}:meta`)
  if (!meta) return c.json({ error: 'Community level not found.' }, 404)
  const post = await reddit.getPostById(id as `t3_${string}`)
  const raw = await post.getPostData()
  if (post.subredditName.toLowerCase() !== context.subredditName?.toLowerCase() || raw?.kind !== 'community') return c.json({ error: 'Not a community level in this subreddit.' }, 403)
  const key = moderationKey(id)
  if (input.action === 'restore') {
    if (!await redis.get(`plungee:v1:post:${id}:level`)) return c.json({ error: 'Level data no longer exists.' }, 409)
    await redis.del(key)
    await clearCommunityReports(id)
  } else if (input.action === 'unpublish') {
    await redis.set(key, JSON.stringify({ action: 'unpublish', userId: String(context.userId), at: Date.now() }))
  } else {
    if (input.confirmation !== id || !await redis.get(key)) return c.json({ error: 'Unpublish the level and confirm its deletion first.' }, 409)
    // Keep a block marker while deleting so in-flight index requests cannot republish it.
    await redis.set(key, JSON.stringify({ action: 'delete', userId: String(context.userId), at: Date.now() }))
    await deleteCommunityStats(id)
    const scores = await redis.hGetAll(`plungee:v1:post:${id}:scores`)
    for (const userId of Object.keys(scores)) {
      await redis.hDel(`plungee:v1:user:${userId}:scores`, [id])
      await redis.hDel(`plungee:v2:user:${userId}:scores`, [id])
      await redis.hDel(`plungee:v1:user:${userId}:brag-runs`, [id])
    }
    if (typeof raw.creatorUserId === 'string') {
      await redis.hDel(`plungee:v1:user:${raw.creatorUserId}:levels`, [id])
      await redis.hDel(`plungee:v2:user:${raw.creatorUserId}:levels`, [id])
    }
    await redis.del(`plungee:v1:post:${id}:level`, `plungee:v1:post:${id}:meta`, `plungee:v1:post:${id}:scores`, `plungee:v1:post:${id}:leaderboard`)
    await redis.zRem('plungee:v1:community:levels', [id])
    await redis.expire(key, 90 * 86400)
  }
  return c.json({ done: true })
})
