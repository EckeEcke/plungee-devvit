import assert from 'node:assert/strict'
import { test } from 'node:test'
import { registerHooks } from 'node:module'

const mocks = { context: { subredditName: 'plungee_test' }, redis: {}, reddit: {}, scheduler: {} }
globalThis.__plungeePrivacyTest = mocks
const stub = 'data:text/javascript,' + encodeURIComponent('const m=globalThis.__plungeePrivacyTest; export const context=m.context; export const redis=m.redis; export const reddit=m.reddit; export const scheduler=m.scheduler;')
registerHooks({ resolve(specifier, context, next) {
  if (specifier === '@devvit/web/server') return { url: stub, shortCircuit: true }
  if (specifier === '../../client/plungee/sim') return { url: 'data:text/javascript,export const decodeInputs=()=>new Int8Array()', shortCircuit: true }
  if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) return next(`${specifier}.ts`, context)
  return next(specifier, context)
} })
const { trackPrivacyUser, trackPrivacyPost, indexPrivacyPost, checkPrivacyUser, eraseAccountIdentity, runDailyPrivacyCleanup } = await import('../src/server/core/privacy.ts')
const { deletePostContent, deleteCommentContent, retryContentDeletions } = await import('../src/server/core/content-deletion.ts')
const USERS = 'plungee:v1:privacy:users'
const POSTS = 'plungee:v1:privacy:posts'
const DAY = 86400000
const id = 't2_gone'
const prefix = `plungee:v1:user:${id}`

function setup() {
  const strings = new Map(), hashes = new Map(), sorted = new Map(), posts = new Map(), jobs = [], checked = []
  const hash = key => { if (!hashes.has(key)) hashes.set(key, {}); return hashes.get(key) }
  Object.assign(mocks.redis, {
    get: async key => strings.get(key),
    set: async (key, value, options) => { if (options?.nx && strings.has(key)) return ''; strings.set(key, value); return 'OK' },
    del: async (...keys) => { for (const key of keys) { strings.delete(key); hashes.delete(key); sorted.delete(key) } },
    hGetAll: async key => ({ ...hash(key) }),
    hGet: async (key, field) => hash(key)[field],
    hSet: async (key, values) => Object.assign(hash(key), values),
    hSetNX: async (key, field, value) => { if (field in hash(key)) return 0; hash(key)[field] = value; return 1 },
    hDel: async (key, fields) => { for (const field of fields) delete hash(key)[field] },
    zRem: async (key, members) => { for (const member of members) sorted.get(key)?.delete(member) },
    zRange: async key => [...(sorted.get(key) ?? [])].map(member => ({ member, score: 1 })),
    hScan: async (key, cursor, _pattern, count) => {
      const entries = Object.entries(hash(key))
      const page = entries.slice(cursor, cursor + count)
      return { cursor: cursor + count < entries.length ? cursor + count : 0, fieldValues: page.map(([field, value]) => ({ field, value })) }
    },
  })
  Object.assign(mocks.reddit, {
    getUserById: async userId => { checked.push(userId); return { username: 'Alive' } },
    getPostById: async postId => { if (!posts.has(postId)) throw Error('Temporary API failure'); return posts.get(postId) },
    getNewPosts: () => ({ all: async () => [] }),
  })
  mocks.scheduler.runJob = async job => { jobs.push(job); return 'job' }
  return { strings, hashes, sorted, posts, jobs, checked, hash }
}

function postFixture(state, postId = 't3_level', data = { kind: 'community', creatorUserId: id, levelKey: 'community/test' }) {
  const post = {
    id: postId, title: 'Plungee Community Level', authorName: '[deleted]', removedByCategory: undefined,
    data: { ...data }, getPostData: async () => ({ ...post.data }),
    setPostData: async value => { post.data = { ...value } },
  }
  state.posts.set(postId, post)
  return post
}

