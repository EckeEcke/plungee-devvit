import { Hono } from 'hono'
import { context, redis, reddit } from '@devvit/web/server'
import type { ChallengeProfile, ChallengeVersusResponse } from '../../shared/api'
import { LEVELS } from '../../client/plungee/levels'
import { compileLevel, decodeInputs, simulate, TICK_RATE } from '../../client/plungee/sim'
import { bragText, deathText, isWinningRun } from '../core/brag'
import type { ApiError, LeaderboardResponse, PostInitResponse, VerifyRunResponse } from '../../shared/api'
import { createChallengePost } from '../core/post'
import { getPersonalBest, getReleasedLeaderboard, recordVerifiedScore } from '../core/scores'
import { isCommunityBlocked } from '../core/moderation'
import { startCommunityRun, updateCommunityRun } from '../core/community-stats'
import { getWeeklyChallenge } from '../core/weekly'
import { releasedWeeklySource } from '../core/weekly-policy'

export const api = new Hono()
api.use('*', async (c, next) => {
  c.header('Cache-Control', 'private, no-store')
  await next()
})

/** A requested post is a resource selector, never an identity or trusted level definition. */
async function resolvePlayPost(requested?: string) {
  const currentRaw = context.postData as Record<string, unknown> | undefined
  if (!requested || requested === context.postId || (currentRaw?.kind === 'weeklyReplay' && requested === currentRaw.sourcePostId)) {
    if (currentRaw?.kind === 'weeklyReplay') {
      const stored = typeof currentRaw.weekId === 'string' ? await getWeeklyChallenge(currentRaw.weekId) : null
      const weekly = releasedWeeklySource(currentRaw, stored)
      return { postId: weekly.postId as `t3_${string}`, raw: { kind: 'weekly', ...weekly } as Record<string, unknown>, weeklyReplay: true }
    }
    if (context.postId && (context.postData as Record<string, unknown> | undefined)?.kind === 'community' && await isCommunityBlocked(context.postId)) throw new Error('Community level unpublished.')
    return { postId: context.postId, raw: currentRaw, weeklyReplay: false }
  }
  if (!/^t3_[a-z0-9]+$/.test(requested)) throw new Error('Invalid community post.')
  if (await isCommunityBlocked(requested)) throw new Error('Community level unpublished.')
  const meta = await redis.get(`plungee:v1:post:${requested}:meta`)
  const level = await redis.get(`plungee:v1:post:${requested}:level`)
  if (!meta || !level) throw new Error('Community level unavailable.')
  const post = await reddit.getPostById(requested as `t3_${string}`)
  if (post.removed || post.spam) throw new Error('Community post unavailable.')
  if (post.subredditName.toLowerCase() !== context.subredditName?.toLowerCase()) throw new Error('Community post belongs to another subreddit.')
  const raw = await post.getPostData() as Record<string, unknown> | undefined
  if (raw?.kind !== 'community') throw new Error('Not a community level post.')
  return { postId: post.id, raw, weeklyReplay: false }
}

async function challengeProfile(userId: string | undefined): Promise<ChallengeProfile> {
  if (!userId || !/^t2_[a-z0-9]+$/i.test(userId)) return { username: null, avatarUrl: null }
  try {
    const user = await reddit.getUserById(userId as `t2_${string}`)
    if (!user) return { username: null, avatarUrl: null }
    let avatarUrl: string | null = null
    try { avatarUrl = (await user.getSnoovatarUrl()) ?? null } catch { /* Profile name is still available. */ }
    return { username: user.username, avatarUrl }
  } catch { return { username: null, avatarUrl: null } }
}

api.get('/challenge-versus', async c => {
  c.header('Cache-Control', 'private, no-store')
  const raw = context.postData as Record<string, unknown> | undefined
  if (raw?.kind !== 'challenge') return c.json<ApiError>({ error: 'Not a personal challenge.' }, 404)
  const creatorId = typeof raw.creatorUserId === 'string' ? raw.creatorUserId : undefined
  const [creator, viewer] = await Promise.all([
    challengeProfile(creatorId), challengeProfile(context.userId ? String(context.userId) : undefined),
  ])
  return c.json<ChallengeVersusResponse>({ creator, viewer })
})

