import { context, redis, reddit } from '@devvit/web/server'
import { createCampaignPost } from './post'
import { currentWeeklyWindow } from './weekly-policy'

/** One scheduled campaign post per UTC week, including retried scheduler deliveries. */
export async function ensureWeeklyCampaignPost(): Promise<string> {
  const { weekId } = currentWeeklyWindow()
  const key = `plungee:v1:campaign-week:${weekId}`
  const existing = await redis.get(key)
  if (existing) return existing
  const lock = `${key}:publishing`
  if (await redis.set(lock, 'publishing', { nx: true, expiration: new Date(Date.now() + 120000) }) !== 'OK') {
    throw new Error('Campaign post is already being prepared.')
  }
  try {
    const saved = await redis.get(key)
    if (saved) return saved
    if (!context.subredditName) throw new Error('Subreddit unavailable.')
    // Recover a submitted post if saving its ID failed on an earlier delivery.
    const recent = await reddit.getNewPosts({ subredditName: context.subredditName, limit: 100 }).all()
    let postId: string | undefined
    for (const post of recent) {
      if (post.removed || post.spam || post.title !== 'Plungee · Play the Campaign') continue
      const data = await post.getPostData() as Record<string, unknown> | undefined
      if (data?.kind === 'campaign' && data.campaignWeekId === weekId) { postId = post.id; break }
    }
    postId ??= (await createCampaignPost(weekId)).id
    await redis.set(key, postId, { expiration: new Date(Date.now() + 90 * 86400000) })
    return postId
  } finally {
    await redis.del(lock)
  }
}
