import { context, reddit, redis } from '@devvit/web/server'
import { MEMPHIS_DARK } from '../../client/plungee/game/theme'
import { flairForPost, matchingFlair } from './flair-policy'

/** Reuse the community's styles; only missing templates get Plungee theme colors. */
export async function postFlair(kind: string): Promise<{ flairId?: string }> {
  const name = flairForPost(kind)
  if (!name) return {}
  const subredditName = context.subredditName
  if (!subredditName) throw new Error('Subreddit unavailable for post flair.')
  const key = `plungee:v1:flair-lock:${name}`
  for (let attempt = 0; attempt < 5; attempt++) {
    const found = matchingFlair(await reddit.getPostFlairTemplates(subredditName), name)
    if (found) return { flairId: found.id }
    const acquired = await redis.set(key, 'creating', { nx: true, expiration: new Date(Date.now() + 60000) })
    if (acquired !== 'OK') { await new Promise(resolve => setTimeout(resolve, 100)); continue }
    try {
      const existing = matchingFlair(await reddit.getPostFlairTemplates(subredditName), name)
      if (existing) return { flairId: existing.id }
      const template = await reddit.createPostFlairTemplate({
        subredditName, text: name, textColor: 'dark', modOnly: false, allowUserEdits: false,
        backgroundColor: name === 'Weekly' ? MEMPHIS_DARK.ui.accent : name === 'Challenge' ? MEMPHIS_DARK.decor[0]! : MEMPHIS_DARK.ui.highlight,
      })
      return { flairId: template.id }
    } finally { await redis.del(key) }
  }
  throw new Error('Post flair is being prepared. Please try again.')
}
