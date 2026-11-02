import { context, reddit, redis } from '@devvit/web/server'
import { hasLevelModerationPermission } from './moderation-policy'

export const moderationKey = (postId: string) => `plungee:v1:post:${postId}:moderation`

/** Check the moderator relationship in THIS subreddit, not global moderator status. */
export async function canModerateLevels(): Promise<boolean> {
  if (!context.userId || !context.username || !context.subredditName) return false
  const moderators = await reddit.getModerators({ subredditName: context.subredditName, username: context.username }).all()
  return hasLevelModerationPermission(String(context.userId), moderators)
}

export async function isCommunityBlocked(postId: string): Promise<boolean> {
  return Boolean(await redis.get(moderationKey(postId)))
}