test('registration validates IDs and keeps user/post references for future cleanup', async () => {
  const s = setup()
  await trackPrivacyUser(id, 't3_level')
  await trackPrivacyUser('browser-generated-id', 't3_other')
  assert.deepEqual(s.hash(USERS), { [id]: '1' })
  assert.deepEqual(s.hash(`${prefix}:privacy-posts`), { t3_level: '1' })
  assert.deepEqual(s.hash(POSTS), { t3_level: '1' })
})

test('confirmed account deletion removes identity from all stores and preserves level content', async () => {
  const s = setup()
  const post = postFixture(s)
  mocks.reddit.getUserById = async () => undefined
  await trackPrivacyUser(id, post.id)
  for (const kind of ['scores', 'players', 'reports']) s.hash(`plungee:v1:post:${post.id}:${kind}`)[id] = JSON.stringify({ userId: id, username: 'OldName' })
  s.hash(`plungee:v1:post:${post.id}:scores`).t2_other = '{"username":"Other"}'
  s.sorted.set(`plungee:v1:post:${post.id}:leaderboard`, new Set([id, 't2_other']))
  s.strings.set(`plungee:v1:post:${post.id}:level`, '{"tiles":["C"]}')
  s.strings.set(`plungee:v1:post:${post.id}:meta`, '{"author":"OldName","title":"Keep me"}')
  s.strings.set(`plungee:v1:post:${post.id}:moderation`, JSON.stringify({ action: 'unpublish', userId: id }))
  s.hash(`plungee:v2:user:${id}:levels`)[post.id] = '1'
  s.hash(`${prefix}:community-runs`).run = post.id
  s.strings.set('plungee:v1:community-run:run', JSON.stringify({ userId: id }))
  s.strings.set(`${prefix}:draft`, 'private draft')
  s.hash(`${prefix}:comments`)[post.id] = 't1_comment'
  assert.equal(await checkPrivacyUser(id), 'erased')
  assert.equal(post.data.creatorUserId, undefined)
  assert.equal(post.data.levelKey, 'community/test')
  assert.equal(s.strings.get(`plungee:v1:post:${post.id}:level`), '{"tiles":["C"]}')
  assert.equal(JSON.parse(s.strings.get(`plungee:v1:post:${post.id}:meta`)).author, 'Deleted user')
  assert.equal(s.hash(`plungee:v1:post:${post.id}:scores`).t2_other, '{"username":"Other"}')
  assert.deepEqual([...s.sorted.get(`plungee:v1:post:${post.id}:leaderboard`)], ['t2_other'])
  assert.equal(JSON.stringify([...s.strings, ...s.hashes].map(([key, value]) => [key, value])).includes(id), false)
  assert.equal(JSON.stringify([...s.strings, ...s.hashes]).includes('OldName'), false)
})

test('one missing lookup and deleted post attribution never prove an account deletion', async () => {
  const s = setup()
  const post = postFixture(s)
  post.removedByCategory = 'deleted'
  await trackPrivacyUser(id, post.id)
  mocks.reddit.getUserById = async () => undefined
  assert.equal(await checkPrivacyUser(id, DAY), 'pending')
  assert.equal(s.hash(USERS)[id], '1')
  assert.equal(post.data.creatorUserId, id)
})

test('unresolvable accounts use a 30-day fallback; recovery cancels the missing state', async () => {
  const s = setup()
  await trackPrivacyUser(id)
  mocks.reddit.getUserById = async () => undefined
  assert.equal(await checkPrivacyUser(id, DAY), 'pending')
  assert.equal(await checkPrivacyUser(id, 30 * DAY), 'pending')
  mocks.reddit.getUserById = async () => ({ username: 'Recovered' })
  assert.equal(await checkPrivacyUser(id, 31 * DAY), 'kept')
  assert.equal(s.strings.has(`${prefix}:privacy-missing`), false)
  mocks.reddit.getUserById = async () => undefined
  assert.equal(await checkPrivacyUser(id, 32 * DAY), 'pending')
  assert.equal(await checkPrivacyUser(id, 62 * DAY), 'erased')
  assert.equal(s.hash(USERS)[id], undefined)
})

