import { Hono } from 'hono'
import type { UiResponse } from '@devvit/web/shared'
import { context, reddit } from '@devvit/web/server'
import { canModerateLevels } from '../core/moderation'
import { createCampaignPost } from '../core/post'
import { ensureCurrentWeeklyChallenge } from '../core/weekly'

export const menu = new Hono()
menu.post('/editor-create', async c => {
  try {
    if (!context.subredditName || !await canModerateLevels()) return c.json<UiResponse>({ showToast: 'Subreddit post-moderation permission required.' }, 403)
    const post = await reddit.submitCustomPost({
      subredditName: context.subredditName,
      entry: 'default',
      title: 'Plungee · Build a level',
      textFallback: { text: 'Build your own Plungee level, test it and share it with the community.' },
      postData: { kind: 'editor' },
    })
    return c.json<UiResponse>({ navigateTo: `https://www.reddit.com/r/${context.subredditName}/comments/${post.id.replace(/^t3_/, '')}` })
  } catch (error) {
    console.error('Failed to create editor post:', error)
    return c.json<UiResponse>({ showToast: 'Failed to create editor post' }, 400)
  }
})
menu.post('/campaign-create', async (c) => {
  try {
    const post = await createCampaignPost()
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
