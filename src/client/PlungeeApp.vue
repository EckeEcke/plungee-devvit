<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import GameView from './plungee/components/GameView.vue'
import CampaignView from './plungee/components/CampaignView.vue'
import CharacterView from './plungee/components/CharacterView.vue'
import CharacterCanvas from './plungee/components/CharacterCanvas.vue'
import SoundIcon from './plungee/components/SoundIcon.vue'
import { applyLook, look } from './plungee/game/look'
import { ghostSettings } from './plungee/game/ghost'
import { themeById } from './plungee/game/theme'
import { DIFFICULTIES, LEVELS, LEVELS_BY_DIFFICULTY, type Difficulty, type LevelEntry } from './plungee/levels'
import type { ProgressMap } from './plungee/game/progress'
import { loadProgress, recordResult } from './plungee/game/progress'
import { audioSettings } from './plungee/audio/audio'
import { formatTicks } from './plungee/sim'
import type { PostInitResponse, VerifyRunResponse } from '../shared/api'

type Screen = 'loading' | 'postPlay' | 'campaign' | 'campaignPlay' | 'character' | 'menu' | 'error'
const screen = ref<Screen>('loading')
const notice = ref('')
const postLevel = ref<LevelEntry | null>(null)
const redditName = ref<string | null>(null)

function initialDark(): boolean {
  try {
    const saved = localStorage.getItem('plunge:theme')
    if (saved === 'memphis-dark') return true
    if (saved === 'memphis-light') return false
  } catch { /* optional preference */ }
  try { return window.matchMedia('(prefers-color-scheme: dark)').matches }
  catch { return false }
}
const dark = ref(initialDark())
const themeId = computed(() => dark.value ? 'memphis-dark' : 'memphis-light')
const baseTheme = computed(() => themeById(themeId.value))
const theme = computed(() => applyLook(baseTheme.value, look))
watch(themeId, id => {
  try { localStorage.setItem('plunge:theme', id) }
  catch { /* optional preference */ }
})
function loadDifficulty(): Difficulty {
  try {
    const saved = localStorage.getItem('plunge:difficulty')
    if (DIFFICULTIES.some(d => d.id === saved)) return saved as Difficulty
  } catch { /* optional preference */ }
  return 'easy'
}
const difficulty = ref<Difficulty>(loadDifficulty())
watch(difficulty, value => {
  try { localStorage.setItem('plunge:difficulty', value) }
  catch { /* optional preference */ }
})
const playDifficulty = ref<Difficulty>(difficulty.value)
const levelIdx = ref(0)
const progress = ref<ProgressMap>(loadProgress())
const verification = ref('')
let finishRequest = 0

const activeLevel = computed(() => LEVELS_BY_DIFFICULTY[playDifficulty.value][levelIdx.value] ?? null)
const hasNext = computed(() => levelIdx.value + 1 < LEVELS_BY_DIFFICULTY[playDifficulty.value].length)
const postLevelNumber = computed(() => {
  const level = postLevel.value
  return level ? LEVELS_BY_DIFFICULTY[level.difficulty].findIndex(l => l.key === level.key) + 1 : 0
})

async function initialize(): Promise<void> {
  try {
    const response = await fetch('/api/init')
    if (!response.ok) throw new Error('This Plungee post has no available level.')
    const data = await response.json() as PostInitResponse
    const level = LEVELS.find(l => l.key === data.levelKey)
    if (!level) throw new Error('Level missing from this version of Plungee.')
    postLevel.value = level
    redditName.value = data.username
    difficulty.value = level.difficulty
    playDifficulty.value = level.difficulty
    screen.value = 'postPlay' // Reddit post -> directly into challenge
  } catch (error) {
    notice.value = error instanceof Error ? error.message : 'Could not open level.'
    screen.value = 'error'
  }
}
onMounted(() => { void initialize() })

