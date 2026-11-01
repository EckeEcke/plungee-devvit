import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bragText, isWinningRun } from '../src/server/core/brag.ts'

test('brag requires a strictly faster current run', () => {
  assert.equal(isWinningRun(599, 600), true)
  assert.equal(isWinningRun(600, 600), false)
  assert.equal(isWinningRun(601, 600), false)
  assert.throws(() => bragText(601, 600, 0, 60))
})
test('difference boundaries use exact simulation ticks', () => {
  assert.match(bragText(571, 600, 0, 60), /^Photofinish! /)
  assert.match(bragText(570, 600, 0, 60), /^Close, but /)
  assert.match(bragText(480, 600, 0, 60), /^Close, but /)
  assert.match(bragText(479, 600, 0, 60), /^Easy 😎, /)
})
test('comment uses the supplied run time and actual deaths', () => {
  assert.equal(bragText(570, 600, 0, 60), 'Close, but I beat the level in 9.50 s! 0 deaths')
  assert.equal(bragText(479, 600, 1, 60), 'Easy 😎, I beat the level in 7.98 s! 1 death')
  assert.equal(bragText(3599, 3600, 2, 60), 'Photofinish! I beat the level in 59.98 s! 2 deaths')
})
