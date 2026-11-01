import { Hono } from 'hono'
import type { UiResponse } from '@devvit/web/shared'
import { context } from '@devvit/web/server'
import { createPost } from '../core/post'
import { ensureCurrentWeeklyChallenge } from '../core/weekly'

export const menu = new Hono()
menu.post('/post-create', async (c) => {
  try {
    const post = await createPost()
    return c.json<UiResponse>({ navigateTo: `https://www.reddit.com/r/${context.subredditName}/comments/${post.id.replace(/^t3_/, '')}` })
  } catch (error) {
    console.error('Failed to create Plungee post:', error)
    return c.json<UiResponse>({ showToast: 'Failed to create Plungee post' }, 400)
  }
})

menu.post('/weekly-create', async (c) => {
  try {
    const post = await ensureCurrentWeeklyChallenge()
    return c.json<UiResponse>({ navigateTo: `https://www.reddit.com/r/${context.subredditName}/comments/${post.postId.replace(/^t3_/, '')}` })
  } catch (error) {
    console.error('Failed to create weekly Plungee post:', error)
    return c.json<UiResponse>({ showToast: 'Failed to create weekly Plungee post' }, 400)
  }
})