function startLevel(index: number): void {
  playDifficulty.value = difficulty.value
  levelIdx.value = index
  verification.value = ''
  screen.value = 'campaignPlay'
}
function continueCampaign(): void {
  if (postLevel.value) difficulty.value = postLevel.value.difficulty
  screen.value = 'campaign'
}
function onCampaignFinished(run: { ticks: number; deaths: number }): void {
  const level = activeLevel.value
  if (!level) return
  progress.value = recordResult(progress.value, level.key, run.ticks, run.deaths, level.par)
}
async function onPostFinished(run: { ticks: number; deaths: number; replay: string }): Promise<void> {
  const level = postLevel.value
  if (!level) return
  const request = ++finishRequest
  verification.value = 'Verifying replay…'
  try {
    const response = await fetch('/api/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ levelKey: level.key, replay: run.replay }),
    })
    if (!response.ok) throw new Error('Replay could not be verified.')
    const verified = await response.json() as VerifyRunResponse
    if (request !== finishRequest) return
    verification.value = verified.ticks === run.ticks && verified.deaths === run.deaths
      ? `Verified: ${formatTicks(verified.ticks)} · ${verified.deaths} deaths`
      : 'Replay mismatch — result not accepted'
  } catch (error) {
    if (request === finishRequest) verification.value = error instanceof Error ? error.message : 'Verification failed.'
  }
}
const cssVars = computed(() => ({
  '--bg1': theme.value.bgTop,
  '--bg2': theme.value.bgBottom,
  '--panel': theme.value.ui.panel,
  '--text': theme.value.ui.text,
  '--accent': theme.value.ui.accent,
  '--highlight': theme.value.ui.highlight,
  '--muted': theme.value.ui.muted,
  '--player': theme.value.player,
  '--player-shade': theme.value.playerShade,
  '--outline': theme.value.outline,
  '--line': theme.value.ui.line,
  '--solid': theme.value.solid,
  '--danger': theme.value.danger,
  '--help': theme.value.help,
  '--c0': theme.value.decor[0],
  '--c1': theme.value.decor[1],
  '--c2': theme.value.decor[2],
  '--c3': theme.value.decor[3],
  '--decor-shadow': `color-mix(in srgb, ${theme.value.decorShadow} ${Math.round(theme.value.decorShadowAlpha * 100)}%, ${theme.value.bgTop})`,
}))
const menuText = computed(() => theme.value.id === 'memphis-dark' ? '#FFFFFF' : theme.value.solid)
</script>