test('API errors cannot authorize deletion or count towards the retention fallback', async () => {
  const s = setup()
  await trackPrivacyUser(id)
  s.strings.set(`${prefix}:draft`, 'keep')
  s.strings.set(`${prefix}:privacy-missing`, '1')
  mocks.reddit.getUserById = async () => { throw Error('429 rate limited') }
  await assert.rejects(checkPrivacyUser(id, 40 * DAY), /429/)
  assert.equal(s.strings.get(`${prefix}:draft`), 'keep')
  assert.equal(s.hash(USERS)[id], '1')
  assert.equal(s.strings.has(`${prefix}:privacy-missing`), false)
})

test('partial deletion is retried even after postData has already been anonymized', async () => {
  const s = setup()
  const post = postFixture(s)
  await trackPrivacyUser(id, post.id)
  s.hash(`plungee:v2:user:${id}:levels`)[post.id] = '1'
  const key = `plungee:v1:post:${post.id}:meta`
  s.strings.set(key, '{"author":"OldName"}')
  const set = mocks.redis.set
  mocks.redis.set = async (k, ...args) => { if (k === key) throw Error('Redis unavailable'); return set(k, ...args) }
  await assert.rejects(eraseAccountIdentity(id), /Redis unavailable/)
  assert.equal(post.data.creatorUserId, undefined)
  assert.equal(s.hash(USERS)[id], '1')
  assert.equal(s.strings.get(`${prefix}:privacy-erasing`), '1')
  mocks.redis.set = set
  assert.equal(await checkPrivacyUser(id), 'erased')
  assert.equal(JSON.parse(s.strings.get(key)).author, 'Deleted user')
  assert.equal(s.hash(USERS)[id], undefined)
})

test('legacy inventory finds creator, score holders, reporters, players and moderators', async () => {
  const s = setup()
  const post = postFixture(s)
  s.hash(`plungee:v1:post:${post.id}:scores`).t2_score = '{}'
  s.hash(`plungee:v1:post:${post.id}:players`).t2_player = '{}'
  s.hash(`plungee:v1:post:${post.id}:reports`).t2_reporter = '1'
  s.strings.set(`plungee:v1:post:${post.id}:moderation`, '{"userId":"t2_mod"}')
  await indexPrivacyPost(post.id)
  assert.deepEqual(Object.keys(s.hash(USERS)).sort(), ['t2_gone', 't2_mod', 't2_player', 't2_reporter', 't2_score'])
})

test('daily job resumes batches, covers more than one user page and does not restart on recovery ticks', async () => {
  const s = setup()
  for (let i = 0; i < 35; i++) await trackPrivacyUser(`t2_user${i}`)
  const now = Date.UTC(2026, 10, 7, 3)
  await runDailyPrivacyCleanup(true, now)
  for (let i = 0; i < 10; i++) await runDailyPrivacyCleanup(false, now)
  assert.equal(new Set(s.checked).size, 35)
  assert.equal(JSON.parse(s.strings.get('plungee:v1:privacy:job')).phase, 'done')
  const checks = s.checked.length
  await runDailyPrivacyCleanup(false, now + DAY)
  assert.equal(s.checked.length, checks)
  assert.ok(s.jobs.every(job => job.name === 'privacy-cleanup-batch'))
})

test('an existing job lock prevents overlapping daily scans', async () => {
  const s = setup()
  s.strings.set('plungee:v1:privacy:job:lock', 'other-worker')
  await runDailyPrivacyCleanup()
  assert.equal(s.jobs.length, 0)
  assert.equal(s.strings.get('plungee:v1:privacy:job:lock'), 'other-worker')
})

test('initial discovery failures leave resumable work for the recovery job', async () => {
  const s = setup()
  mocks.reddit.getNewPosts = () => ({ all: async () => { throw Error('503 unavailable') } })
  await assert.rejects(runDailyPrivacyCleanup(), /503/)
  assert.equal(JSON.parse(s.strings.get('plungee:v1:privacy:job')).phase, 'discover')
  assert.equal(s.strings.has('plungee:v1:privacy:job:lock'), false)
  mocks.reddit.getNewPosts = () => ({ all: async () => [] })
  await runDailyPrivacyCleanup(false)
  assert.equal(JSON.parse(s.strings.get('plungee:v1:privacy:job')).phase, 'posts')
})

