import { context, redis, reddit } from '@devvit/web/server'
import { LEVELS } from '../../client/plungee/levels'
import { createWeeklyPost, createWeeklyReplayPost, weeklyLevelFor } from './post'
import { ensureWeeklyPair, type WeeklyChallenge } from './weekly-policy'
export { currentWeeklyWindow } from './weekly-policy'
export type { WeeklyChallenge } from './weekly-policy'

const WEEKLY_VERSION = 'v1'

function metadataKey(weekId: string): string { return `plungee:${WEEKLY_VERSION}:weekly:${weekId}` }

export async function getWeeklyChallenge(weekId: string): Promise<WeeklyChallenge | null> {
  const values = await redis.hGetAll(metadataKey(weekId))
  if (!values.postId || !values.levelKey || !values.startsAt || !values.closesAt) return null
  if (!/^t3_[a-z0-9]+$/.test(values.postId) || !Number.isFinite(Number(values.startsAt)) || !Number.isFinite(Number(values.closesAt)) || Number(values.closesAt) <= Number(values.startsAt)) return null
  if (!LEVELS.some(level => level.key === values.levelKey)) return null
  return { weekId, levelKey: values.levelKey, startsAt: Number(values.startsAt), closesAt: Number(values.closesAt), postId: values.postId, ...(values.replayPostId ? { replayPostId: values.replayPostId } : {}) }
}

/** Recover a successfully submitted post if saving its Redis ID previously failed. */
async function findWeeklyPost(kind: 'weekly' | 'weeklyReplay', weekId: string, sourcePostId?: string) {
  if (!context.subredditName) throw new Error('Subreddit unavailable for weekly challenge')
  const posts = await reddit.getNewPosts({ subredditName: context.subredditName, limit: 100 }).all()
  for (const post of posts) {
    if (post.removed || post.spam || !post.title.startsWith('Plungee Weekly')) continue
    const raw = await post.getPostData()
    if (raw?.kind === kind && raw.weekId === weekId && typeof raw.levelKey === 'string' && LEVELS.some(level => level.key === raw.levelKey) && (!sourcePostId || raw.sourcePostId === sourcePostId)) return { postId: post.id, raw }
  }
  return null
}

export async function ensureCurrentWeeklyChallenge(): Promise<WeeklyChallenge> {
  const lockKey = (weekId: string) => `plungee:v1:weekly-publishing:${weekId}`
  return ensureWeeklyPair({
    get: getWeeklyChallenge,
    lock: async weekId => await redis.set(lockKey(weekId), 'publishing', { nx: true, expiration: new Date(Date.now() + 120000) }) === 'OK',
    unlock: async weekId => { await redis.del(lockKey(weekId)) },
    create: async window => {
      const recovered = await findWeeklyPost('weekly', window.weekId)
      const levelKey = typeof recovered?.raw.levelKey === 'string' ? recovered.raw.levelKey : weeklyLevelFor(window.weekId).key
      const postId = recovered?.postId ?? (await createWeeklyPost(window.weekId, window.startsAt, window.closesAt)).id
      const challenge: WeeklyChallenge = { ...window, levelKey, postId }
      await redis.hSet(metadataKey(window.weekId), { weekId: window.weekId, levelKey,
        startsAt: String(window.startsAt), closesAt: String(window.closesAt), postId })
      await redis.expire(metadataKey(window.weekId), 90 * 86400)
      return challenge
    },
    createReplay: async previous => {
      const recovered = await findWeeklyPost('weeklyReplay', previous.weekId, previous.postId)
      return recovered?.postId ?? (await createWeeklyReplayPost(previous)).id
    },
    saveReplay: async (weekId, postId) => { await redis.hSet(metadataKey(weekId), { replayPostId: postId }) },
  })
}