<template>
  <Transition name="screen" :duration="220">
    <GameView
      v-if="screen === 'postPlay' && postLevel"
      :key="'post:' + postLevel.key"
      :level-data="postLevel.data"
      :level-key="'devvit:post:' + postLevel.key"
      :theme="theme"
      :par="postLevel.par"
      :has-next="true"
      next-text="Continue in Campaign ▶"
      :verification="verification"
      :intro="{ number: postLevelNumber, title: postLevel.title, label: 'Challenge' }"
      exit-icon="▦"
      exit-text="Campaign"
      @exit="continueCampaign"
      @next="continueCampaign"
      @finished="onPostFinished"
    />
    <GameView
      v-else-if="screen === 'campaignPlay' && activeLevel"
      :key="'campaign:' + activeLevel.key"
      :level-data="activeLevel.data"
      :level-key="activeLevel.key"
      :theme="theme"
      :par="activeLevel.par"
      :has-next="hasNext"
      :intro="{ number: levelIdx + 1, title: activeLevel.title }"
      exit-icon="▦"
      exit-text="Level select"
      @exit="screen = 'campaign'"
      @next="startLevel(levelIdx + 1)"
      @finished="onCampaignFinished"
    />
    <CampaignView
      v-else-if="screen === 'campaign'"
      v-model:difficulty="difficulty"
      :theme="theme"
      :progress="progress"
      :focus-key="activeLevel?.key ?? ''"
      @exit="screen = 'menu'"
      @play="startLevel"
    />
    <CharacterView
      v-else-if="screen === 'character'"
      :theme="baseTheme"
      :reddit-name="redditName"
      @exit="screen = 'menu'"
    />
      <main v-else class="menu" :style="{ ...cssVars, '--menu-text': menuText }">
    <svg class="decor" viewBox="0 0 400 800" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <polygon points="60,120 110,210 10,210" fill="color-mix(in srgb, var(--c0) 50%, var(--bg1))" />
      <circle cx="330" cy="150" r="34" fill="none" stroke="color-mix(in srgb, var(--c2) 50%, var(--bg1))" stroke-width="10" />
      <path d="M250 330 q15 -22 30 0 t30 0 t30 0 t30 0" fill="none" stroke="color-mix(in srgb, var(--c1) 60%, var(--bg1))" stroke-width="10" stroke-linecap="round" />
      <path d="M30 470 l22 -26 l22 26 l22 -26 l22 26" fill="none" stroke="color-mix(in srgb, var(--c3) 55%, var(--bg1))" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" />
      <g fill="color-mix(in srgb, var(--c2) 55%, var(--bg1))">
        <circle cx="300" cy="560" r="6" /><circle cx="324" cy="560" r="6" /><circle cx="348" cy="560" r="6" />
        <circle cx="300" cy="584" r="6" /><circle cx="324" cy="584" r="6" /><circle cx="348" cy="584" r="6" />
      </g>
      <polygon points="90,640 150,690 90,740" fill="color-mix(in srgb, var(--c1) 50%, var(--bg1))" />
      <rect x="320" y="690" width="44" height="44" rx="10" fill="color-mix(in srgb, var(--c0) 45%, var(--bg1))" transform="rotate(14 342 712)" />
      <path d="M200 20 v40 M180 40 h40" stroke="color-mix(in srgb, var(--c3) 50%, var(--bg1))" stroke-width="10" stroke-linecap="round" />
    </svg>

    <div class="content">
      <div class="logo">
        <!-- Dieselbe Zeichnung wie im Spiel, mit dem gewählten Aussehen -->
        <CharacterCanvas class="face" :colors="theme" :look="look" :size="104" />
        <h1>PLUNGEE</h1>
        <p>Fall fast. Land smart.</p>
      </div>

      <div v-if="screen === 'menu'" class="buttons">
        <button v-if="screen === 'menu'" class="play" type="button" @click="screen = 'campaign'">Campaign</button>
        <button v-if="screen === 'menu'" class="build" type="button" @click="screen = 'character'">Character</button>
      </div>

      <div v-if="screen === 'menu'" class="snd-row">
        <button
          class="mode"
          type="button"
          role="switch"
          :aria-checked="dark"
          aria-label="Dark mode"
          :title="dark ? 'Switch to light mode' : 'Switch to dark mode'"
          @click="dark = !dark"
        >
          <span class="opt" :class="{ on: !dark }" aria-hidden="true">☀</span>
          <span class="opt" :class="{ on: dark }" aria-hidden="true">☾</span>
        </button>
        <button
          class="snd"
          :class="{ on: audioSettings.music }"
          type="button"
          role="switch"
          :aria-checked="audioSettings.music"
          @click="audioSettings.music = !audioSettings.music"
        >
          <SoundIcon kind="music" :on="audioSettings.music" :size="17" /> Music
        </button>
        <button
          class="snd"
          :class="{ on: audioSettings.sfx }"
          type="button"
          role="switch"
          :aria-checked="audioSettings.sfx"
          @click="audioSettings.sfx = !audioSettings.sfx"
        >
          <SoundIcon kind="sound" :on="audioSettings.sfx" :size="17" /> Sound
        </button>
        <button
          class="snd"
          :class="{ on: ghostSettings.self }"
          type="button"
          role="switch"
          :aria-checked="ghostSettings.self"
          title="Race your own best run as a ghost"
          @click="ghostSettings.self = !ghostSettings.self"
        >
          <svg viewBox="0 0 16 16" width="17" height="17" aria-hidden="true">
            <path
              d="M3 14V7a5 5 0 0 1 10 0v7l-2-1.6L9 14l-1-1.6L7 14l-2-1.6z"
              fill="currentColor"
            />
            <circle cx="6" cy="7" r="1.1" :fill="ghostSettings.self ? 'var(--accent)' : 'var(--bg2)'" />
            <circle cx="10" cy="7" r="1.1" :fill="ghostSettings.self ? 'var(--accent)' : 'var(--bg2)'" />
          </svg>
          Ghost
        </button>
      </div>

      <p v-if="screen === 'loading'" class="status">Loading your challenge…</p>
      <p v-else-if="screen === 'error'" class="status" role="alert">{{ notice }}</p>

      <ul v-if="screen === 'menu'" class="tips">
        <li><b>◀ ▶</b> to move, gravity does the rest</li>
      </ul>
    </div>
  </main>
  </Transition>
