<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import SkullIcon from './SkullIcon.vue'
import { startMusic, stopMusic } from '../audio/audio'
import { Game, type HudState } from '../game/game'
import { GHOST_COLORS, type GhostSpec } from '../game/ghost'
import { applyLook, sanitizeLook } from '../game/look'
import type { LeaderboardEntry } from '../../../shared/api'
import type { Theme } from '../game/theme'
import { compileLevel, formatTicks, type LevelData } from '../sim'

const props = defineProps<{
  levelData: LevelData
  levelKey: string
  title: string
  theme: Theme
  entries: LeaderboardEntry[]
  yourRank: number | null
  yourEntry: LeaderboardEntry | null
}>()

const emit = defineEmits<{ exit: [] }>()
const column = ref<HTMLElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
const hudBar = ref<HTMLElement | null>(null)
const failed = ref(false)
const hud = shallowRef<HudState>({
  status: 'ready', started: false, ticks: 0, deaths: 0, progress: 0,
  countdown: 3, bestTicks: null, newBest: false, replay: '', race: [], focusedRunner: null,
})
let game: Game | null = null
let insetObs: ResizeObserver | null = null

const specs = computed<GhostSpec[]>(() => props.entries.map((entry, index) => ({
  replay: entry.replay,
  label: `${entry.username ? `#${entry.rank} ${entry.username}` : `#${entry.rank}`}${entry.isCreator ? ' · Creator' : ''}`,
  look: sanitizeLook(entry.look),
  color: GHOST_COLORS[index % GHOST_COLORS.length],
  solid: true,
})))

const rows = computed(() => props.entries.map((entry, index) => {
  const runner = hud.value.race[index]
  return {
    index,
    rank: entry.rank,
    name: `${entry.username ?? 'Deleted user'}${entry.isCreator ? ' · Creator' : ''}`,
    ticks: entry.ticks,
    color: applyLook(props.theme, sanitizeLook(entry.look)).player,
    progress: runner?.finishTick !== null && runner?.finishTick !== undefined ? 1 : (runner?.progress ?? 0),
    done: runner?.finishTick !== null && runner?.finishTick !== undefined,
  }
}))

const cssVars = computed(() => ({
  '--panel': props.theme.ui.panel, '--text': props.theme.ui.text, '--accent': props.theme.ui.accent,
  '--muted': props.theme.ui.muted, '--bg1': props.theme.bgTop, '--bg2': props.theme.bgBottom,
  '--outline': props.theme.outline, '--line': props.theme.ui.line, '--surround': props.theme.surround,
  '--frame': props.theme.frame,
}))

function measureInset(): void {
  if (!game || !column.value || !hudBar.value) return
  const bottom = hudBar.value.getBoundingClientRect().bottom - column.value.getBoundingClientRect().top
  game.setTopInset(Math.max(0, bottom) + 8)
}

function watchAgain(): void {
  game?.restart()
  game?.start()
}

function focusRunner(index: number): void {
  game?.focusRunner(index)
}

onMounted(() => {
  startMusic()
  if (!column.value || !canvas.value || props.entries.length === 0) {
    failed.value = true
    return
  }
  game = new Game(canvas.value, column.value, props.theme, (state) => { hud.value = state })
  game.load(compileLevel(props.levelData), props.levelKey)
  if (!game.spectate(specs.value)) {
    failed.value = true
    return
  }
  game.restart()
  game.start()
  measureInset()
  insetObs = new ResizeObserver(measureInset)
  insetObs.observe(column.value)
})

onBeforeUnmount(() => {
  insetObs?.disconnect()
  stopMusic()
  game?.dispose()
  game = null
})
</script>

<template>
  <div class="stage" :style="cssVars">
    <div ref="column" class="column">
      <canvas ref="canvas" class="canvas" />
      <div ref="hudBar" class="hud">
        <span class="pill time">{{ formatTicks(hud.ticks) }}</span>
        <span class="pill title">Replay · {{ title }}</span>
        <span class="spacer" />
        <button class="pill btn" type="button" aria-label="Watch again" @click="watchAgain">↻</button>
        <button class="pill btn" type="button" aria-label="Back" @click="emit('exit')">×</button>
      </div>

      <ol class="standings" aria-label="Leaderboard replay">
        <li v-for="row in rows" :key="row.rank" :class="{ done: row.done, focused: hud.focusedRunner === row.index }">
          <button class="runner" type="button" :disabled="row.done || hud.status === 'finished'" :aria-pressed="hud.focusedRunner === row.index" @click="focusRunner(row.index)">
            <span class="dot" :style="{ background: row.color }" />
            <span class="n">{{ row.rank }}</span>
            <span class="nm">{{ row.name }}</span>
            <span class="tm">{{ row.done ? formatTicks(row.ticks) : '' }}</span>
            <span class="bar"><i :style="{ width: row.progress * 100 + '%', background: row.color }" /></span>
          </button>
        </li>
      </ol>
      <div v-if="yourEntry && yourRank && !entries.some(entry => entry.isCurrentUser)" class="your-rank">
        Your rank {{ yourRank }} · {{ formatTicks(yourEntry.ticks) }} · <span aria-label="Deaths"><SkullIcon :size="15" /></span> {{ yourEntry.deaths }}
      </div>

      <div v-if="hud.status === 'ready' && !failed" class="countdown" aria-live="assertive">
        <span :key="hud.countdown">{{ hud.countdown }}</span>
      </div>

      <div v-if="failed" class="result">
        <div class="card">
          <div class="head">Replay not available</div>
          <p class="note">These runs could not be played back.</p>
          <button class="cta" type="button" @click="emit('exit')">Back</button>
        </div>
      </div>

      <div v-if="hud.status === 'finished' && !failed" class="result">
        <div class="card">
          <div class="head">Replay finished</div>
          <ol class="final">
            <li v-for="row in rows" :key="row.rank">
              <span class="dot" :style="{ background: row.color }" />
              <span class="n">{{ row.rank }}</span>
              <span class="nm">{{ row.name }}</span>
              <b class="tm">{{ formatTicks(row.ticks) }}</b>
            </li>
          </ol>
          <div class="actions">
            <button class="cta" type="button" @click="watchAgain">Watch again</button>
            <button class="ghost" type="button" @click="emit('exit')">Back</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.stage { position: fixed; inset: 0; display: flex; justify-content: center; background: var(--surround); touch-action: none; }
