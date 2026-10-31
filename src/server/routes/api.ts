import { Hono } from 'hono'
import { context } from '@devvit/web/server'
import { LEVELS } from '../../client/plungee/levels'
import { compileLevel, decodeInputs, simulate } from '../../client/plungee/sim'
import type { ApiError, PostInitResponse, VerifyRunResponse } from '../../shared/api'

export const api = new Hono()

function postLevel() {
  const raw = context.postData as Record<string, unknown> | undefined
  const levelKey = typeof raw?.levelKey === 'string' ? raw.levelKey : ''
  return LEVELS.find(level => level.key === levelKey) ?? null
}

api.get('/init', (c) => {
  const level = postLevel()
  if (!context.postId || !level) {
    return c.json<ApiError>({ error: 'This post has no playable campaign level.' }, 400)
  }
  return c.json<PostInitResponse>({
    postId: context.postId,
    levelKey: level.key,
    title: level.title,
    username: context.username ?? null,
  })
})

/** Re-simulate untrusted browser inputs on the server. Does not persist results yet. */
api.post('/verify', async (c) => {
  const level = postLevel()
  if (!context.postId || !level) return c.json<ApiError>({ error: 'Post level unavailable.' }, 400)

  let payload: unknown
  try { payload = await c.req.json() }
  catch { return c.json<ApiError>({ error: 'Invalid request.' }, 400) }

  const data = payload as { levelKey?: unknown; replay?: unknown } | null
  if (!data || data.levelKey !== level.key || typeof data.replay !== 'string' ||
      !data.replay || data.replay.length > 120_000) {
    return c.json<ApiError>({ error: 'Invalid level or replay.' }, 400)
  }

  try {
    const result = simulate(compileLevel(level.data), decodeInputs(data.replay))
    if (!result.finished) return c.json<ApiError>({ error: 'The replay does not finish the level.' }, 422)
    return c.json<VerifyRunResponse>({ verified: true, ticks: result.ticks, deaths: result.deaths })
  } catch {
    return c.json<ApiError>({ error: 'Invalid replay.' }, 400)
  }
})
