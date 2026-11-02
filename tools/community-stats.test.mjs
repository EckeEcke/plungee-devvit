import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyCheckpoint, replayExtends, summarizePlayers } from '../src/server/core/community-stats-policy.ts'

const player = (eligible = true) => ({ username: 'Runner', deaths: 0, clearedAt: null, eligible })

test('counts unique players and finishers, not attempts', () => {
  const runner = applyCheckpoint(applyCheckpoint(player(), 0, { deaths: 2, finished: true }, 100), 0, { deaths: 1, finished: true }, 200)
  assert.deepEqual(summarizePlayers({ runner, other: player() }), {
    players: 2, clears: 1, deaths: 3, firstClear: { username: 'Runner', at: 100 },
  })
})

test('counts deaths in unfinished attempts and only the new deaths in repeated checkpoints', () => {
  const partial = applyCheckpoint(player(), 0, { deaths: 2, finished: false }, 10)
  const repeated = applyCheckpoint(partial, 2, { deaths: 2, finished: false }, 20)
  const finish = applyCheckpoint(repeated, 2, { deaths: 3, finished: true }, 30)
  assert.equal(repeated.deaths, 2)
  assert.equal(repeated.clearedAt, null)
  assert.equal(finish.deaths, 3)
  assert.equal(finish.clearedAt, 30)
})

test('creator cannot earn first clear; later improvements cannot replace the first finisher', () => {
  const creator = applyCheckpoint(player(false), 0, { deaths: 0, finished: true }, 1)
  assert.equal(summarizePlayers({ creator }).firstClear, null)
  const first = applyCheckpoint(player(), 0, { deaths: 5, finished: true }, 10)
  const later = { ...applyCheckpoint(player(), 0, { deaths: 0, finished: true }, 20), username: 'Faster' }
  assert.deepEqual(summarizePlayers({ creator, later, first }).firstClear, { username: 'Runner', at: 10 })
})

test('checkpoints must preserve the complete previous input prefix', () => {
  assert.equal(replayExtends([0, 1], [0, 1, -1]), true)
  assert.equal(replayExtends([0, 1], [0, -1, 1]), false)
  assert.equal(replayExtends([0, 1], [0]), false)
  assert.equal(replayExtends([0, 1], [0, 1]), true)
})

test('deleted players no longer contribute to public statistics', () => {
  const records = { user: applyCheckpoint(player(), 0, { deaths: 3, finished: true }, 1) }
  delete records.user
  assert.deepEqual(summarizePlayers(records), { players: 0, clears: 0, deaths: 0, firstClear: null })
})