test('post deletion removes all related app content and leaves only an ID tombstone', async () => {
  const s = setup()
  const post = postFixture(s)
  await trackPrivacyUser(id, post.id)
  await trackPrivacyUser('t2_other', post.id)
  s.hash(`plungee:v2:user:${id}:levels`)[post.id] = '{"title":"Delete this"}'
  s.hash(`plungee:v2:user:t2_other:scores`)[post.id] = '{"replay":"R20"}'
  s.hash(`plungee:v1:post:${post.id}:players`).t2_other = '{}'
  s.hash('plungee:v1:user:t2_other:community-runs').run = post.id
  s.strings.set('plungee:v1:community-run:run', '{"replay":"R20"}')
  s.strings.set(`plungee:v1:post:${post.id}:level`, '{"title":"Delete this"}')
  s.strings.set(`plungee:v1:post:${post.id}:meta`, '{"title":"Delete this"}')
  s.hash(`${prefix}:comments`)[post.id] = 't1_result'
  s.sorted.set('plungee:v1:community:levels', new Set([post.id]))
  await deletePostContent(post.id, id)
  await deletePostContent(post.id, id)
  assert.deepEqual(post.data, {})
  assert.equal(s.strings.get(`plungee:v1:post:${post.id}:deleted`), '1')
  assert.equal(s.strings.has(`plungee:v1:post:${post.id}:level`), false)
  assert.equal(s.strings.has(`plungee:v1:post:${post.id}:meta`), false)
  assert.equal(s.strings.has('plungee:v1:community-run:run'), false)
  assert.equal(s.hash(`plungee:v2:user:${id}:levels`)[post.id], undefined)
  assert.equal(s.hash('plungee:v2:user:t2_other:scores')[post.id], undefined)
  assert.equal(s.hash(`${prefix}:comments`)[post.id], undefined)
  assert.equal(s.hash('plungee:v1:content-deletions')[post.id], undefined)
  await indexPrivacyPost(post.id)
  assert.equal(s.hash(POSTS)[post.id], undefined, 'late indexing cannot resurrect a deleted post')
})

test('comment deletion removes only its matching reference and keeps valid scores', async () => {
  const s = setup()
  await trackPrivacyUser(id, 't3_level')
  s.hash(`${prefix}:comments`).t3_level = 't1_result'
  s.hash('plungee:v1:post:t3_level:scores')[id] = 'valid score'
  await deleteCommentContent('t1_old', 't3_level', id)
  assert.equal(s.hash(`${prefix}:comments`).t3_level, 't1_result')
  await deleteCommentContent('t1_result', 't3_level', id)
  assert.equal(s.hash(`${prefix}:comments`).t3_level, undefined)
  assert.equal(s.hash('plungee:v1:post:t3_level:scores')[id], 'valid score')
})

test('failed Reddit post-data cleanup remains queued and succeeds on recovery', async () => {
  const s = setup()
  const post = postFixture(s)
  await trackPrivacyPost(post.id)
  const setData = post.setPostData
  post.setPostData = async () => { throw Error('503 Reddit unavailable') }
  await assert.rejects(deletePostContent(post.id), /503/)
  assert.equal(s.hash('plungee:v1:content-deletions')[post.id], post.id)
  post.setPostData = setData
  await retryContentDeletions()
  assert.deepEqual(post.data, {})
  assert.equal(s.hash('plungee:v1:content-deletions')[post.id], undefined)
})

test('unrelated subreddit deletions do not enroll users or create app records', async () => {
  const s = setup()
  postFixture(s, 't3_other', {})
  await deletePostContent('t3_other', 't2_unrelated')
  await deleteCommentContent('t1_other', 't3_other', 't2_unrelated')
  assert.deepEqual(s.hash(USERS), {})
  assert.equal(s.strings.has('plungee:v1:post:t3_other:deleted'), false)
})
