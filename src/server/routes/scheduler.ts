import { Hono } from 'hono'
import type { TaskRequest, TaskResponse } from '@devvit/scheduler'
import { ensureCurrentWeeklyChallenge } from '../core/weekly'
import { indexCommunityBatch } from '../core/catalog'
import { ensureWeeklyCampaignPost } from '../core/campaign'

export const scheduler = new Hono()
scheduler.post('/campaign', async c => {
  try {
    const postId = await ensureWeeklyCampaignPost()
    console.log(`Weekly campaign post is ready: ${postId}`)
    return c.json<TaskResponse>({})
  } catch (error) {
    console.error('Could not create weekly campaign post:', error)
    return c.json<TaskResponse>({}, 500)
  }
})
scheduler.post('/community-index', async c => {
  await indexCommunityBatch()
  return c.json({})
})
scheduler.post('/weekly', async (c) => {
  try {
    const request = await c.req.json<TaskRequest>()
    const challenge = await ensureCurrentWeeklyChallenge()
    console.log(`Weekly challenge ${request.name} is ready: ${challenge.postId}`)
    return c.json<TaskResponse>({})
  } catch (error) {
    console.error('Could not create weekly challenge:', error)
    return c.json<TaskResponse>({}, 500)
  }
})
