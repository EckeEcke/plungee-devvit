import { context, reddit, redis } from '@devvit/web/server'
import { hasLevelModerationPermission } from './moderation-policy'

export const moderationKey = (postId: string) => `plungee:v1:post:${postId}:moderation`
const reportKey = (postId: string) => `plungee:v1:post:${postId}:reports`
const userReportKey = (userId: string) => `plungee:v1:user:${userId}:reports`
const REPORT_THRESHOLD = 10

export async function reportCommunityLevel(postId: string, userId: string): Promise<{ reported: boolean; count: number; hidden: boolean }> {
  const added = await redis.hSetNX(reportKey(postId), userId, String(Date.now()))
  if (added) await redis.hSet(userReportKey(userId), { [postId]: String(Date.now()) })
  const count = await redis.hLen(reportKey(postId))
  const hidden = Boolean(await redis.get(moderationKey(postId))) || count >= REPORT_THRESHOLD
  if (count >= REPORT_THRESHOLD && !await redis.get(moderationKey(postId))) {
    await redis.set(moderationKey(postId), JSON.stringify({ action: 'reported', reportCount: count, at: Date.now() }))
  }
  return { reported: added === 1, count, hidden }
}

export async function deleteOwnCommunityReports(userId: string): Promise<void> {
  const reports = await redis.hGetAll(userReportKey(userId))
  for (const postId of Object.keys(reports)) await redis.hDel(reportKey(postId), [userId])
  await redis.del(userReportKey(userId))
}

export async function clearCommunityReports(postId: string): Promise<void> {
  const reports = await redis.hGetAll(reportKey(postId))
  for (const userId of Object.keys(reports)) await redis.hDel(userReportKey(userId), [postId])
  await redis.del(reportKey(postId))
}

export async function communityReportCount(postId: string): Promise<number> {
  return redis.hLen(reportKey(postId))
}

/** Check the moderator relationship in THIS subreddit, not global moderator status. */
export async function canModerateLevels(): Promise<boolean> {
  if (!context.userId || !context.username || !context.subredditName) return false
  const moderators = await reddit.getModerators({ subredditName: context.subredditName, username: context.username }).all()
  return hasLevelModerationPermission(String(context.userId), moderators)
}

export async function isCommunityBlocked(postId: string): Promise<boolean> {
  return Boolean(await redis.get(moderationKey(postId)))
}
