<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { requestExpandedMode } from '@devvit/web/client'
import CharacterCanvas from './plungee/components/CharacterCanvas.vue'
import { look, applyLook } from './plungee/game/look'
import { MEMPHIS_DARK } from './plungee/game/theme'
import { LEVELS, type LevelEntry } from './plungee/levels'
import type { PostInitResponse } from '../shared/api'
import type { ChallengeVersusResponse } from '../shared/api'
import { compileLevel, formatTicks, LEVEL_WIDTH, TILE, World } from './plungee/sim'
import { selectPreviewStart } from './plungee/game/previewWindow'

const PREVIEW_ROWS = 20

const theme = MEMPHIS_DARK
const colors = computed(() => applyLook(theme, look))

const vars = {
  '--bg1': theme.bgTop,
  '--bg2': theme.bgBottom,
  '--panel': theme.ui.panel,
  '--text': theme.ui.text,
  '--muted': theme.ui.muted,
  '--accent': theme.ui.accent,
  '--outline': theme.outline,
  '--line': theme.ui.line,
  '--c0': theme.decor[0],
  '--c1': theme.decor[1],
  '--c2': theme.decor[2],
  '--c3': theme.decor[3],
  '--creator-ring': theme.decor[0],
  '--decor-shadow': `color-mix(in srgb, ${theme.decorShadow} ${Math.round(theme.decorShadowAlpha * 100)}%, ${theme.bgTop})`,
}

const loading = ref(true)
const error = ref('')
const level = ref<LevelEntry | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
const postKind = ref<PostInitResponse['kind']>()
const replayWeek = ref('')
const targetTicks = ref<number | null>(null)
const closesAt = ref<number | null>(null)
const now = ref(Date.now())
const replaysAvailable = ref(false)
const versus = ref<ChallengeVersusResponse | null>(null)
const creatorImageFailed = ref(false)
const viewerImageFailed = ref(false)
async function loadVersus(): Promise<void> {
  try {
    const response = await fetch('/api/challenge-versus')
    if (response.ok) versus.value = await response.json() as ChallengeVersusResponse
  } catch { /* Keep the challenge playable when profiles are unavailable. */ }
}
let countdownInterval: ReturnType<typeof setInterval> | undefined
const weeklyTimeLeft = computed(() => {
  if (closesAt.value === null) return ''
  const remaining = Math.max(0, closesAt.value - now.value)
  if (remaining === 0) return 'Challenge ended'
  const seconds = Math.ceil(remaining / 1000)
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor(seconds / 3600) % 24
  const minutes = Math.floor(seconds / 60) % 60
  if (days > 0) return `${days}d ${hours}h ${minutes}m left`
  if (hours > 0) return `${hours}h ${minutes}m left`
  return `${minutes}m ${seconds % 60}s left`
})
onBeforeUnmount(() => { if (countdownInterval !== undefined) clearInterval(countdownInterval) })

/** Render a static, representative snapshot with the actual game renderer. */
async function drawPreview(): Promise<void> {
  const c = canvas.value
  const data = level.value?.data
  if (!c || !data) return
  const { Renderer } = await import('./plungee/game/renderer')
  if (canvas.value !== c || level.value?.data !== data) return
  const compiled = compileLevel(data)
  const world = new World(compiled)
  const renderer = new Renderer(c, theme)
  renderer.hidePlayer = true
  renderer.freeCamera = true
  renderer.setLevel(compiled)
  // Match the card's 4:5 crop without stretching the world's proportions.
  renderer.resize(LEVEL_WIDTH, PREVIEW_ROWS * TILE, Math.min(window.devicePixelRatio || 1, 2))
  c.style.removeProperty('width')
  c.style.removeProperty('height')
  renderer.camY = selectPreviewStart(data, PREVIEW_ROWS) * TILE
  // A real simulation timestamp shows hazard phases without running the player.
  world.tick = 60
  renderer.draw(world, 0, false)
}

