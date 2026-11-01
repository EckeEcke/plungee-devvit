import { Hono } from 'hono'
import type { TaskRequest, TaskResponse } from '@devvit/scheduler'
import { ensureCurrentWeeklyChallenge } from '../core/weekly'
import { indexCommunityBatch } from '../core/catalog'

export const scheduler = new Hono()
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
