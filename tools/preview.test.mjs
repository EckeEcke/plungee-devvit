import assert from 'node:assert/strict'
import { test } from 'node:test'
import { selectPreviewStart } from '../src/client/plungee/game/previewWindow.ts'

const level = (rows = 80) => ({ v: 1, size: 'medium', tiles: Array(rows).fill('.'.repeat(16)), entities: [] })
test('selects the obstacle cluster rather than the first rows', () => {
  const data = level()
  data.entities = [
    { t: 'spawn', x: 8, y: 1 },
    { t: 'spikes', x: 4, y: 55, dir: 'u' },
    { t: 'saw', x: 8, y: 58, axis: 'h', len: 3, period: 120, phase: 0 },
    { t: 'crusher', x: 11, y: 61, size: 2, dir: 'd', len: 2, period: 120, phase: 0 },
  ]
  const start = selectPreviewStart(data, 20)
  assert.ok(start > 0)
  assert.ok(start <= 55 && start + 20 >= 65)
  assert.equal(start, selectPreviewStart(data, 20))
})
test('solid wall mass does not outweigh obstacles', () => {
  const data = level()
  data.tiles.fill('#'.repeat(16), 0, 30)
  data.entities = [{ t: 'spikes', x: 8, y: 60, dir: 'u' }]
  const start = selectPreviewStart(data)
  assert.ok(start <= 60 && start + 20 > 60)
})
test('takes vertical motion into account rather than just counting anchor cells', () => {
  const data = level()
  data.entities = [
    { t: 'saw', x: 6, y: 25, axis: 'v', len: 20, period: 120, phase: 0 },
    { t: 'spikes', x: 4, y: 46, dir: 'u' },
  ]
  const start = selectPreviewStart(data)
  assert.ok(start > 25 && start < 45 && start + 20 > 46)
})
test('crop remains within bounds for short and empty levels', () => {
  assert.equal(selectPreviewStart(level(8), 20), 0)
  assert.equal(selectPreviewStart(level(80), 20), 0)
})