async function postLevel(raw = context.postData as Record<string, unknown> | undefined, postId = context.postId) {
  const levelKey = typeof raw?.levelKey === 'string' ? raw.levelKey : ''
  if (raw?.kind === 'community' && postId) {
    if (await isCommunityBlocked(postId)) return null
    const stored = await redis.get(`plungee:v1:post:${postId}:level`)
    if (!stored) return null
    const data = JSON.parse(stored)
    return { key: levelKey, title: data.title as string, data, difficulty: 'normal' as const, par: null }
  }
  return LEVELS.find(level => level.key === levelKey) ?? null
}

function challengeClose(raw = context.postData as Record<string, unknown> | undefined): number | null {
  if (raw?.kind !== 'challenge' && raw?.kind !== 'weekly' && raw?.kind !== 'community') return null
  if (typeof raw.closesAt !== 'number') return null
  return raw.closesAt
}

api.get('/init', async (c) => {
  let target
  try { target = await resolvePlayPost(c.req.query('postId')) }
  catch { return c.json<ApiError>({ error: 'Community level unavailable.' }, 404) }
  const { postId, raw } = target
  if (postId && raw?.kind === 'editor') {
    return c.json<PostInitResponse>({ postId, kind: 'editor', levelKey: '', title: 'Build a level', username: context.username ?? null })
  }
  const level = await postLevel(raw, postId)
  if (!postId || !level) {
    return c.json<ApiError>({ error: 'This post has no playable campaign level.' }, 400)
  }
  const kind = target.weeklyReplay ? 'weeklyReplay' : raw?.kind === 'campaign' || raw?.kind === 'challenge' || raw?.kind === 'weekly' || raw?.kind === 'practice' || raw?.kind === 'community' ? raw.kind : 'practice'
  return c.json<PostInitResponse>({
    postId,
    levelKey: level.key,
    title: level.title,
    username: context.username ?? null,
    kind,
    targetTicks: kind === 'challenge' && typeof raw?.creatorBestTicks === 'number' && Number.isInteger(raw.creatorBestTicks) && raw.creatorBestTicks > 0 ? raw.creatorBestTicks : undefined,
    levelData: kind === 'community' ? level.data : undefined,
    closesAt: typeof raw?.closesAt === 'number' ? raw.closesAt : undefined,
    weekId: typeof raw?.weekId === 'string' ? raw.weekId : undefined,
  })
})

api.post('/create-challenge', async (c) => {
  if (!context.postId || !context.userId) {
    return c.json<ApiError>({ error: 'A signed-in Reddit user is required.' }, 401)
  }
  let campaignLevelKey: unknown
  if (c.req.header('Content-Type')?.includes('application/json')) {
    try { campaignLevelKey = (await c.req.json()).campaignLevelKey }
    catch { return c.json<ApiError>({ error: 'Invalid request.' }, 400) }
  }
  const level = campaignLevelKey === undefined ? await postLevel() : LEVELS.find(level => level.key === campaignLevelKey)
  if (!level) return c.json<ApiError>({ error: 'Post level unavailable.' }, 400)

  const personalBest = await getPersonalBest(campaignLevelKey === undefined ? context.postId : `campaign:${level.key}`)
  if (!personalBest) {
    return c.json<ApiError>({ error: 'Finish and verify a run before creating a challenge.' }, 409)
  }

  try {
    const post = await createChallengePost(level.key, context.postId, personalBest)
    return c.json({
      postId: post.id,
      levelKey: level.key,
      url: `https://www.reddit.com/comments/${post.id.replace(/^t3_/, '')}`,
      closesAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
    })
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Reddit rejected the post request.'
    console.error('Could not create Plungee challenge:', reason)
    return c.json<ApiError>({ error: `Challenge post could not be created: ${reason}` }, 400)
  }
})

/** Campaign submissions use the bundled level and Reddit identity, never browser-reported times. */
api.post('/verify-campaign', async c => {
  if (!context.userId) return c.json<ApiError>({ error: 'Sign in to create a challenge.' }, 401)
  let value: { levelKey?: unknown; replay?: unknown; look?: unknown }
  try { value = await c.req.json() }
  catch { return c.json<ApiError>({ error: 'Invalid request.' }, 400) }
  const level = LEVELS.find(level => level.key === value?.levelKey)
  if (!level || typeof value?.replay !== 'string' || !value.replay || value.replay.length > 120000) return c.json<ApiError>({ error: 'Invalid level or replay.' }, 400)
  try {
    const result = simulate(compileLevel(level.data), decodeInputs(value.replay))
    if (!result.finished) return c.json<ApiError>({ error: 'Replay does not finish the level.' }, 422)
    const stored = await recordVerifiedScore(`campaign:${level.key}`, { ticks: result.ticks, deaths: result.deaths, replay: value.replay, look: value.look })
    return c.json<VerifyRunResponse>({ verified: true, ticks: result.ticks, deaths: result.deaths,
      recorded: stored !== null, closed: false, canPostResult: false, improved: stored?.improved ?? false,
      personalBest: stored ? { ticks: stored.personalBest.ticks, deaths: stored.personalBest.deaths } : null })
  } catch { return c.json<ApiError>({ error: 'Invalid replay.' }, 400) }
})

