import assert from 'node:assert/strict'
import { test } from 'node:test'
import { registerHooks } from 'node:module'
import { COLORS, EYES, PATTERNS, PATTERN_COLORS, DEFAULT_LOOK } from '../src/shared/character-options.ts'

const values = new Map(), hashes = new Map()
const context = { userId: 't2_player', username: 'Player' }
globalThis.__plungeeScoreTest = { context, redis: {
  get: async key => values.get(key),
  hGet: async (key, field) => hashes.get(key)?.[field],
  hSet: async (key, fields) => hashes.set(key, { ...hashes.get(key), ...fields }),
  zAdd: async () => {}, expire: async () => {},
} }
const stub = 'data:text/javascript,' + encodeURIComponent('const m=globalThis.__plungeeScoreTest; export const context=m.context; export const redis=m.redis;')
registerHooks({ resolve(specifier, context, next) {
  if (specifier === '@devvit/web/server') return { url: stub, shortCircuit: true }
  if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) return next(`${specifier}.ts`, context)
  return next(specifier, context)
} })
const { recordVerifiedScore, getPersonalBest } = await import('../src/server/core/scores.ts')

test('every selectable appearance can be saved and read back as a verified score', async () => {
  let n = 0
  const looks = [
    ...COLORS.map(option => ({ ...DEFAULT_LOOK, color: option.id })),
    ...EYES.map(option => ({ ...DEFAULT_LOOK, eyes: option.id })),
    ...PATTERNS.map(option => ({ ...DEFAULT_LOOK, pattern: option.id })),
    ...PATTERN_COLORS.map(option => ({ ...DEFAULT_LOOK, pattern: 'sprinkles', patternColor: option.id })),
  ]
  for (const look of looks) {
    const postId = `t3_appearance${n++}`
    const result = await recordVerifiedScore(postId, { ticks: 100, deaths: 0, replay: 'N100', look })
    assert.ok(result, JSON.stringify(look))
    assert.deepEqual((await getPersonalBest(postId)).look, look)
  }
})

test('a deleted post cannot accept a late verified score', async () => {
  values.set('plungee:v1:post:t3_deleted:deleted', '1')
  assert.equal(await recordVerifiedScore('t3_deleted', { ticks: 100, deaths: 0, replay: 'N100', look: DEFAULT_LOOK }), null)
  assert.equal(hashes.has('plungee:v1:post:t3_deleted:scores'), false)
})
