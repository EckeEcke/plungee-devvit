import { context, reddit } from '@devvit/web/server'
import { LEVELS, LEVELS_BY_DIFFICULTY } from '../../client/plungee/levels'
import { formatTicks } from '../../client/plungee/sim'
import type { StoredScore } from './scores'

/** Permanent campaign entry post, starting with the first Easy level. */
export async function createCampaignPost() {
  const subredditName = context.subredditName
  const level = LEVELS_BY_DIFFICULTY.easy[0]
  if (!subredditName || !level) throw new Error('Subreddit or campaign level unavailable')
  return reddit.submitCustomPost({
    subredditName,
    entry: 'default',
    title: 'Plungee · Play the Campaign',
    textFallback: { text: 'Play the Plungee campaign, starting with the first level. Earn medals and improve your times.' },
    postData: { kind: 'campaign', levelKey: level.key },
  })
}

const CHALLENGE_DURATION_MS = 7 * 24 * 60 * 60 * 1000

/** Creates a challenge only after an explicit user action from the expanded game. */
export async function createChallengePost(levelKey: string, sourcePostId: string, personalBest: StoredScore) {
  const subredditName = context.subredditName
  const level = LEVELS.find(candidate => candidate.key === levelKey)
  if (!subredditName || !context.userId || !level) throw new Error('Challenge level or Reddit user unavailable')

  const createdAt = Date.now()
  const closesAt = createdAt + CHALLENGE_DURATION_MS
  const challengeText = `Can you beat my time of ${formatTicks(personalBest.ticks)} on ${level.title}?`
  return reddit.submitCustomPost({
    subredditName,
    entry: 'default',
    runAs: 'USER',
    userGeneratedContent: {
      text: challengeText,
    },
    // Devvit requires a Reddit fallback body for user-authored experience posts.
    textFallback: {
      text: `${challengeText}\n\nPlay Plungee and try to beat the creator's verified time.`,
    },
    title: `Can you beat my time? · ${level.title}`,
    postData: {
      kind: 'challenge',
      levelKey: level.key,
      sourcePostId,
      closesAt,
      creatorUserId: String(context.userId),
      creatorBestTicks: personalBest.ticks,
    },
  })
}

export function weeklyLevelFor(weekId: string) {
  let hash = 2166136261
  for (let i = 0; i < weekId.length; i++) {
    hash ^= weekId.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return LEVELS[(hash >>> 0) % LEVELS.length]!
}

/** Creates the app-owned weekly challenge post for the current UTC week. */
export async function createWeeklyPost(weekId: string, startsAt: number, closesAt: number) {
  const subredditName = context.subredditName
  const level = weeklyLevelFor(weekId)
  if (!subredditName || !level) throw new Error('Subreddit or weekly level unavailable')

  return reddit.submitCustomPost({
    subredditName,
    entry: 'default',
    title: `Plungee Weekly Challenge · ${level.title}`,
    textFallback: {
      text: `Plungee Weekly Challenge\n\nCan you set the fastest verified time on ${level.title}?\nThis challenge runs until ${new Date(closesAt).toISOString()}.`,
    },
    postData: { kind: 'weekly', weekId, levelKey: level.key, startsAt, closesAt },
  })
}
