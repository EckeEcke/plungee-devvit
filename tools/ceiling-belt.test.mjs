import assert from 'node:assert/strict'
import { test } from 'node:test'
import { registerHooks } from 'node:module'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

registerHooks({ load(url, context, nextLoad) {
  if (!url.endsWith('.ts')) return nextLoad(url, context)
  return { format: 'module', shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText }
}, resolve(specifier, context, nextResolve) {
  try { return nextResolve(specifier, context) }
  catch (error) {
    if (!['ERR_MODULE_NOT_FOUND', 'ERR_UNSUPPORTED_DIR_IMPORT'].includes(error.code) || !specifier.startsWith('.') || /\.[a-z]+$/i.test(specifier)) throw error
    try { return nextResolve(`${specifier}.ts`, context) }
    catch { return nextResolve(`${specifier}/index.ts`, context) }
  }
} })
const { World, LevelBuilder, compileLevel, TILE, BELT_SPEED, simulate, encodeInputs, decodeInputs } = await import('../src/client/plungee/sim/index.ts')
const { Renderer } = await import('../src/client/plungee/game/renderer.ts')
const { MEMPHIS_DARK } = await import('../src/client/plungee/game/theme.ts')
const { beltPose } = await import('../src/client/plungee/game/beltPose.ts')

test('hanging animation stretches downward, keeping the head fixed throughout the cycle', () => {
  const scales = new Set()
  for (let frame = 0; frame < 120; frame++) {
    const pose = beltPose(frame / 60)
    assert.ok(pose.sy > 1.11 && pose.sy < 1.15)
    assert.ok(pose.sx > 0.93 && pose.sx < 0.95)
    assert.equal(pose.anchorY - 12 * pose.sy, 0)
    scales.add(pose.sy)
  }
  assert.ok(scales.size > 1)
})

function fixture(dir = 1) {
  const world = new World(compileLevel(new LevelBuilder('short').spawn(7, 8).goal(14, 38)
    .plat(5, 3, 12, dir === 1 ? '>' : '<').plat(39, 0, 15).build()))
  world.p.y = 6 * TILE + 1
  world.p.vy = -120
  return world
}
for (const dir of [-1, 1]) {
  test(`belt ${dir}: attaches once, carries without input, releases once against direction`, () => {
    const w = fixture(dir)
    const events = []
    w.onEvent = e => events.push(e.type)
    w.step(0)
    assert.equal(w.ceilingBelt, dir)
    assert.equal(w.p.y, 6 * TILE)
    const start = w.p.x
    for (let i = 0; i < 15; i++) w.step(0)
    assert.ok((w.p.x - start) * dir > 0)
    assert.equal(w.p.vx, dir * BELT_SPEED)
    assert.equal(w.p.y, 6 * TILE)
    assert.equal(events.filter(e => e === 'beltAttach').length, 1)
    w.step(-dir)
    for (let i = 0; i < 5; i++) w.step(-dir)
    assert.equal(w.ceilingBelt, 0)
    assert.ok(w.p.y > 6 * TILE)
    assert.equal(events.filter(e => e === 'beltRelease').length, 1)
  })
  test(`belt ${dir}: same-direction input stays attached; end releases automatically`, () => {
    const w = fixture(dir)
    w.step(dir)
    assert.equal(w.ceilingBelt, dir)
    const clone = w.clone()
    assert.equal(clone.ceilingBelt, dir)
    for (let i = 0; i < 120; i++) { w.step(dir); clone.step(dir) }
    assert.equal(w.ceilingBelt, 0)
    assert.ok(w.p.y > 6 * TILE)
    assert.deepEqual(w.p, clone.p)
  })
  test(`belt ${dir}: opposite input at first contact does not attach`, () => {
    const w = fixture(dir)
    w.step(-dir)
    assert.equal(w.ceilingBelt, 0)
    w.step(-dir)
    assert.ok(w.p.y > 6 * TILE)
  })
}

test('topside conveyor behaviour is unchanged', () => {
  const w = fixture()
  w.p.y = 5 * TILE - 12
  w.p.vy = 0
  for (let i = 0; i < 15; i++) w.step(0)
  assert.equal(w.ceilingBelt, 0)
  assert.equal(w.p.onGround, true)
  assert.equal(w.p.vx, BELT_SPEED)
})

test('spring-to-ceiling transport replays deterministically', () => {
  const level = compileLevel(new LevelBuilder('short').spawn(7, 9).goal(14, 38)
    .plat(5, 3, 12, '>').plat(11, 0, 15).spring(7, 10).plat(39, 0, 15).build())
  const w = new World(level)
  let attached = false
  w.onEvent = e => { if (e.type === 'beltAttach') attached = true }
  const inputs = Array.from({ length: 240 }, (_, i) => i > 100 ? -1 : 0)
  for (const input of inputs) w.step(input)
  assert.equal(attached, true)
  assert.deepEqual(simulate(level, decodeInputs(encodeInputs(inputs))), {
    finished: w.finished, deaths: w.deaths, ticks: w.finished ? w.finishTick : w.tick,
  })
})

test('docking emits one small themed particle burst at the head, not continuously', () => {
  const world = fixture()
  const bursts = []
  const renderer = { theme: MEMPHIS_DARK, level: world.level, particles: { burst: (...args) => bursts.push(args) } }
  world.onEvent = event => Renderer.prototype.handleEvent.call(renderer, event, world)
  world.step(0)
  for (let i = 0; i < 10; i++) world.step(0)
  assert.equal(bursts.length, 1)
  const [x, y, count, options] = bursts[0]
  assert.ok(Number.isFinite(x))
  assert.equal(y, 6 * TILE + 1)
  assert.equal(count, 4)
  assert.deepEqual(options.colors, [MEMPHIS_DARK.help, MEMPHIS_DARK.help2])
  assert.equal(options.shape, 'star')
  assert.ok(options.life <= 0.3)
})
