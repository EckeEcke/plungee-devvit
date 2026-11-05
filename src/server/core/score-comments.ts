import { reddit } from '@devvit/web/server'
import type { T1, T3 } from '@devvit/shared-types/tid.js'

/** Visible copy for the one sticky time-reply thread. */
const SCORE_THREAD_TEXT = 'Times\nReply with your time.'
/** Legacy marker used to recognize threads created before the copy was revised. */
const LEGACY_SCORE_THREAD_MARKER = '[plungee-score-thread]'

/**
 * Return the one sticky score thread for a post, creating it when an older
 * Plungee post does not have one yet. Score text is always posted as the
 * authenticated user in reply to this comment.
 */
export async function ensureScoreThread(postId: string): Promise<T1> {
  const typedPostId = postId as T3
  const topLevel = await reddit.getComments({ postId: typedPostId, limit: 100, sort: 'new' }).all()
  const sticky = topLevel.filter(comment => comment.parentId === typedPostId && comment.stickied)
  const existing = sticky.find(comment => comment.body.includes(LEGACY_SCORE_THREAD_MARKER) || comment.body.trim() === SCORE_THREAD_TEXT)
  if (existing) {
    if (existing.body.includes(LEGACY_SCORE_THREAD_MARKER)) await existing.edit({ text: SCORE_THREAD_TEXT })
    return existing.id
  }
  if (sticky.length > 0) {
    throw new Error('This post already has a different sticky comment; score posting is unavailable.')
  }

  const thread = await reddit.submitComment({ id: typedPostId, runAs: 'APP', text: SCORE_THREAD_TEXT })
  await thread.distinguish(true)
  return thread.id
}
