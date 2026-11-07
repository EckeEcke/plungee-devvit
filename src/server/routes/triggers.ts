import { Hono } from 'hono'
import type { OnAppInstallRequest, OnPostDeleteRequest, OnCommentDeleteRequest, TriggerResponse } from '@devvit/web/shared'
import { context } from '@devvit/web/server'
import { createCampaignPost } from '../core/post'
import { ensureCurrentWeeklyChallenge } from '../core/weekly'
import { deletePostContent, deleteCommentContent } from '../core/content-deletion'

export const triggers = new Hono()
triggers.post('/on-post-delete', async c => {
  const input = await c.req.json<OnPostDeleteRequest>()
  await deletePostContent(input.postId, input.author?.id)
  return c.json<TriggerResponse>({ status: 'success' })
})
triggers.post('/on-comment-delete', async c => {
  const input = await c.req.json<OnCommentDeleteRequest>()
  await deleteCommentContent(input.commentId, input.postId, input.author?.id)
  return c.json<TriggerResponse>({ status: 'success' })
})
triggers.post('/on-app-install', async (c) => {
  try {
    const input = await c.req.json<OnAppInstallRequest>()
    const post = await createCampaignPost()
    const weekly = await ensureCurrentWeeklyChallenge()
    return c.json<TriggerResponse>({ status: 'success', message: `Created Plungee campaign post ${post.id} and weekly post ${weekly.postId} in ${context.subredditName} (${input.type})` })
  } catch (error) {
    console.error('Could not create initial Plungee post:', error)
    return c.json<TriggerResponse>({ status: 'error', message: 'Failed to create initial Plungee post' }, 400)
  }
})
