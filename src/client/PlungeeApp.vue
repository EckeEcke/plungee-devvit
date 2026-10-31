
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import GameView from './plungee/components/GameView.vue'
import CampaignView from './plungee/components/CampaignView.vue'
import CharacterView from './plungee/components/CharacterView.vue'
import PageShell from './plungee/components/PageShell.vue'
import CharacterCanvas from './plungee/components/CharacterCanvas.vue'
import { applyLook, look } from './plungee/game/look'
import { themeById } from './plungee/game/theme'
import { LEVELS, LEVELS_BY_DIFFICULTY, type Difficulty, type LevelEntry } from './plungee/levels'
import type { ProgressMap } from './plungee/game/progress'
import { loadProgress, recordResult } from './plungee/game/progress'
import { audioSettings } from './plungee/audio/audio'
import { formatTicks } from './plungee/sim'
import type { PostInitResponse, VerifyRunResponse } from '../shared/api'

type Screen = 'loading' | 'postPlay' | 'campaign' | 'campaignPlay' | 'character' | 'menu' | 'error'
const screen = ref<Screen>('loading')
const notice = ref('')
const postLevel = ref<LevelEntry | null>(null)
const difficulty = ref<Difficulty>('easy')
const playDifficulty = ref<Difficulty>('easy')
const levelIdx = ref(0)
const progress = ref<ProgressMap>(loadProgress())
const verification = ref('')
let finishRequest = 0

function initialDark(): boolean {
  try { return localStorage.getItem('plunge:theme') === 'memphis-dark' ||
    (localStorage.getItem('plunge:theme') !== 'memphis-light' && window.matchMedia('(prefers-color-scheme: dark)').matches) }
  catch { return true }
}
const dark = ref(initialDark())
const baseTheme = computed(() => themeById(dark.value ? 'memphis-dark' : 'memphis-light'))
const theme = computed(() => applyLook(baseTheme.value, look))
watch(dark, value => {
  try { localStorage.setItem('plunge:theme', value ? 'memphis-dark' : 'memphis-light') }
  catch { /* optional visual preference */ }
})
const activeLevel = computed(() => LEVELS_BY_DIFFICULTY[playDifficulty.value][levelIdx.value] ?? null)
const hasNext = computed(() => levelIdx.value + 1 < LEVELS_BY_DIFFICULTY[playDifficulty.value].length)
const postLevelNumber = computed(() => postLevel.value
  ? LEVELS_BY_DIFFICULTY[postLevel.value.difficulty].findIndex(l => l.key === postLevel.value!.key) + 1
  : 0)

async function initialize(): Promise<void> {
  try {
    const response = await fetch('/api/init')
    if (!response.ok) throw new Error('This Plungee post has no available level.')
    const data = await response.json() as PostInitResponse
    const level = LEVELS.find(l => l.key === data.levelKey)
    if (!level) throw new Error('Level missing from this version of Plungee.')
    postLevel.value = level
    difficulty.value = level.difficulty
    playDifficulty.value = level.difficulty
    screen.value = 'postPlay'
  } catch (e) {
    notice.value = e instanceof Error ? e.message : 'Could not open level.'
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
  const level = postLevel.value
  if (level) difficulty.value = level.difficulty
  screen.value = 'campaign'
}

function onCampaignFinished(run: { ticks: number; deaths: number }): void {
  const level = activeLevel.value
  if (!level) return
  progress.value = recordResult(progress.value, level.key, run.ticks, run.deaths, level.par)
}

async function onPostFinished(run: { ticks: number; deaths: number; replay: string }): Promise<void> {
  if (!postLevel.value) return
  const request = ++finishRequest
  verification.value = 'Verifying replay…'
  try {
    const response = await fetch('/api/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ levelKey: postLevel.value.key, replay: run.replay }),
    })
    if (!response.ok) throw new Error('Replay could not be verified.')
    const verified = await response.json() as VerifyRunResponse
    if (request === finishRequest) verification.value = verified.ticks === run.ticks && verified.deaths === run.deaths
      ? `Verified: ${formatTicks(verified.ticks)} · ${verified.deaths} deaths`
      : 'Replay mismatch — result not accepted'
  } catch (e) {
    if (request === finishRequest) verification.value = e instanceof Error ? e.message : 'Verification failed.'
  }
}
</script>

<template>
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
    @exit="screen = 'menu'"
  />

  <PageShell v-else :theme="theme">
    <main class="landing" :style="{ '--panel': theme.ui.panel, '--text': theme.ui.text, '--muted': theme.ui.muted, '--accent': theme.ui.accent, '--line': theme.ui.line, '--outline': theme.outline }">
      <div class="card">
        <CharacterCanvas :colors="theme" :look="look" :size="108" />
        <h1>PLUNGEE</h1>
        <p v-if="screen === 'loading'">Loading your challenge…</p>
        <p v-else-if="screen === 'error'" role="alert">{{ notice }}</p>
        <p v-else>Fall fast. Land smart.</p>
        <template v-if="screen === 'menu'">
          <button class="primary" type="button" @click="screen = 'campaign'">Campaign</button>
          <button type="button" @click="screen = 'character'">Character</button>
          <button type="button" @click="dark = !dark">{{ dark ? 'Light mode' : 'Dark mode' }}</button>
          <button type="button" @click="audioSettings.music = !audioSettings.music">Music: {{ audioSettings.music ? 'On' : 'Off' }}</button>
        </template>
      </div>
    </main>
  </PageShell>
</template>

<style scoped>
.landing { flex:1; min-height:0; display:grid; place-items:center; padding:20px; overflow-y:auto; }
.card { width:min(100%,400px); display:flex; flex-direction:column; align-items:center; gap:10px; border:3px solid var(--line); border-radius:22px; padding:25px 20px; background:var(--panel); color:var(--text); box-shadow:5px 5px 0 var(--outline); }
h1 { margin:0; font-size:clamp(32px,8vw,48px); color:var(--accent); font-weight:900; }
p { margin:0 0 8px; color:var(--muted); font-weight:700; text-align:center; }
button { width:100%; border:2px solid var(--line); border-radius:12px; padding:10px 14px; background:transparent; color:var(--text); font:inherit; font-weight:900; cursor:pointer; }
button.primary { background:var(--accent); color:var(--outline); border-color:var(--outline); }
</style>
