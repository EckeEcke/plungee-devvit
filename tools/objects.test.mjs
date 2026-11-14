import assert from 'node:assert/strict'
import { test } from 'node:test'
import './helpers/game-loader.mjs'

const { World, LevelBuilder, compileLevel, validateLevel, simulate, encodeInputs, decodeInputs, TILE, PLAYER_H, CRUMBLE_DELAY, CRUMBLE_REGROW, RESPAWN_TICKS } = await import('../src/client/plungee/sim/index.ts')
const { EditorDoc } = await import('../src/client/plungee/editor/doc.ts')
const { TOOLS, makeEntity, defaultBrush } = await import('../src/client/plungee/editor/brush.ts')
const { levelToTs } = await import('../src/client/plungee/editor/tscode.ts')
const { selectPreviewStart } = await import('../src/client/plungee/game/previewWindow.ts')

const base = () => new LevelBuilder('short').plat(10, 0, 15).spawn(7, 9).goal(14, 9)
const world = b => new World(compileLevel(b.build()))
function run(w, ticks, dir = 0) { for (let i = 0; i < ticks; i++) w.step(dir) }

test('key and door validation rejects missing pairs, duplicates and walls', () => {
  assert.deepEqual(validateLevel(base().key(8, 9).door(10, 9).build()), [])
  for (const b of [base().key(8, 9), base().door(10, 9), base().key(8, 9).key(9, 9).door(10, 9), base().key(8, 9).door(10, 9).door(11, 9), base().key(8, 10).door(10, 9)]) {
    assert.ok(validateLevel(b.build()).length > 0)
  }
})

test('door blocks movement without a key and opens once after collection', () => {
  const locked = world(base().key(1, 1).door(10, 9))
  run(locked, 120, 1)
  assert.equal(locked.hasKey, false)
  assert.equal(locked.doorOpen, false)
  assert.ok(Math.abs(locked.p.x + 12 - 10 * TILE) < 1e-6)
  const w = world(base().key(8, 9).door(10, 9))
  const events = []
  w.onEvent = e => events.push(e.type)
  run(w, 120, 1)
  assert.ok(w.hasKey && w.doorOpen && w.finished)
  assert.equal(events.filter(e => e === 'key').length, 1)
  assert.equal(events.filter(e => e === 'doorOpen').length, 1)
})

test('key and door state is cloned independently and reset after death', () => {
  const w = world(base().key(8, 9).door(10, 9).spikes(12, 9))
  for (let i = 0; i < 120 && !w.doorOpen; i++) w.step(1)
  assert.ok(w.hasKey && w.doorOpen)
  const copy = w.clone()
  assert.ok(copy.hasKey && copy.doorOpen)
  for (let i = 0; i < 120 && !w.p.dead; i++) w.step(1)
  assert.equal(w.deaths, 1)
  run(w, RESPAWN_TICKS + 1)
  assert.equal(w.hasKey, false)
  assert.equal(w.doorOpen, false)
  assert.ok(copy.hasKey && copy.doorOpen)
})

test('a key/door run is verified identically from encoded inputs on the server', () => {
  const level = compileLevel(base().key(8, 9).door(10, 9).build())
  const inputs = new Int8Array(120).fill(1)
  const client = new World(level)
  for (const input of inputs) client.step(input)
  const server = simulate(level, decodeInputs(encodeInputs(inputs)))
  assert.deepEqual(server, { finished: true, ticks: client.finishTick, deaths: client.deaths })
  assert.ok(server.ticks > 0)
})

for (const power of [1, 2]) {
  test(`spring power ${power} shatters brittle ceilings, preserves ascent and regrows`, () => {
    const w = world(new LevelBuilder('short').plat(12, 0, 15).plat(9, 7, 7, 'B').spring(7, 11, power).spawn(7, 10).goal(0, 0))
    let breaks = 0
    w.onEvent = e => { if (e.type === 'brittleBreak' && e.fromBelow) breaks++ }
    for (let i = 0; i < 60 && w.brittleInfo(7, 9).state !== 'gone'; i++) w.step(0)
    assert.equal(w.brittleInfo(7, 9).state, 'gone')
    assert.ok(w.tick < CRUMBLE_DELAY && w.p.vy < 0)
    assert.equal(breaks, 1)
    const copy = w.clone()
    assert.deepEqual(copy.shattered, w.shattered)
    w.p.x = 2 * TILE
    w.p.y = 12 * TILE - PLAYER_H
    w.p.vy = 0
    run(w, CRUMBLE_REGROW + 1)
    assert.equal(w.brittleInfo(7, 9).state, 'ok')
    assert.equal(copy.brittleInfo(7, 9).state, 'gone')
  })
}

test('ordinary upward motion cannot shatter brittle ceilings', () => {
  const w = world(new LevelBuilder('short').plat(12, 0, 15).plat(9, 7, 7, 'B').spawn(7, 10).goal(0, 0))
  w.p.y = 10 * TILE + 1
  w.p.vy = -380
  w.step(0)
  assert.equal(w.brittleInfo(7, 9).state, 'ok')
  assert.equal(w.p.vy, 0)
})

