import assert from 'node:assert/strict'
import { test } from 'node:test'
import { registerHooks } from 'node:module'
import { flairForPost, matchingFlair } from '../src/server/core/flair-policy.ts'

const mocks = { context: { subredditName: 'plungee_test', userId: 't2_player' }, reddit: {}, redis: {} }
globalThis.__plungeeFlairTest = mocks
const stub = 'data:text/javascript,' + encodeURIComponent('const mock = globalThis.__plungeeFlairTest; export const context=mock.context; export const reddit=mock.reddit; export const redis=mock.redis;')
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === '@devvit/web/server') return { url: stub, shortCircuit: true }
  if (specifier === '../../client/plungee/levels') return { url: 'data:text/javascript,' + encodeURIComponent('export const LEVELS=[{key:"easy/test", title:"Test", data:{}, difficulty:"easy"}]; export const LEVELS_BY_DIFFICULTY={easy:LEVELS};'), shortCircuit: true }
  if (specifier === '../../client/plungee/sim') return { url: 'data:text/javascript,' + encodeURIComponent('export const formatTicks=ticks=>(ticks/60).toFixed(2);'), shortCircuit: true }
  try { return nextResolve(specifier, context) }
  catch (error) {
    if (error.code !== 'ERR_MODULE_NOT_FOUND' || !specifier.startsWith('.') || /\.[a-z]+$/i.test(specifier)) throw error
    return nextResolve(`${specifier}.ts`, context)
  }
} })
const { postFlair } = await import('../src/server/core/flairs.ts')
const { MEMPHIS_DARK } = await import('../src/client/plungee/game/theme.ts')
const { createChallengePost, createWeeklyPost, createWeeklyReplayPost } = await import('../src/server/core/post.ts')

function setup(templates = []) {
  const calls = []
  const locks = new Set()
  mocks.reddit.getPostFlairTemplates = async () => templates
  mocks.reddit.createPostFlairTemplate = async options => {
    calls.push(options)
    const template = { ...options, id: `flair-${templates.length}` }
    templates.push(template)
    return template
  }
  mocks.redis.set = async key => { if (locks.has(key)) return ''; locks.add(key); return 'OK' }
  mocks.redis.del = async key => { locks.delete(key) }
  return { templates, calls, locks }
}
test('all requested post types get the correct flair, including community and replay posts', () => {
  assert.equal(flairForPost('weekly'), 'Weekly')
  assert.equal(flairForPost('weeklyReplay'), 'Replay')
  assert.equal(flairForPost('challenge'), 'Challenge')
  assert.equal(flairForPost('editor'), 'Build a level')
  assert.equal(flairForPost('community'), 'Build a level')
  assert.equal(flairForPost('campaign'), null)
})
test('reuses an existing flair without changing its name, colors or other settings', async () => {
  const template = { id: 'existing', text: '  WEEKLY  ', backgroundColor: '#123456' }
  const { calls } = setup([template])
  assert.equal(matchingFlair([template], 'Weekly'), template)
  assert.deepEqual(await postFlair('weekly'), { flairId: 'existing' })
  assert.equal(calls.length, 0)
  assert.equal(template.backgroundColor, '#123456')
})
test('creates only missing flairs, with existing semantic theme colors and user-editing disabled', async () => {
  const { calls } = setup()
  await postFlair('weekly')
  await postFlair('weeklyReplay')
  await postFlair('challenge')
  await postFlair('community')
  await postFlair('editor')
  assert.equal(calls.length, 4)
  assert.deepEqual(calls.map(c => c.text), ['Weekly', 'Replay', 'Challenge', 'Build a level'])
  assert.deepEqual(calls.map(c => c.backgroundColor), [MEMPHIS_DARK.ui.accent, MEMPHIS_DARK.ui.highlight, MEMPHIS_DARK.decor[0], MEMPHIS_DARK.ui.highlight])
  assert.ok(calls.every(c => c.modOnly === false && c.allowUserEdits === false))
})
test('concurrent requests create a missing template only once', async () => {
  const { calls } = setup()
  const [first, second] = await Promise.all([postFlair('challenge'), postFlair('challenge')])
  assert.equal(first.flairId, second.flairId)
  assert.equal(calls.length, 1)
})
test('a permission error releases the template lock and allows a subsequent retry', async () => {
  const { locks } = setup()
  const create = mocks.reddit.createPostFlairTemplate
  mocks.reddit.createPostFlairTemplate = async () => { throw new Error('Flair permission missing') }
  await assert.rejects(postFlair('editor'), /permission missing/)
  assert.equal(locks.size, 0)
  mocks.reddit.createPostFlairTemplate = create
  assert.ok((await postFlair('editor')).flairId)
})
test('challenge, weekly and replay creation send the flair and preserve original weekly source', async () => {
  setup()
  const posts = []
  mocks.reddit.submitCustomPost = async options => { posts.push(options); return { id: `t3_post${posts.length}` } }
  await createChallengePost('easy/test', 't3_source', { ticks: 600 })
  await createWeeklyPost('2026-11-02', 1, 2)
  await createWeeklyReplayPost({ postId: 't3_original', levelKey: 'easy/test', weekId: '2026-10-26', startsAt: 1, closesAt: 2 })
  assert.equal(posts[0].runAs, 'USER')
  assert.ok(posts.every(post => post.flairId))
  assert.notEqual(posts[1].flairId, posts[2].flairId)
  assert.notEqual(posts[0].flairId, posts[1].flairId)
  assert.equal(posts[2].postData.sourcePostId, 't3_original')
  assert.equal(posts[2].postData.kind, 'weeklyReplay')
})
test('a replay post is not submitted before its source challenge has closed', async () => {
  setup()
  let submitted = false
  mocks.reddit.submitCustomPost = async () => { submitted = true; return { id: 't3_unexpected' } }
  await assert.rejects(createWeeklyReplayPost({ postId: 't3_original', levelKey: 'easy/test', weekId: '2026-11-09', startsAt: Date.now(), closesAt: Date.now() + 100000 }))
  assert.equal(submitted, false)
})
