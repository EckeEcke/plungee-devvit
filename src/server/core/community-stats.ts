import { context, redis } from '@devvit/web/server'
import { decodeInputs, type RunResult } from '../../client/plungee/sim'
import type { CommunityStats } from '../../shared/api'
import { applyCheckpoint, replayExtends, summarizePlayers, type CommunityPlayer as Player } from './community-stats-policy'

const usersKey = (id: string) => `plungee:v1:post:${id}:players`
const userIndex = (id: string) => `plungee:v1:user:${id}:community-stats`
const runIndex = (id: string) => `plungee:v1:user:${id}:community-runs`
const runKey = (id: string) => `plungee:v1:community-run:${id}`
type Run = { postId: string; userId: string; replay: string; deaths: number; finished: boolean }

export async function startCommunityRun(postId: string, creatorId: unknown): Promise<string> {
  if (!context.userId) throw new Error('Sign in required.')
  if (await redis.get(`plungee:v1:post:${postId}:deleted`)) throw new Error('Post deleted.')
  const userId = String(context.userId)
  const id = crypto.randomUUID()
  await redis.hSet(userIndex(userId), { [postId]: '1' })
  await redis.hSet(runIndex(userId), { [id]: postId })
  await redis.expire(runIndex(userId), 90 * 86400)
  await redis.hSetNX(usersKey(postId), userId, JSON.stringify({ username: context.username ?? null, deaths: 0, clearedAt: null, eligible: userId !== creatorId } satisfies Player))
  await redis.set(runKey(id), JSON.stringify({ postId, userId, replay: '', deaths: 0, finished: false } satisfies Run), { expiration: new Date(Date.now() + 86400000) })
  if (await redis.get(`plungee:v1:post:${postId}:deleted`)) {
    await redis.del(runKey(id))
    await redis.hDel(userIndex(userId), [postId])
    await redis.hDel(runIndex(userId), [id])
    await redis.hDel(usersKey(postId), [userId])
    throw new Error('Post deleted.')
  }
  return id
}

/** All counters derive from server simulation; repeated checkpoints only add the difference. */
export async function updateCommunityRun(postId: string, id: string, replay: string, result: RunResult): Promise<void> {
  const key = runKey(id)
  const players = usersKey(postId)
  for (let attempt = 0; attempt < 5; attempt++) {
    const tx = await redis.watch(key, players)
    try {
      const encoded = await redis.get(key)
      if (!encoded) throw new Error('Run expired.')
      const run = JSON.parse(encoded) as Run
      if (run.postId !== postId || run.userId !== String(context.userId)) throw new Error('Invalid run.')
      const before = decodeInputs(run.replay)
      const after = decodeInputs(replay)
      if (after.length < before.length) { await tx.unwatch(); return }
      if (!replayExtends(before, after)) throw new Error('Replay changed.')
      if (run.finished || after.length === before.length) { await tx.unwatch(); return }
      const stored = await redis.hGet(players, run.userId)
      if (!stored) throw new Error('Player data deleted.')
      const player = applyCheckpoint(JSON.parse(stored) as Player, run.deaths, result, Date.now())
      await tx.multi()
      await tx.hSet(players, { [run.userId]: JSON.stringify(player) })
      await tx.set(key, JSON.stringify({ ...run, replay, deaths: result.deaths, finished: result.finished }), { expiration: new Date(Date.now() + 86400000) })
      const committed = await tx.exec()
      if (committed.length) return
    } catch (error) {
      await tx.discard()
      throw error
    }
  }
  throw new Error('Statistics are busy. Please retry.')
}

export async function getCommunityStats(postId: string): Promise<CommunityStats> {
  const records = await redis.hGetAll(usersKey(postId))
  return summarizePlayers(Object.fromEntries(Object.entries(records).map(([id, raw]) => [id, JSON.parse(raw) as Player])))
}

export async function deleteCommunityStats(postId: string): Promise<void> {
  const players = await redis.hGetAll(usersKey(postId))
  for (const userId of Object.keys(players)) {
    const runs = await redis.hGetAll(runIndex(userId))
    for (const [id, level] of Object.entries(runs)) {
      if (level !== postId) continue
      await redis.del(runKey(id))
      await redis.hDel(runIndex(userId), [id])
    }
    await redis.hDel(userIndex(userId), [postId])
  }
  await redis.del(usersKey(postId))
}

export async function deleteOwnCommunityStats(): Promise<void> {
  if (!context.userId) return
  const userId = String(context.userId)
  const posts = await redis.hGetAll(userIndex(userId))
  for (const id of Object.keys(posts)) await redis.hDel(usersKey(id), [userId])
  const runs = await redis.hGetAll(runIndex(userId))
  for (const id of Object.keys(runs)) await redis.del(runKey(id))
  await redis.del(userIndex(userId), runIndex(userId))
}