for (const dir of ['l', 'r']) for (const power of [1, 2]) {
  test(`side spring ${dir}/${power} breaks brittle walls, but preserves solid walls`, () => {
    const col = dir === 'r' ? 9 : 5, sign = dir === 'r' ? 1 : -1
    const fixture = kind => world(new LevelBuilder('short').plat(11, 0, 15).wall(col, 6, 10, kind).spring(7, 10, power, dir).spawn(7, 9).goal(0, 0))
    const w = fixture('B')
    let broke = false
    w.onEvent = e => { if (e.type === 'brittleBreak' && e.side === sign) broke = true }
    for (let i = 0; i < 50 && !broke; i++) w.step(0)
    assert.ok(broke && w.p.vx * sign > 110)
    const copy = w.clone()
    run(w, 4); run(copy, 4)
    assert.deepEqual(copy.p, w.p)
    assert.deepEqual(copy.shattered, w.shattered)
    const solid = fixture('#')
    run(solid, 50)
    assert.equal(solid.shattered.some(Boolean), false)
  })
}

test('normal running cannot break brittle walls', () => {
  const w = world(new LevelBuilder('short').plat(11, 0, 15).wall(9, 6, 10, 'B').spawn(7, 10).goal(0, 0))
  run(w, 60, 1)
  assert.equal(w.shattered.some(Boolean), false)
})

function landed(kind = 'I') {
  const w = world(new LevelBuilder('short').plat(12, 0, 15, kind).spring(2, 11, 2, 'r').spawn(2, 10).goal(0, 0))
  let launched = false
  w.onEvent = e => { if (e.type === 'spring') launched = true }
  for (let i = 0; i < 60; i++) {
    w.step(0)
    if (launched && w.p.onGround && w.p.stun === 0) return w
  }
  throw new Error('Spring launch did not land')
}

test('ice preserves spring momentum; coasting, steering and air behave consistently', () => {
  const ice = landed(), solid = landed('#'), same = ice.clone(), counter = ice.clone(), air = ice.clone()
  const speed = ice.p.vx
  air.p.onGround = false
  air.p.y -= TILE * 2
  run(ice, 5); run(solid, 5); run(same, 5, 1); run(counter, 5, -1); run(air, 5)
  assert.ok(ice.p.vx > speed - 5)
  assert.ok(ice.p.vx > solid.p.vx + 80)
  assert.ok(Math.abs(same.p.vx - speed) < 1e-6)
  assert.ok(counter.p.vx < ice.p.vx - 10 && counter.p.vx > 0)
  assert.ok(air.p.vx > speed - 5)
})

test('editor places unique keys/doors, supports undo and round-trips exports', () => {
  const doc = EditorDoc.createStarter('short', 'Key test')
  for (const tool of ['key', 'door']) {
    assert.ok(TOOLS.some(t => t.id === tool))
    assert.ok(doc.place(makeEntity(tool, tool === 'key' ? 3 : 5, 9, defaultBrush())))
  }
  const original = doc.toLevelData()
  doc.place({ t: 'key', x: 4, y: 9 })
  assert.equal(doc.toLevelData().entities.filter(e => e.t === 'key').length, 1)
  doc.undo()
  assert.deepEqual(doc.toLevelData(), original)
  const restored = new EditorDoc(JSON.parse(JSON.stringify(original))).toLevelData()
  assert.deepEqual(restored, original)
  assert.deepEqual(validateLevel(restored), [])
  const code = levelToTs(restored, 'create').replace(/^import .*$/gm, '').replace('export function', 'function').replace('(): LevelData', '()')
  assert.deepEqual(new Function('LevelBuilder', `${code}\nreturn create()`)(LevelBuilder), restored)
})

test('inline preview includes key/door objects when selecting the level crop', () => {
  const data = new LevelBuilder('medium').spawn(1, 1).goal(1, 78).key(8, 55).door(10, 58).build()
  const start = selectPreviewStart(data, 20)
  assert.ok(start <= 55 && start + 20 >= 59)
})

for (const dir of [-1, 1]) {
  test(`fast non-spring impact breaks brittle walls in direction ${dir}`, () => {
    const col = dir > 0 ? 10 : 4
    const w = world(new LevelBuilder('short').plat(12, 0, 15, 'I').wall(col, 8, 11, 'B').spawn(7, 11).goal(0, 0))
    run(w, 3)
    w.p.vx = dir * 300
    let broke = false
    w.onEvent = e => { if (e.type === 'brittleBreak') broke = true }
    for (let i = 0; i < 30 && !broke; i++) w.step(0)
    assert.ok(broke && w.p.vx * dir > 110)
  })
}

test('lasers pass through newly shattered blocks before their crumble delay', () => {
  const w = world(new LevelBuilder('short').plat(12, 0, 15).plat(9, 7, 7, 'B').spring(7, 11, 2).spawn(7, 10).goal(0, 0).laser(0, 9, 'r'))
  const laser = w.level.lasers[0]
  assert.equal(w.laserBeam(laser).w, 6 * TILE)
  for (let i = 0; i < 60 && !w.shattered[9 * w.level.cols + 7]; i++) w.step(0)
  assert.ok(w.shattered[9 * w.level.cols + 7])
  assert.ok(w.tick < CRUMBLE_DELAY)
  assert.ok(w.laserBeam(laser).w > 6 * TILE)
})
