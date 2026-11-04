import assert from 'node:assert/strict'
import { test } from 'node:test'
import { currentWeeklyWindow, ensureWeeklyPair, releasedWeeklySource } from '../src/server/core/weekly-policy.ts'

const now = new Date('2026-11-09T12:00:00Z')
function setup(withPrevious = true) {
  const window = currentWeeklyWindow(now)
  const previous = { ...currentWeeklyWindow(new Date(window.startsAt - 1)), postId: 't3_previous', levelKey: 'easy/01-first' }
  const records = new Map(withPrevious ? [[previous.weekId, previous]] : [])
  const calls = { weekly: 0, replay: 0 }
  let locked = false
  let publishedReplay
  const publishing = {
    get: async week => records.get(week) ?? null,
    lock: async () => { if (locked) return false; locked = true; return true },
    unlock: async () => { locked = false },
    create: async window => {
      calls.weekly++
      const current = { ...window, postId: 't3_current', levelKey: 'normal/02-next' }
      records.set(window.weekId, current)
      return current
    },
    createReplay: async previous => {
      assert.ok(previous.closesAt <= window.startsAt)
      if (!publishedReplay) { calls.replay++; publishedReplay = 't3_replay' }
      return publishedReplay
    },
    saveReplay: async (week, postId) => { records.set(week, { ...records.get(week), replayPostId: postId }) },
  }
  return { publishing, records, calls, previous, window }
}

test('weekly boundaries use UTC Monday, including Sunday, new year and exact rollover', () => {
  assert.equal(currentWeeklyWindow(new Date('2026-11-08T23:59:59Z')).weekId, '2026-11-02')
  assert.equal(currentWeeklyWindow(new Date('2026-11-09T00:00:00Z')).weekId, '2026-11-09')
  assert.equal(currentWeeklyWindow(new Date('2027-01-01T10:00:00Z')).weekId, '2026-12-28')
})
test('publishes current weekly plus previous replay without duplicates on repeated calls', async () => {
  const { publishing, records, previous, calls } = setup()
  await ensureWeeklyPair(publishing, now)
  await ensureWeeklyPair(publishing, now)
  assert.deepEqual(calls, { weekly: 1, replay: 1 })
  assert.equal(records.get(previous.weekId).replayPostId, 't3_replay')
})
test('first installation creates a weekly but does not invent a nonexistent previous challenge', async () => {
  const { publishing, calls } = setup(false)
  await ensureWeeklyPair(publishing, now)
  assert.deepEqual(calls, { weekly: 1, replay: 0 })
})
test('an existing current weekly still creates its missing previous replay', async () => {
  const { publishing, calls, records, window } = setup()
  records.set(window.weekId, { ...window, postId: 't3_existing', levelKey: 'easy/03' })
  const current = await ensureWeeklyPair(publishing, now)
  assert.equal(current.postId, 't3_existing')
  assert.deepEqual(calls, { weekly: 0, replay: 1 })
})
test('a replay API failure is retried without creating another current weekly', async () => {
  const { publishing, calls } = setup()
  const createReplay = publishing.createReplay
  publishing.createReplay = async () => { throw new Error('Reddit unavailable') }
  await assert.rejects(ensureWeeklyPair(publishing, now), /Reddit unavailable/)
  publishing.createReplay = createReplay
  await ensureWeeklyPair(publishing, now)
  assert.deepEqual(calls, { weekly: 1, replay: 1 })
})
test('recovery can reuse an already-published replay after Redis save failed', async () => {
  const { publishing, calls } = setup()
  const saveReplay = publishing.saveReplay
  publishing.saveReplay = async () => { throw new Error('Redis unavailable') }
  await assert.rejects(ensureWeeklyPair(publishing, now), /Redis unavailable/)
  publishing.saveReplay = saveReplay
  await ensureWeeklyPair(publishing, now)
  assert.deepEqual(calls, { weekly: 1, replay: 1 })
})
test('concurrent scheduler and moderator requests cannot publish a second pair', async () => {
  const { publishing, calls } = setup()
  let release
  let acquired
  const ready = new Promise(resolve => { acquired = resolve })
  const gate = new Promise(resolve => { release = resolve })
  const create = publishing.create
  publishing.create = async window => { acquired(); await gate; return create(window) }
  const first = ensureWeeklyPair(publishing, now)
  await ready
  await assert.rejects(ensureWeeklyPair(publishing, now), /already being prepared/)
  release()
  await first
  await ensureWeeklyPair(publishing, now)
  assert.deepEqual(calls, { weekly: 1, replay: 1 })
})
test('does not release a previous challenge with an invalid future close time', async () => {
  const { publishing, records, previous, calls } = setup()
  records.set(previous.weekId, { ...previous, closesAt: now.getTime() + 10000 })
  await ensureWeeklyPair(publishing, now)
  assert.deepEqual(calls, { weekly: 1, replay: 0 })
})
test('replay source must match canonical week, original post and level, and be closed', () => {
  const { previous } = setup()
  const raw = { weekId: previous.weekId, sourcePostId: previous.postId, levelKey: previous.levelKey }
  assert.equal(releasedWeeklySource(raw, previous, now.getTime()).postId, previous.postId)
  assert.throws(() => releasedWeeklySource(raw, null, now.getTime()))
  for (const patch of [{ weekId: '2026-11-09' }, { sourcePostId: 't3_other' }, { levelKey: 'hard/other' }]) {
    assert.throws(() => releasedWeeklySource({ ...raw, ...patch }, previous, now.getTime()))
  }
  assert.throws(() => releasedWeeklySource({ ...raw, closesAt: 0 }, previous, previous.closesAt - 1))
  assert.equal(releasedWeeklySource(raw, previous, previous.closesAt).postId, previous.postId)
})
