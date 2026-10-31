import { Hono } from 'hono'
import type { OnAppInstallRequest, TriggerResponse } from '@devvit/web/shared'
import { context } from '@devvit/web/server'
import { createPost } from '../core/post'

export const triggers = new Hono()
triggers.post('/on-app-install', async (c) => {
  try {
    const input = await c.req.json<OnAppInstallRequest>()
    const post = await createPost()
    return c.json<TriggerResponse>({ status: 'success', message: `Created Plungee test post ${post.id} in ${context.subredditName} (${input.type})` })
  } catch (error) {
    console.error('Could not create initial Plungee post:', error)
    return c.json<TriggerResponse>({ status: 'error', message: 'Failed to create initial Plungee post' }, 400)
  }
})
