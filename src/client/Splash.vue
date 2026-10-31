<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { requestExpandedMode } from '@devvit/web/client'
import CharacterCanvas from './plungee/components/CharacterCanvas.vue'
import { look, applyLook } from './plungee/game/look'
import { themeById } from './plungee/game/theme'
import { LEVELS, type LevelEntry } from './plungee/levels'
import type { PostInitResponse } from '../shared/api'

function darkMode(): boolean {
  try {
    const saved = localStorage.getItem('plunge:theme')
    if (saved === 'memphis-dark') return true
    if (saved === 'memphis-light') return false
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  } catch { return false }
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
  '--solid': theme.solid,
  '--c0': theme.decor[0],
  '--c1': theme.decor[1],
  '--c2': theme.decor[2],
  '--c3': theme.decor[3],
  '--decor-shadow': `color-mix(in srgb, ${theme.decorShadow} ${Math.round(theme.decorShadowAlpha * 100)}%, ${theme.bgTop})`,
}
const loading = ref(true)
const error = ref('')
const level = ref<LevelEntry | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
const spawn = computed(() => level.value?.data.entities.find(e => e.t === 'spawn'))

/** Statische Vorschau aus den echten Leveldaten – keine erfundene Levelgrafik oder fremden Assets. */
function drawPreview(): void {
  const c = canvas.value
  const data = level.value?.data
  const ctx = c?.getContext('2d')
  if (!c || !ctx || !data) return
  const tile = 18
  const rows = 15
  c.width = 16 * tile
  c.height = rows * tile
  ctx.clearRect(0, 0, c.width, c.height)
  ctx.fillStyle = theme.bgTop
  ctx.fillRect(0, 0, c.width, c.height)
  for (let y = 0; y < rows; y++) {
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
    if (entity.y >= rows) continue
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
watch(level, async () => { await nextTick(); drawPreview() })
onMounted(async () => {
  try {
    const res = await fetch('/api/init')
    if (!res.ok) throw new Error('Challenge unavailable')
    const data = await res.json() as PostInitResponse
    const entry = LEVELS.find(l => l.key === data.levelKey)
    if (!entry) throw new Error('Level missing from this version of Plungee')
    level.value = entry
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not load level'
  } finally { loading.value = false }
})
function play(event: MouseEvent): void {
  // Devvit requires opening the expanded view synchronously from the user's click.
  void requestExpandedMode(event, 'game', { title: 'Plungee' })
}
</script>

<template>
  <main class="preview" :style="vars">
    <!-- Same motifs and theme roles as the original Plungee menu. -->
    <svg class="decor" viewBox="0 0 400 800" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <polygon points="60,120 110,210 10,210" fill="color-mix(in srgb, var(--c0) 50%, var(--bg1))" />
      <circle cx="330" cy="150" r="34" fill="none" stroke="color-mix(in srgb, var(--c2) 50%, var(--bg1))" stroke-width="10" />
      <path d="M250 330 q15 -22 30 0 t30 0 t30 0 t30 0" fill="none" stroke="color-mix(in srgb, var(--c1) 60%, var(--bg1))" stroke-width="10" stroke-linecap="round" />
      <path d="M30 470 l22 -26 l22 26 l22 -26 l22 26" fill="none" stroke="color-mix(in srgb, var(--c3) 55%, var(--bg1))" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" />
      <g fill="color-mix(in srgb, var(--c2) 55%, var(--bg1))">
        <circle cx="300" cy="560" r="6"/><circle cx="324" cy="560" r="6"/><circle cx="348" cy="560" r="6"/>
        <circle cx="300" cy="584" r="6"/><circle cx="324" cy="584" r="6"/><circle cx="348" cy="584" r="6"/>
      </g>
      <polygon points="90,640 150,690 90,740" fill="color-mix(in srgb, var(--c1) 50%, var(--bg1))" />
      <rect x="320" y="690" width="44" height="44" rx="10" fill="color-mix(in srgb, var(--c0) 45%, var(--bg1))" transform="rotate(14 342 712)" />
      <path d="M200 20 v40 M180 40 h40" stroke="color-mix(in srgb, var(--c3) 50%, var(--bg1))" stroke-width="10" stroke-linecap="round" />
    </svg>

    <div class="content">
      <h1>PLUNGEE</h1>
      <p class="tagline">Fall fast. Land smart.</p>
      <div v-if="level" class="challenge">
        <div class="challenge-head">
          <span>CHALLENGE</span>
          <strong>{{ level.title }}</strong>
        </div>
        <div class="level-preview">
          <canvas ref="canvas" aria-hidden="true" />
          <CharacterCanvas
            v-if="spawn && spawn.y < 15"
            class="runner"
            :style="{ left: `${(spawn.x + 0.5) / 16 * 100}%`, top: `${(spawn.y + 0.5) / 15 * 100}%` }"
            :colors="colors"
            :look="look"
            :size="44"
          />
        </div>
        <p class="challenge-question">Can you beat this level?</p>
      </div>
      <p v-else-if="loading" class="status">Loading challenge…</p>
      <p v-else role="alert" class="status">{{ error }}</p>
      <button class="play" type="button" :disabled="!level" @click="play">▶ Play</button>
      <p class="controls">◀ ▶ to move · Gravity does the rest</p>
    </div>
  </main>
</template>
