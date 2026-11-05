import { reddit } from '@devvit/web/server'
import type { T1, T3 } from '@devvit/shared-types/tid.js'

/** Stable marker used to identify Plungee's one score-reply thread. */
const SCORE_THREAD_MARKER = '[plungee-score-thread]'

/**
 * Return the one sticky score thread for a post, creating it when an older
 * Plungee post does not have one yet. Score text is always posted as the
 * authenticated user in reply to this comment.
 */
export async function ensureScoreThread(postId: string): Promise<T1> {
  const typedPostId = postId as T3
  const topLevel = await reddit.getComments({ postId: typedPostId, limit: 100, sort: 'new' }).all()
  const sticky = topLevel.filter(comment => comment.parentId === typedPostId && comment.stickied)
  const existing = sticky.find(comment => comment.body.includes(SCORE_THREAD_MARKER))
  if (existing) return existing.id
  if (sticky.length > 0) {
    throw new Error('This post already has a different sticky comment; score posting is unavailable.')
  }

  const thread = await reddit.submitComment({
    id: typedPostId,
    runAs: 'APP',
    text: `${SCORE_THREAD_MARKER}\n🏁 Verified Plungee results — reply here to share your score.`,
  })
  await thread.distinguish(true)
  return thread.id
}
