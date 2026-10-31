import { context, reddit } from '@devvit/web/server'
import { LEVELS } from '../../client/plungee/levels'

/** Initial playable test post, until user-generated challenge posts are implemented. */
export async function createPost() {
  const subredditName = context.subredditName
  const level = LEVELS[0]
  if (!subredditName || !level) throw new Error('Subreddit or campaign level unavailable')
  return reddit.submitCustomPost({
    subredditName,
    entry: 'default',
    title: `Play Plungee! · ${level.title}`,
    postData: { kind: 'practice', levelKey: level.key },
  })
}
