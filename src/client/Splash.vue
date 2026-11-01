<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { requestExpandedMode } from '@devvit/web/client'
import CharacterCanvas from './plungee/components/CharacterCanvas.vue'
import { look, applyLook } from './plungee/game/look'
import { themeById } from './plungee/game/theme'
import { LEVELS, type LevelEntry } from './plungee/levels'
import type { PostInitResponse } from '../shared/api'
import type { ChallengeVersusResponse } from '../shared/api'
import { formatTicks } from './plungee/sim'

const PREVIEW_ROWS = 16

function darkMode(): boolean {
  try {
    const saved = localStorage.getItem('plunge:theme')
    if (saved === 'memphis-dark') return true
    if (saved === 'memphis-light') return false
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  } catch {
    return false
  }
}

const theme = themeById(darkMode() ? 'memphis-dark' : 'memphis-light')
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
  '--creator-ring': theme.id === 'memphis-dark' ? theme.decor[0] : theme.decor[3],
  '--decor-shadow': `color-mix(in srgb, ${theme.decorShadow} ${Math.round(theme.decorShadowAlpha * 100)}%, ${theme.bgTop})`,
}

const loading = ref(true)
const error = ref('')
const level = ref<LevelEntry | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
const postKind = ref<PostInitResponse['kind']>()
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

/** Vorschau direkt aus den echten Leveldaten. */
function drawPreview(): void {
  const c = canvas.value
  const data = level.value?.data
  const ctx = c?.getContext('2d')
  if (!c || !ctx || !data) return

  const tile = 14
  c.width = 16 * tile
  c.height = PREVIEW_ROWS * tile
  ctx.clearRect(0, 0, c.width, c.height)
  ctx.fillStyle = theme.bgTop
  ctx.fillRect(0, 0, c.width, c.height)

  for (let y = 0; y < PREVIEW_ROWS; y++) {
    const line = data.tiles[y] ?? ''
    for (let x = 0; x < 16; x++) {
      if (line[x] !== '#') continue

      ctx.fillStyle = theme.solid
      ctx.fillRect(x * tile, y * tile, tile, tile)

      if (y === 0 || data.tiles[y - 1]?.[x] !== '#') {
        ctx.fillStyle = theme.solidTop
        ctx.fillRect(x * tile, y * tile, tile, 4)
      }

      ctx.fillStyle = theme.solidShade
      ctx.fillRect(x * tile + tile - 3, y * tile + 4, 3, tile - 4)
    }
  }

  for (const entity of data.entities) {
    if (entity.y >= PREVIEW_ROWS) continue
    const px = entity.x * tile
    const py = entity.y * tile

    if (entity.t === 'spikes') {
      ctx.fillStyle = theme.danger
      ctx.beginPath()
      if (entity.dir === 'u') {
        ctx.moveTo(px + 1, py + tile)
        ctx.lineTo(px + tile / 2, py + 3)
        ctx.lineTo(px + tile - 1, py + tile)
      } else if (entity.dir === 'd') {
        ctx.moveTo(px + 1, py)
        ctx.lineTo(px + tile / 2, py + tile - 3)
        ctx.lineTo(px + tile - 1, py)
      } else if (entity.dir === 'l') {
        ctx.moveTo(px + tile, py + 1)
        ctx.lineTo(px + 3, py + tile / 2)
        ctx.lineTo(px + tile, py + tile - 1)
      } else {
        ctx.moveTo(px, py + 1)
        ctx.lineTo(px + tile - 3, py + tile / 2)
        ctx.lineTo(px, py + tile - 1)
      }
      ctx.closePath()
      ctx.fill()
    } else if (entity.t === 'spring') {
      ctx.fillStyle = theme.help
      ctx.fillRect(px + 2, py + tile - 6, tile - 4, 5)
    } else if (entity.t === 'goal') {
      ctx.fillStyle = theme.goal
      ctx.fillRect(px + 3, py + 3, tile - 6, tile - 6)
    }
  }
}

watch(level, async () => {
  await nextTick()
  drawPreview()
})

onMounted(async () => {
  try {
    const res = await fetch('/api/init')
    if (!res.ok) throw new Error('Challenge unavailable')

    const data = await res.json() as PostInitResponse
    const entry = data.kind === 'community' && data.levelData
      ? { key: data.levelKey, title: data.title, data: data.levelData as LevelEntry['data'], difficulty: 'normal' as const, par: null }
      : LEVELS.find(l => l.key === data.levelKey)
    if (!entry) throw new Error('Level missing from this version of Plungee')

    level.value = entry
    postKind.value = data.kind
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
      }
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
</script>

<template>
  <main class="preview" :style="vars">
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

      <template v-if="level">
        <button class="play" type="button" @click="play">
          ▶ Play
        </button>
        <button v-if="replaysAvailable" class="watch-replays" type="button" @click="watchReplays">Watch replays</button>

        <div class="level-preview" aria-label="Preview of the challenge level">
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
              <p class="challenge-question">{{ postKind === 'challenge' ? 'Can you beat my time?' : 'Set the fastest time!' }}</p>
              <p v-if="postKind === 'challenge' && targetTicks !== null" class="challenge-target">{{ formatTicks(targetTicks) }}</p>
              <h2 class="level-name">{{ level.title }}</h2>
              <p v-if="postKind === 'weekly' && weeklyTimeLeft" class="weekly-countdown" role="timer">{{ weeklyTimeLeft }}</p>
            </div>
          </div>
        </div>
      </template>

      <p v-else-if="loading" class="status">Loading challenge…</p>
      <p v-else role="alert" class="status">{{ error }}</p>

      <p class="controls">◀ ▶ to move · Gravity does the rest</p>
    </div>
  </main>
</template>