watch(level, async () => {
  await nextTick()
  await drawPreview()
})

onMounted(async () => {
  try {
    const res = await fetch('/api/init')
    if (!res.ok) throw new Error('Challenge unavailable')

    const data = await res.json() as PostInitResponse
    if (data.kind === 'editor') {
      postKind.value = 'editor'
      return
    }
    const entry = data.kind === 'community' && data.levelData
      ? { key: data.levelKey, title: data.title, data: data.levelData as LevelEntry['data'], difficulty: 'normal' as const, par: null }
      : LEVELS.find(l => l.key === data.levelKey)
    if (!entry) throw new Error('Level missing from this version of Plungee')

    level.value = entry
    postKind.value = data.kind
    replayWeek.value = data.weekId ?? ''
    targetTicks.value = data.targetTicks ?? null
    if (data.kind === 'challenge') void loadVersus()
    closesAt.value = typeof data.closesAt === 'number' && Number.isFinite(data.closesAt) ? data.closesAt : null
    now.value = Date.now()
    if (data.kind === 'weekly' && closesAt.value !== null) {
      countdownInterval = setInterval(() => { now.value = Date.now() }, 1000)
    }
    if (closesAt.value !== null && now.value >= closesAt.value) {
      const response = await fetch('/api/leaderboard')
      if (response.ok) {
        const board = await response.json() as { released: boolean; entries: unknown[] }
        replaysAvailable.value = board.released && board.entries.length > 0
      } else if (data.kind === 'weeklyReplay') throw new Error('Replays are currently unavailable.')
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not load level'
  } finally {
    loading.value = false
  }
})

function play(event: MouseEvent): void {
  // Devvit: direkt aus dem Klick in die erweiterte Ansicht wechseln.
  void requestExpandedMode(event, 'game', { title: 'Plungee' })
}
function watchReplays(event: MouseEvent): void {
  void requestExpandedMode(event, 'replays', { title: 'Plungee Replays' })
}
function openMenu(event: MouseEvent): void {
  void requestExpandedMode(event, 'menu', { title: 'Plungee' })
}
function openEditor(event: MouseEvent): void {
  void requestExpandedMode(event, 'editor', { title: 'Plungee — Build a level' })
}
</script>

<template>
  <main class="preview" :style="vars">
    <button class="menu-button" type="button" aria-label="Main menu" title="Main menu" @click="openMenu">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
    </button>
    <svg
      class="decor"
      viewBox="0 0 1000 650"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <polygon points="65,155 165,315 -35,315" fill="color-mix(in srgb, var(--c0) 55%, var(--bg1))" />
      <path d="M25 475 l35 -40 l35 40 l35 -40 l35 40" fill="none" stroke="color-mix(in srgb, var(--c3) 55%, var(--bg1))" stroke-width="13" stroke-linejoin="round" stroke-linecap="round" />
      <circle cx="940" cy="190" r="58" fill="none" stroke="color-mix(in srgb, var(--c2) 55%, var(--bg1))" stroke-width="16" />
      <polygon points="880,490 990,560 880,625" fill="color-mix(in srgb, var(--c1) 60%, var(--bg1))" />
    </svg>

    <div class="content">
      <div class="brand">
        <div class="brand-copy">
          <h1>PLUNGEE</h1>
          <p class="tagline">Fall fast. Land smart.</p>
        </div>
      </div>

      <template v-if="postKind === 'editor'">
        <button class="play" type="button" @click="openEditor">Build a level</button>
        <div class="level-preview" aria-label="Build your own Plungee level">
          <div class="level-overlay">
            <CharacterCanvas class="preview-character" :colors="colors" :look="look" :size="72" />
            <div class="overlay-copy">
              <h2 class="level-name">Build a level</h2>
              <p class="challenge-question">Create it. Play it.Share it.</p>
            </div>
          </div>
        </div>
      </template>
      <template v-else-if="level">
        <button v-if="postKind === 'weeklyReplay'" class="play" type="button" :disabled="!replaysAvailable" @click="watchReplays">Watch replays</button>
        <button v-else class="play" type="button" @click="play">
          ▶ {{ postKind === 'campaign' ? 'Play Campaign' : postKind === 'challenge' ? 'Accept challenge' : 'Play' }}
        </button>
        <button v-if="replaysAvailable && postKind !== 'weeklyReplay'" class="watch-replays" type="button" @click="watchReplays">Watch replays</button>

        <div class="level-preview" :aria-label="postKind === 'campaign' ? 'Preview of the Plungee campaign' : 'Preview of the challenge level'">
          <canvas ref="canvas" aria-hidden="true" />
          <div class="level-overlay">
            <CharacterCanvas
              v-if="postKind !== 'challenge'"
              class="preview-character"
              :colors="colors"
              :look="look"
              :size="72"
            />
            <div v-else class="challenge-versus" aria-label="Challenge creator versus you">
              <div class="versus-player">
                <div class="versus-avatar creator-avatar">
                  <img v-if="versus?.creator.avatarUrl && !creatorImageFailed" :src="versus.creator.avatarUrl" alt="" @error="creatorImageFailed = true" />
                  <span v-else aria-hidden="true">{{ versus?.creator.username?.charAt(0).toUpperCase() ?? '?' }}</span>
                </div>
                <b :title="versus?.creator.username ?? 'Creator'">{{ versus?.creator.username ?? 'Creator' }}</b>
              </div>
              <strong class="versus-label">VS.</strong>
              <div class="versus-player">
                <div class="versus-avatar viewer-avatar">
                  <img v-if="versus?.viewer.avatarUrl && !viewerImageFailed" :src="versus.viewer.avatarUrl" alt="" @error="viewerImageFailed = true" />
                  <span v-else aria-hidden="true">{{ versus?.viewer.username?.charAt(0).toUpperCase() ?? '?' }}</span>
                </div>
                <b :title="versus?.viewer.username ?? 'You'">{{ versus?.viewer.username ?? 'You' }}</b>
              </div>
            </div>
            <div class="overlay-copy">
              <p v-if="postKind === 'weekly'" class="weekly-label">Weekly Challenge</p>
              <p v-else-if="postKind === 'weeklyReplay'" class="weekly-label">Weekly Replay</p>
              <p class="challenge-question">{{ postKind === 'weeklyReplay' ? 'Watch the top 5 race!' : postKind === 'campaign' ? 'Play the Campaign' : postKind === 'challenge' ? 'Can you beat my time?' : 'Set the fastest time!' }}</p>
              <p v-if="postKind === 'challenge' && targetTicks !== null" class="challenge-target">{{ formatTicks(targetTicks) }}</p>
              <h2 class="level-name">{{ postKind === 'campaign' ? `${LEVELS.length} levels · Easy / Normal / Hard` : level.title }}</h2>
              <p v-if="postKind === 'campaign'" class="weekly-countdown">Choose a level. Earn medals. Beat your best.</p>
              <p v-if="postKind === 'weekly' && weeklyTimeLeft" class="weekly-countdown" role="timer">{{ weeklyTimeLeft }}</p>
              <p v-else-if="postKind === 'weeklyReplay'" class="weekly-countdown">Week of {{ replayWeek }}</p>
            </div>
          </div>
        </div>
        <p v-if="postKind === 'weeklyReplay' && !replaysAvailable" class="status">{{ error || 'No verified replays available for this week.' }}</p>
      </template>

      <p v-else-if="loading" class="status">Loading challenge…</p>
      <template v-else>
        <p role="alert" class="status">{{ error }}</p>
        <button class="play" type="button" @click="play">▶ Play</button>
      </template>

      <p v-if="postKind !== 'editor' && postKind !== 'weeklyReplay'" class="controls">◀ ▶ to move · Gravity does the rest</p>
    </div>
  </main>
</template>
