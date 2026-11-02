import type { EntityData, LevelData } from '../sim'

const WEIGHT: Record<EntityData['t'], number> = {
  spawn: 0, goal: 0.5, checkpoint: 0.5, spring: 1.5, spikes: 2.5,
  laser: 5, saw: 5, hammer: 5, crusher: 5, mover: 2.5,
}

/** Visible footprint, including moving hazards whose anchor may be outside the crop. */
function bounds(entity: EntityData, data: LevelData): [number, number] {
  let top = entity.y
  let bottom = entity.y + 1
  if (entity.t === 'hammer') bottom += entity.len
  if ((entity.t === 'saw' || entity.t === 'mover') && entity.axis === 'v') bottom += entity.len
  if (entity.t === 'crusher') {
    bottom = entity.y + entity.size
    if (entity.dir === 'u') top -= entity.len
    if (entity.dir === 'd') bottom += entity.len
  }
  if (entity.t === 'laser' && (entity.dir === 'u' || entity.dir === 'd')) {
    const direction = entity.dir === 'u' ? -1 : 1
    for (let row = entity.y + direction; row >= 0 && row < data.tiles.length; row += direction) {
      const tile = data.tiles[row]?.[entity.x] ?? '#'
      if ('#I<>BXO'.includes(tile)) break
      top = Math.min(top, row)
      bottom = Math.max(bottom, row + 1)
    }
  }
  return [Math.max(0, top), Math.min(data.tiles.length, bottom)]
}

/** Deterministic vertical crop prioritising obstacles and variety over solid wall mass. */
export function selectPreviewStart(data: LevelData, visibleRows = 20): number {
  const maxStart = Math.max(0, data.tiles.length - visibleRows)
  const footprints = data.entities.map(entity => ({ entity, range: bounds(entity, data) }))
  const tileScores = data.tiles.map((line, row) => {
    let score = 0
    for (let col = 1; col < line.length - 1; col++) {
      const tile = line[col]!
      if (tile === '.') continue
      if (tile !== '#') score += 0.65
      else if (row > 0 && data.tiles[row - 1]?.[col] === '.') score += 0.15
    }
    return Math.min(3, score)
  })
  let bestStart = 0
  let bestScore = -Infinity
  for (let start = 0; start <= maxStart; start++) {
    const end = start + visibleRows
    let score = tileScores.slice(start, end).reduce((sum, value) => sum + value, 0)
    const types = new Set<string>()
    for (const { entity, range: [top, bottom] } of footprints) {
      const overlap = Math.max(0, Math.min(end, bottom) - Math.max(start, top))
      const weight = WEIGHT[entity.t]
      if (!overlap || !weight) continue
      types.add(entity.t)
      score += weight * overlap / Math.max(1, bottom - top)
      // Prefer centring the action when otherwise equally dense windows overlap.
      score += weight * 0.1 * Math.max(0, 1 - Math.abs((top + bottom) / 2 - (start + end) / 2) / visibleRows)
    }
    score += types.size * 1.5
    if (score > bestScore) { bestScore = score; bestStart = start }
  }
  return bestStart
}