</template>

<style scoped>
.notice {
  position: fixed;
  left: 50%;
  bottom: max(24px, env(safe-area-inset-bottom));
  transform: translateX(-50%);
  z-index: 50;
  max-width: min(90vw, 420px);
  padding: 10px 18px;
  font-weight: 800;
  text-align: center;
  color: #fff;
  background: #2b2350;
  border: 3px solid #fff;
  border-radius: 14px;
}

.notice-enter-active,
.notice-leave-active {
  transition: opacity 0.25s;
}

.notice-enter-from,
.notice-leave-to {
  opacity: 0;
}

.menu {
  position: fixed;
  inset: 0;
  display: flex;
  background: linear-gradient(180deg, var(--bg1), var(--bg2));
  color: var(--menu-text);
  /* Auf kleinen Bildschirmen scrollbar; margin: auto am Inhalt zentriert ihn, ohne oben abzuschneiden */
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.decor {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  /* Neo-Brutal: harter Schatten, die Formen sind deckend */
  filter: drop-shadow(5px 5px 0 var(--decor-shadow));
}

.content {
  position: relative;
  margin: auto;
  flex: none;
  width: min(100%, 420px);
  padding: 24px 24px max(32px, env(safe-area-inset-bottom));
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 18px;
}

.logo {
  text-align: center;
}

.face {
  display: inline-block;
  filter: drop-shadow(4px 4px 0 var(--outline));
  animation: bob 1.8s ease-in-out infinite;
}

@keyframes bob {
  0%,
  100% {
    transform: translateY(0) scale(1, 1);
  }
  50% {
    transform: translateY(-8px) scale(0.96, 1.05);
  }
}

h1 {
  margin: 14px 0 4px;
  font-size: clamp(48px, 16vw, 72px);
  font-weight: 900;
  letter-spacing: 3px;
  color: var(--accent);
  -webkit-text-stroke: 3px var(--outline);
  paint-order: stroke fill;
  text-shadow: 5px 5px 0 var(--outline);
}

.logo p {
  margin: 0;
  font-weight: 800;
  font-size: 18px;
}

.play {
  cursor: pointer;
  font-size: 26px;
  font-weight: 900;
  padding: 14px 52px;
  color: var(--outline);
  background: var(--accent);
  border: 4px solid var(--outline);
  border-radius: 20px;
  box-shadow: 5px 5px 0 var(--outline);
}

.play:active {
  transform: translate(3px, 3px);
  box-shadow: 2px 2px 0 var(--outline);
}

.buttons {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
}

.build {
  min-width: 240px;
  cursor: pointer;
  font-size: 18px;
  font-weight: 900;
  padding: 10px 34px;
  color: var(--menu-text);
  /* deckend, damit die Deko dahinter nicht durch den Button scheint */
  background: var(--bg2);
  border: 3px solid var(--line);
  border-radius: 16px;
}

.build:active {
  transform: translate(2px, 2px);
}

.mode {
  cursor: pointer;
  display: flex;
  padding: 2px;
  gap: 2px;
  font: inherit;
  background: var(--panel);
  border: 3px solid var(--line);
  border-radius: 999px;
}

.opt {
  display: grid;
  place-items: center;
  width: 32px;
  height: 28px;
  font-size: 16px;
  line-height: 1;
  font-weight: 800;
  color: var(--muted);
  border-radius: 999px;
}

.opt.on {
  color: var(--outline);
  background: var(--accent);
}

.tips {
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.7;
  text-align: center;
}

.legal-links {
  display: flex;
  justify-content: center;
  gap: 18px;
  font-size: 13px;
  font-weight: 800;
}

.legal-links a {
  color: var(--menu-text);
  opacity: 0.75;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.snd-row {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  gap: 10px;
}

.snd {
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  font: inherit;
  font-size: 14px;
  font-weight: 800;
  color: var(--muted);
  background: var(--bg2);
  border: 3px solid var(--line);
  border-radius: 999px;
}

.snd.on {
  color: var(--outline);
  background: var(--accent);
}

.status { margin: 0; font-weight: 800; text-align: center; color: var(--menu-text); }
</style>
