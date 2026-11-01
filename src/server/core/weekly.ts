import { context, redis } from '@devvit/web/server'
import { LEVELS } from '../../client/plungee/levels'
import { createWeeklyPost, weeklyLevelFor } from './post'

const WEEKLY_VERSION = 'v1'
const WEEK_MS = 7 * 24 * 60 * 60 * 1000

export type WeeklyChallenge = { weekId: string; levelKey: string; startsAt: number; closesAt: number; postId: string }

function metadataKey(weekId: string): string { return `plungee:${WEEKLY_VERSION}:weekly:${weekId}` }

export function currentWeeklyWindow(now = new Date()) {
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const day = monday.getUTCDay() || 7
  monday.setUTCDate(monday.getUTCDate() - day + 1)
  const weekId = monday.toISOString().slice(0, 10)
  const startsAt = monday.getTime()
  return { weekId, startsAt, closesAt: startsAt + WEEK_MS }
}

export async function getWeeklyChallenge(weekId: string): Promise<WeeklyChallenge | null> {
  const values = await redis.hGetAll(metadataKey(weekId))
  if (!values.postId || !values.levelKey || !values.startsAt || !values.closesAt) return null
  if (!LEVELS.some(level => level.key === values.levelKey)) return null
  return { weekId, levelKey: values.levelKey, startsAt: Number(values.startsAt), closesAt: Number(values.closesAt), postId: values.postId }
}

export async function ensureCurrentWeeklyChallenge(): Promise<WeeklyChallenge> {
  const window = currentWeeklyWindow()
  const existing = await getWeeklyChallenge(window.weekId)
  if (existing) return existing
  if (!context.subredditName) throw new Error('Subreddit unavailable for weekly challenge')

  const level = weeklyLevelFor(window.weekId)
  const post = await createWeeklyPost(window.weekId, window.startsAt, window.closesAt)
  const challenge: WeeklyChallenge = { ...window, levelKey: level.key, postId: post.id }
  await redis.hSet(metadataKey(window.weekId), {
    weekId: challenge.weekId,
    levelKey: challenge.levelKey,
    startsAt: String(challenge.startsAt),
    closesAt: String(challenge.closesAt),
    postId: challenge.postId,
  })
  await redis.expire(metadataKey(window.weekId), 90 * 24 * 60 * 60)
  return challenge
}
