import assert from 'node:assert/strict'
import { test } from 'node:test'
import './helpers/game-loader.mjs'

const { LEVELS, LEVELS_BY_DIFFICULTY, findLevel } = await import('../src/client/plungee/levels/index.ts')
const { compileLevel, simulate, encodeInputs, decodeInputs } = await import('../src/client/plungee/sim/index.ts')

test('campaign has 84 valid unique levels, 28 per difficulty', () => {
  assert.equal(LEVELS.length, 84)
  assert.equal(new Set(LEVELS.map(level => level.key)).size, 84)
  for (const [difficulty, levels] of Object.entries(LEVELS_BY_DIFFICULTY)) {
    assert.equal(levels.length, 28, difficulty)
    for (const level of levels) {
      assert.equal(level.difficulty, difficulty)
      assert.doesNotThrow(() => compileLevel(level.data), level.key)
      assert.equal(findLevel(level.key), level)
    }
  }
})

test('old Reddit level IDs remain playable without adding retired levels to campaign', () => {
  for (const key of ['easy/14-don-tget-crushed', 'easy/19-up-in-the-corner', 'easy/20-drop-it-like-it-shot', 'easy/23-jump-jump']) {
    const level = findLevel(key)
    assert.ok(level, key)
    assert.doesNotThrow(() => compileLevel(level.data), key)
    assert.equal(LEVELS.some(level => level.key === key), false)
  }
  assert.equal(findLevel('unknown'), undefined)
  assert.equal(findLevel({}), undefined)
})

test('new campaign levels simulate identically through the server replay path', () => {
  const inputs = Int8Array.from({ length: 600 }, (_, i) => [0, 1, -1][Math.floor(i / 37) % 3])
  const replay = encodeInputs(inputs)
  for (const level of LEVELS.filter(level => /\/(26|27|28)-/.test(level.key) || /grab-the-key2|break-through$/.test(level.key))) {
    const compiled = compileLevel(level.data)
    assert.deepEqual(simulate(compiled, inputs), simulate(compiled, decodeInputs(replay)), level.key)
  }
})