api.post('/result-comment', async c => {
  if (!context.userId || !context.postId) return c.json<ApiError>({ error: 'Sign in required.' }, 401)
  let target
  try { target = await resolvePlayPost(c.req.query('postId')) }
  catch { return c.json<ApiError>({ error: 'Community level unavailable.' }, 404) }
  const { postId, raw } = target
  if (!postId) return c.json<ApiError>({ error: 'Post unavailable.' }, 404)
  if (raw?.kind !== 'community' && (raw?.kind !== 'challenge' || typeof raw.creatorBestTicks !== 'number')) {
    return c.json<ApiError>({ error: 'This result cannot be posted as a challenge win.' }, 400)
  }
  let best: { ticks: number; deaths: number } | null = null
  if (raw?.kind === 'challenge') {
    let payload: { resultRunId?: unknown }
    try { payload = await c.req.json() }
    catch { return c.json<ApiError>({ error: 'Verified run missing.' }, 400) }
    const encoded = await redis.hGet(`plungee:v1:user:${context.userId}:brag-runs`, postId)
    if (encoded) {
      const run = JSON.parse(encoded) as { id: string; ticks: number; deaths: number }
      if (run.id === payload?.resultRunId && isWinningRun(run.ticks, Number(raw.creatorBestTicks))) best = run
    }
  } else { best = await getPersonalBest(postId) }
  if (!best) return c.json<ApiError>({ error: 'This run must beat the challenge time before bragging.' }, 409)
  const key = `plungee:v1:user:${context.userId}:comments`
  const previous = await redis.hGet(key, postId)
  if (previous) return c.json({ posted: true })
  const lock = `plungee:v1:user:${context.userId}:comment-lock:${postId}`
  const acquired = await redis.set(lock, 'pending', { nx: true, expiration: new Date(Date.now() + 60000) })
  if (acquired !== 'OK') return c.json<ApiError>({ error: 'Your result is already being posted.' }, 409)
  try {
    if (await redis.hGet(key, postId)) return c.json({ posted: true })
    const { formatTicks } = await import('../../client/plungee/sim')
    const text = raw?.kind === 'community'
      ? `I finished this Plungee level! My verified time: ${formatTicks(best.ticks)} · ${deathText(best.deaths)}.`
      : bragText(best.ticks, Number(raw?.creatorBestTicks), best.deaths, TICK_RATE)
    const comment = await reddit.submitComment({ id: postId, runAs: 'USER', text })
    await redis.hSet(key, { [postId]: comment.id })
    await redis.expire(key, 90 * 86400)
    return c.json({ posted: true })
  } catch (error) {
    return c.json<ApiError>({ error: error instanceof Error ? error.message : 'Could not post result.' }, 400)
  } finally {
    await redis.del(lock)
  }
})

api.get('/leaderboard', async (c) => {
  let target
  try { target = await resolvePlayPost(c.req.query('postId')) }
  catch { return c.json<ApiError>({ error: 'Community level unavailable.' }, 404) }
  const { postId, raw: postData } = target
  if (!postId) return c.json<ApiError>({ error: 'Post unavailable.' }, 400)
  const closesAt = challengeClose(postData)
  if (closesAt === null) return c.json<ApiError>({ error: 'This post has no releasable challenge leaderboard.' }, 404)
  const released = Date.now() >= closesAt
  if (postData?.kind === 'challenge' && !released) {
    return c.json<ApiError>({ error: 'Leaderboard remains hidden until the challenge closes.' }, 403)
  }

  const creatorUserId = typeof postData?.creatorUserId === 'string' ? postData.creatorUserId : null
  const leaderboard = await getReleasedLeaderboard(postId, context.userId ? String(context.userId) : null, creatorUserId)
  return c.json<LeaderboardResponse>({
    released,
    closesAt,
    ...leaderboard,
    entries: released ? leaderboard.entries : leaderboard.entries.map(entry => ({ ...entry, replay: '' })),
    yourEntry: leaderboard.yourEntry ? { ...leaderboard.yourEntry, replay: released ? leaderboard.yourEntry.replay : '' } : null,
  })
})