.column { position: relative; width: min(100%, 520px, 66.6667dvh); flex: none; height: 100%; overflow: hidden; background: linear-gradient(180deg, var(--bg1), var(--bg2)); box-shadow: 0 0 0 4px var(--frame); }
.canvas { display: block; }
.hud { position: absolute; top: max(10px, env(safe-area-inset-top)); left: 10px; right: 10px; display: flex; gap: 8px; align-items: center; }
.spacer { flex: 1; }
.pill { background: var(--panel); color: var(--text); border: 2px solid var(--line); border-radius: 999px; padding: 6px 14px; font-weight: 800; font-size: 16px; line-height: 1; white-space: nowrap; font-variant-numeric: tabular-nums; }
.time { min-width: 7ch; text-align: center; }
.title { min-width: 0; overflow: hidden; text-overflow: ellipsis; font-size: 13px; color: var(--muted); }
.btn { cursor: pointer; width: 40px; height: 36px; padding: 0; display: grid; place-items: center; font-size: 18px; }
.standings, .final { list-style: none; margin: 0; padding: 0; }
.standings { position: absolute; left: 10px; bottom: max(12px, env(safe-area-inset-bottom)); width: min(250px, 72%); background: var(--panel); border: 2px solid var(--line); border-radius: 14px; padding: 6px 8px; color: var(--text); font-size: 13px; font-weight: 800; opacity: .94; }
.runner, .final li { display: grid; grid-template-columns: 10px 14px 1fr auto; align-items: center; column-gap: 6px; padding: 2px 0; }
.runner { width: 100%; border: 0; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; border-radius: 6px; }
.runner:disabled { cursor: default; }
.focused .runner { background: color-mix(in srgb, var(--accent) 22%, transparent); }
.bar { grid-column: 1 / -1; height: 4px; border-radius: 2px; background: rgba(255,255,255,.14); overflow: hidden; }
.bar i { display: block; height: 100%; }
.dot { width: 10px; height: 10px; border-radius: 50%; border: 1.5px solid var(--outline); }
.n, .tm { color: var(--muted); font-variant-numeric: tabular-nums; }
.nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.your-rank { position: absolute; left: 10px; bottom: max(12px, env(safe-area-inset-bottom)); transform: translateY(calc(100% + 8px)); width: min(250px, 72%); padding: 6px 8px; color: var(--text); background: var(--panel); border: 2px solid var(--line); border-radius: 10px; font-size: 12px; font-weight: 800; }
.countdown { position: absolute; inset: 0; display: grid; place-items: center; pointer-events: none; }
.countdown span { font-size: 120px; font-weight: 900; color: var(--accent); -webkit-text-stroke: 4px var(--outline); paint-order: stroke fill; text-shadow: 6px 6px 0 var(--outline); }
.result { position: absolute; inset: 0; display: flex; overflow-y: auto; background: rgba(10,6,30,.45); padding: 20px; }
.card { width: min(100%, 340px); background: var(--panel); color: var(--text); border: 3px solid var(--line); border-radius: 24px; padding: 22px; text-align: center; box-shadow: 6px 6px 0 var(--outline); margin: auto; }
.head { font-size: 26px; font-weight: 900; color: var(--accent); margin-bottom: 10px; }
.note { color: var(--muted); }
.final { text-align: left; font-weight: 800; margin-bottom: 14px; }
.final li { padding: 6px 4px; border-top: 1.5px dashed rgba(255,255,255,.18); }
.actions { display: flex; gap: 10px; }
.cta, .ghost { flex: 1; cursor: pointer; font-size: 17px; font-weight: 900; border-radius: 14px; padding: 12px 10px; border: 3px solid var(--line); }
.cta { background: var(--accent); color: var(--outline); box-shadow: 3px 3px 0 var(--outline); }
.ghost { background: transparent; color: var(--text); }
</style>