/** Re-simulate untrusted browser inputs on the server before persisting a personal best. */
api.post('/community-run', async c => {
  if (!context.userId) return c.json({ error: 'Sign in required.' }, 401)
  try {
    const { postId, raw } = await resolvePlayPost(c.req.query('postId'))
    if (!postId || raw?.kind !== 'community') return c.json({ error: 'Community level unavailable.' }, 404)
    const level = await postLevel(raw, postId)
    if (!level) return c.json({ error: 'Community level unavailable.' }, 404)
    const text = await c.req.text()
    if (text.length > 130000) return c.json({ error: 'Replay too large.' }, 413)
    const value = JSON.parse(text) as { runId?: unknown; replay?: unknown }
    if (value.runId === undefined) return c.json({ runId: await startCommunityRun(postId, raw.creatorUserId) })
    if (typeof value.runId !== 'string' || !/^[a-f0-9-]{36}$/.test(value.runId) || typeof value.replay !== 'string' || !value.replay || value.replay.length > 120000) return c.json({ error: 'Invalid run.' }, 400)
    const result = simulate(compileLevel(level.data), decodeInputs(value.replay))
    await updateCommunityRun(postId, value.runId, value.replay, result)
    return c.json({ saved: true })
  } catch (error) {
    console.error('Community statistics update failed', error)
    return c.json({ error: 'Could not update community statistics.' }, 400)
  }
})

api.post('/verify', async (c) => {
  let target
  try { target = await resolvePlayPost(c.req.query('postId')) }
  catch { return c.json<ApiError>({ error: 'Community level unavailable.' }, 404) }
  const { postId, raw } = target
  const level = await postLevel(raw, postId)
  if (!postId || !level) return c.json<ApiError>({ error: 'Post level unavailable.' }, 400)

  let payload: unknown
  try { payload = await c.req.json() }
  catch { return c.json<ApiError>({ error: 'Invalid request.' }, 400) }

  const data = payload as { levelKey?: unknown; replay?: unknown; look?: unknown } | null
  if (!data || data.levelKey !== level.key || typeof data.replay !== 'string' ||
      !data.replay || data.replay.length > 120_000) {
    return c.json<ApiError>({ error: 'Invalid level or replay.' }, 400)
  }

  try {
    const result = simulate(compileLevel(level.data), decodeInputs(data.replay))
    if (!result.finished) return c.json<ApiError>({ error: 'The replay does not finish the level.' }, 422)
    const closesAt = challengeClose(raw)
    const stored = await recordVerifiedScore(postId, {
      ticks: result.ticks,
      deaths: result.deaths,
      replay: data.replay,
      look: data.look,
    }, closesAt)
    const canBrag = stored !== null && raw?.kind === 'challenge' && typeof raw.creatorBestTicks === 'number' && isWinningRun(result.ticks, raw.creatorBestTicks)
    let resultRunId: string | undefined
    if (context.userId && raw?.kind === 'challenge') {
      const key = `plungee:v1:user:${context.userId}:brag-runs`
      if (canBrag) {
        resultRunId = crypto.randomUUID()
        await redis.hSet(key, { [postId]: JSON.stringify({ id: resultRunId, ticks: result.ticks, deaths: result.deaths }) })
        await redis.expire(key, 86400)
      } else { await redis.hDel(key, [postId]) }
    }
    return c.json<VerifyRunResponse>({
      verified: true,
      ticks: result.ticks,
      deaths: result.deaths,
      recorded: stored !== null,
      closed: closesAt !== null && Date.now() >= closesAt,
      canPostResult: canBrag || (stored !== null && raw?.kind === 'community'),
      ...(resultRunId ? { resultRunId } : {}),
      improved: stored?.improved ?? false,
      personalBest: stored ? { ticks: stored.personalBest.ticks, deaths: stored.personalBest.deaths } : null,
    })
  } catch {
    return c.json<ApiError>({ error: 'Invalid replay.' }, 400)
  }
})
