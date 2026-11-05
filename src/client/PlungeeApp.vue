<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onMounted, ref, watch } from 'vue'
import GameView from './plungee/components/GameView.vue'
const RaceView = defineAsyncComponent(() => import('./plungee/components/RaceView.vue'))
const EditorView = defineAsyncComponent(() => import('./plungee/components/EditorView.vue'))
const ModerationView = defineAsyncComponent(() => import('./plungee/components/ModerationView.vue'))
import CommunityView from './plungee/components/CommunityView.vue'
import { prepareDraft } from './plungee/editor/storage'
import CampaignView from './plungee/components/CampaignView.vue'
import CharacterView from './plungee/components/CharacterView.vue'
import CharacterCanvas from './plungee/components/CharacterCanvas.vue'
import { applyLook, DEFAULT_LOOK, look, sanitizeLook } from './plungee/game/look'
import { MEMPHIS_DARK } from './plungee/game/theme'
import { DIFFICULTIES, LEVELS, LEVELS_BY_DIFFICULTY, type Difficulty, type LevelEntry } from './plungee/levels'
import type { ProgressMap } from './plungee/game/progress'
import { loadProgress, recordResult } from './plungee/game/progress'
import { formatTicks } from './plungee/sim'
import type { LeaderboardResponse, PostInitResponse, VerifyRunResponse } from '../shared/api'
import type { GhostSpec } from './plungee/game/ghost'

type Screen = 'loading' | 'postPlay' | 'replay' | 'campaign' | 'campaignPlay' | 'character' | 'menu' | 'error' | 'editor' | 'community' | 'moderation'
const screen = ref<Screen>('loading')
const moderationAllowed = ref(false)
onMounted(async () => {
  try { moderationAllowed.value = (await fetch('/api/moderation/access')).ok }
  catch { moderationAllowed.value = false }
})
const notice = ref('')
const settingsOpen = ref(false)
const confirmDelete = ref(false)
const deleting = ref(false)
const canPostResult = ref(false)
const resultRunId = ref('')
const resultCommentStatus = ref('')
const resultCommentDraft = ref('')
const postLevel = ref<LevelEntry | null>(null)
const activePostId = ref('')
function postApi(path: string): string {
  return activePostId.value ? `${path}?postId=${encodeURIComponent(activePostId.value)}` : path
}
const postKind = ref<PostInitResponse['kind']>('practice')
const postClosesAt = ref<number | null>(null)
const postWeekId = ref<string | null>(null)
const postClosed = ref(false)
const targetTicks = ref<number | null>(null)
const releasedLeaderboard = ref<LeaderboardResponse | null>(null)

const baseTheme = MEMPHIS_DARK
const theme = computed(() => applyLook(baseTheme, look))
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
const challengeStatus = ref('')
const challengeUrl = ref('')
let finishRequest = 0

const activeLevel = computed(() => LEVELS_BY_DIFFICULTY[playDifficulty.value][levelIdx.value] ?? null)
const hasNext = computed(() => levelIdx.value + 1 < LEVELS_BY_DIFFICULTY[playDifficulty.value].length)
const postLevelNumber = computed(() => {
  const level = postLevel.value
  return level ? LEVELS_BY_DIFFICULTY[level.difficulty].findIndex(l => l.key === level.key) + 1 : 0
})
const releasedGhosts = computed<GhostSpec[]>(() => (releasedLeaderboard.value?.released ? releasedLeaderboard.value.entries : []).map((entry) => ({
  replay: entry.replay,
  label: entry.username ? `#${entry.rank} ${entry.username}` : `#${entry.rank}`,
  look: sanitizeLook(entry.look),
})))
const visibleLeaderboard = computed(() => {
  const response = releasedLeaderboard.value
  if (!response) return []
  const entries = [...response.entries]
  if (response.yourEntry && !entries.some(entry => entry.isCurrentUser)) entries.push(response.yourEntry)
  return entries.sort((a, b) => a.rank - b.rank)
})
const isWeeklyPost = computed(() => postKind.value === 'weekly' || postKind.value === 'weeklyReplay')

async function initialize(): Promise<void> {
  if (window.location.pathname.endsWith('/editor.html')) {
    screen.value = 'menu'
    await openEditor()
    return
  }
  if (window.location.pathname.endsWith('/menu.html')) {
    screen.value = 'menu'
    return
  }
  try {
    const response = await fetch('/api/init')
    if (!response.ok) throw new Error('This Plungee post has no available level.')
    const data = await response.json() as PostInitResponse
    if (data.kind === 'editor') {
      screen.value = 'menu'
      await openEditor()
      return
    }
    const level = data.kind === 'community' && data.levelData
      ? { key: data.levelKey, title: data.title, data: data.levelData as LevelEntry['data'], difficulty: 'normal' as const, par: null }
      : LEVELS.find(l => l.key === data.levelKey)
    if (!level) throw new Error('Level missing from this version of Plungee.')
    postLevel.value = level
    activePostId.value = data.postId
    postKind.value = data.kind ?? 'practice'
    targetTicks.value = data.targetTicks ?? null
    postClosesAt.value = data.closesAt ?? null
    postClosed.value = typeof data.closesAt === 'number' && Date.now() >= data.closesAt
    postWeekId.value = data.weekId ?? null
    if (data.kind === 'campaign') {
      difficulty.value = level.difficulty
      startLevel(LEVELS_BY_DIFFICULTY[level.difficulty].findIndex(candidate => candidate.key === level.key))
      return
    }
    try {
      const leaderboardResponse = await fetch(postApi('/api/leaderboard'))
      if (leaderboardResponse.ok) releasedLeaderboard.value = await leaderboardResponse.json() as LeaderboardResponse
      else if (data.kind === 'weeklyReplay') throw new Error('Replays are currently unavailable.')
    } catch {
      if (data.kind === 'weeklyReplay') throw new Error('Replays are currently unavailable.')
      // A closed leaderboard is optional; the challenge remains playable if it is unavailable.
    }
    difficulty.value = level.difficulty
    playDifficulty.value = level.difficulty
    if (data.kind === 'weeklyReplay') {
      if (releasedLeaderboard.value?.released && releasedLeaderboard.value.entries.length) screen.value = 'replay'
      else { notice.value = 'No verified replays available for this week.'; screen.value = 'menu' }
      return
    }
    screen.value = window.location.pathname.endsWith('/replays.html') && releasedLeaderboard.value?.released && releasedLeaderboard.value.entries.length
      ? 'replay'
      : 'postPlay'
  } catch (error) {
    notice.value = error instanceof Error ? error.message : 'Could not open level.'
    // An unavailable post must not prevent access to the rest of Plungee.
    screen.value = 'menu'
  }
}
onMounted(() => { void initialize() })

function startLevel(index: number): void {
  ++finishRequest
  playDifficulty.value = difficulty.value
  levelIdx.value = index
  verification.value = ''
  challengeStatus.value = ''
  challengeUrl.value = ''
  screen.value = 'campaignPlay'
}
function continueCampaign(): void {
  if (postKind.value === 'community' || postKind.value === 'weekly' || postKind.value === 'challenge') { screen.value = 'menu'; return }
  if (postLevel.value) difficulty.value = postLevel.value.difficulty
  screen.value = 'campaign'
}
async function openEditor(): Promise<void> {
  try {
    await prepareDraft()
    screen.value = 'editor'
  } catch (error) {
    notice.value = error instanceof Error ? error.message : 'Editor unavailable'
  }
}
async function playCommunityPost(id: string): Promise<void> {
  if (!/^t3_[a-z0-9]+$/.test(id)) return
  ++finishRequest
  screen.value = 'loading'
  notice.value = ''
  try {
    const response = await fetch(`/api/init?postId=${encodeURIComponent(id)}`)
    if (!response.ok) throw new Error('Community level unavailable.')
    const data = await response.json() as PostInitResponse
    if (data.kind !== 'community' || !data.levelData) throw new Error('Community level unavailable.')
    postLevel.value = { key: data.levelKey, title: data.title, data: data.levelData as LevelEntry['data'], difficulty: 'normal', par: null }
    activePostId.value = data.postId
    postKind.value = 'community'
    targetTicks.value = null
    postClosesAt.value = data.closesAt ?? null
    postClosed.value = typeof data.closesAt === 'number' && Date.now() >= data.closesAt
    releasedLeaderboard.value = null
    verification.value = ''
    challengeStatus.value = ''
    challengeUrl.value = ''
    canPostResult.value = false
    resultCommentStatus.value = ''
    const board = await fetch(postApi('/api/leaderboard'))
    if (board.ok) releasedLeaderboard.value = await board.json() as LeaderboardResponse
    screen.value = 'postPlay'
  } catch (error) {
    notice.value = error instanceof Error ? error.message : 'Could not open community level.'
    screen.value = 'menu'
  }
}
function watchReplay(): void {
  if (releasedLeaderboard.value?.released && releasedLeaderboard.value.entries.length) screen.value = 'replay'
}
function onCampaignFinished(run: { ticks: number; deaths: number; replay: string }): void {
  const level = activeLevel.value
  if (!level) return
  progress.value = recordResult(progress.value, level.key, run.ticks, run.deaths, level.par)
  void onPostFinished(run)
}
async function onPostFinished(run: { ticks: number; deaths: number; replay: string }): Promise<void> {
  canPostResult.value = false
  resultRunId.value = ''
  resultCommentStatus.value = ''
  resultCommentDraft.value = ''
  const campaign = screen.value === 'campaignPlay'
  const level = campaign ? activeLevel.value : postLevel.value
  if (!level) return
  const request = ++finishRequest
  verification.value = 'Verifying replay…'
  challengeStatus.value = ''
  challengeUrl.value = ''
  try {
    const response = await fetch(campaign ? '/api/verify-campaign' : postApi('/api/verify'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ levelKey: level.key, replay: run.replay, look: { ...look } }),
    })
    if (!response.ok) throw new Error('Replay could not be verified.')
    const verified = await response.json() as VerifyRunResponse
    if (request !== finishRequest) return
    postClosed.value = verified.closed
    canPostResult.value = verified.canPostResult
    resultCommentDraft.value = verified.canPostResult
      ? postKind.value === 'community'
        ? `I finished this Plungee level! My verified time: ${formatTicks(verified.ticks)} · ${verified.deaths === 0 ? 'without dying' : verified.deaths === 1 ? 'only died once' : `${verified.deaths} deaths`}.`
        : `I beat the level in ${formatTicks(verified.ticks)}! ${verified.deaths === 0 ? 'without dying' : verified.deaths === 1 ? 'only died once' : `${verified.deaths} deaths`}`
      : ''
    resultRunId.value = verified.resultRunId ?? ''
    const savedMessage = verified.ticks !== run.ticks || verified.deaths !== run.deaths
      ? 'Replay mismatch — result not accepted'
      : verified.recorded && verified.improved
        ? `Verified and saved: ${formatTicks(verified.ticks)} · ${verified.deaths} deaths`
        : `Verified: ${formatTicks(verified.ticks)} · ${verified.deaths} deaths · personal best unchanged`
    verification.value = verified.ticks === run.ticks && verified.deaths === run.deaths
      ? `Verified: ${formatTicks(verified.ticks)} · ${verified.deaths} deaths`
      : 'Replay mismatch — result not accepted'
    verification.value = savedMessage
    if (campaign) return
    try {
      const leaderboardResponse = await fetch(postApi('/api/leaderboard'))
      if (leaderboardResponse.ok) {
        const board = await leaderboardResponse.json() as LeaderboardResponse
        if (request === finishRequest) releasedLeaderboard.value = board
      }
    } catch { /* The result remains visible if the live board is temporarily unavailable. */ }
  } catch (error) {
    if (request === finishRequest) verification.value = error instanceof Error ? error.message : 'Verification failed.'
  }
}
async function createChallenge(): Promise<void> {
  if (challengeStatus.value === 'Creating challenge…') return
  const sourceScreen = screen.value
  const sourceLevel = sourceScreen === 'campaignPlay' ? activeLevel.value : postLevel.value
  const sourceFinishRequest = finishRequest
  if (!sourceLevel) return
  challengeStatus.value = 'Creating challenge…'
  challengeUrl.value = ''
  try {
    const campaign = screen.value === 'campaignPlay' ? activeLevel.value : null
    const response = await fetch('/api/create-challenge', {
      method: 'POST',
      ...(campaign ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ campaignLevelKey: campaign.key }) } : {}),
    })
    const data = await response.json() as { url?: string; postId?: string; levelKey?: string; error?: string }
    if (sourceFinishRequest !== finishRequest || screen.value !== sourceScreen) return
    if (!response.ok || !data.postId || data.levelKey !== sourceLevel.key) throw new Error(data.error ?? 'Challenge post could not be created for this level.')
    if (!/^t3_[a-z0-9]+$/.test(data.postId)) throw new Error('Invalid challenge post ID.')
    challengeStatus.value = 'Challenge created!'
    challengeUrl.value = `https://www.reddit.com/comments/${data.postId.slice(3)}`
  } catch (error) {
    if (sourceFinishRequest === finishRequest && screen.value === sourceScreen) challengeStatus.value = error instanceof Error ? error.message : 'Challenge creation failed.'
  }
}
function updateResultDraft(text: string): void {
  resultCommentDraft.value = text
}
async function postResultComment(): Promise<void> {
  if (resultCommentStatus.value) return
  resultCommentStatus.value = 'Posting…'
  try {
    const response = await fetch(postApi('/api/result-comment'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resultRunId: resultRunId.value, text: resultCommentDraft.value }),
    })
    const result = await response.json() as { error?: string }
    if (!response.ok) throw new Error(result.error ?? 'Could not post result.')
    resultCommentStatus.value = 'Result posted!'
    canPostResult.value = false
  } catch (error) {
    resultCommentStatus.value = ''
    notice.value = error instanceof Error ? error.message : 'Could not post result.'
    challengeStatus.value = notice.value
  }
}
async function deleteMyData(): Promise<void> {
  if (!confirmDelete.value || deleting.value) return
  deleting.value = true
  try {
    const response = await fetch('/api/my-data', { method: 'DELETE' })
    if (!response.ok) throw new Error('Could not delete your data. Please try again.')
    Object.assign(look, DEFAULT_LOOK)
    progress.value = {}
    releasedLeaderboard.value = null
    canPostResult.value = false
    await nextTick()
    const preferenceKeys = new Set(['plungee:look', 'plunge:progress:v1', 'plungee:audio', 'plunge:theme', 'plunge:difficulty', 'plungee:ghosts', 'plungee:editor-minimap'])
    const localKeys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
    for (const key of localKeys) {
      if (key && (preferenceKeys.has(key) || key.startsWith('plunge:best:') || key.startsWith('plungee:ghost:'))) localStorage.removeItem(key)
    }
    notice.value = 'Your stored game data was deleted. Reddit posts and comments were not deleted.'
    confirmDelete.value = false
  } catch (error) { notice.value = error instanceof Error ? error.message : 'Deletion failed.' }
  finally { deleting.value = false }
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
const menuText = computed(() => theme.value.ui.text)
</script>

<template>
  <Transition name="screen" :duration="220">
    <GameView
      v-if="screen === 'postPlay' && postLevel"
      :key="'post:' + activePostId"
      :level-data="postLevel.data"
      :level-key="'devvit:post:' + activePostId"
      :community-post-id="postKind === 'community' ? activePostId : undefined"
      :theme="theme"
      :par="postLevel.par"
      :has-next="true"
      :next-text="postKind === 'community' || postKind === 'weekly' || postKind === 'challenge' ? 'Main menu' : 'Continue in Campaign ▶'"
      :verification="verification"
      :can-post-result="canPostResult"
      :result-comment-status="resultCommentStatus"
      :result-comment-draft="resultCommentDraft"
      @post-result="postResultComment"
      @update-result-draft="updateResultDraft"
      :allow-challenge="postKind === 'practice'"
      :brag="postKind === 'challenge'"
      :target-ticks="targetTicks"
      :replay-available="Boolean(releasedLeaderboard?.released && releasedLeaderboard?.entries.length)"
      :challenge-url="challengeUrl"
      :challenge-status="challengeStatus"
      :ghosts="releasedGhosts"
      :leaderboard-entries="visibleLeaderboard"
      :challenge-closed="postClosed"
      :intro="{ number: postLevelNumber, title: postLevel.title, label: isWeeklyPost ? 'Weekly Challenge' : postKind === 'community' ? 'Community level' : 'Challenge' }"
      exit-icon="☰"
      exit-text="Main menu"
      @exit="screen = 'menu'"
      @next="continueCampaign"
      @finished="onPostFinished"
      @create-challenge="createChallenge"
      @watch-replay="watchReplay"
      :allow-main-menu="postKind === 'practice'"
    />
    <RaceView
      v-else-if="screen === 'replay' && postLevel && releasedLeaderboard"
      :level-data="postLevel.data"
      :level-key="'replay:' + postLevel.key"
      :title="isWeeklyPost ? `Weekly · ${postLevel.title}` : postLevel.title"
      :theme="theme"
      :entries="releasedLeaderboard.entries"
      :your-rank="releasedLeaderboard.yourRank"
      :your-entry="releasedLeaderboard.yourEntry"
      @exit="screen = postKind === 'weeklyReplay' ? 'menu' : 'postPlay'"
    />
    <GameView
      v-else-if="screen === 'campaignPlay' && activeLevel"
      :key="'campaign:' + activeLevel.key"
      :show-campaign-medal="true"
      :allow-challenge="true"
      :verification="verification"
      :challenge-status="challengeStatus"
      :challenge-url="challengeUrl"
      @create-challenge="createChallenge"
      :level-data="activeLevel.data"
      :level-key="activeLevel.key"
      :theme="theme"
      :par="activeLevel.par"
      :has-next="hasNext"
      :intro="{ number: levelIdx + 1, title: activeLevel.title }"
      exit-icon="☰"
      exit-text="Main menu"
      @exit="screen = 'menu'"
      @next="startLevel(levelIdx + 1)"
      @finished="onCampaignFinished"
      :allow-main-menu="true"
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
    <ModerationView v-else-if="screen === 'moderation'" :theme="theme" @exit="screen = 'menu'" />
    <CommunityView v-else-if="screen === 'community'" :theme="theme" @exit="screen = 'menu'" @play="playCommunityPost" />
    <EditorView v-else-if="screen === 'editor'" :theme="theme" @exit="screen = 'menu'" />
    <CharacterView
      v-else-if="screen === 'character'"
      :theme="baseTheme"
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
        <button class="build" type="button" @click="openEditor">Build a level</button>
        <button class="build" type="button" @click="screen = 'community'">Community levels</button>
      </div>

      <p v-if="screen === 'loading'" class="status">Loading your challenge…</p>
      <p v-else-if="screen === 'error'" class="status" role="alert">{{ notice }}</p>
      <p v-if="screen === 'menu' && notice" class="status" role="alert">{{ notice }}</p>
      <a v-if="screen === 'menu'" class="data-link" href="#delete-data" @click.prevent="settingsOpen = true">Delete saved data</a>
      <a v-if="screen === 'menu' && moderationAllowed" class="data-link" href="#moderation" @click.prevent="screen = 'moderation'">Moderate levels</a>
      <section v-if="screen === 'menu' && settingsOpen" id="delete-data" class="data-settings">
        <h2>Delete my saved data</h2>
        <p>Deletes your scores, replays, saved character snapshots, editor draft and published level data from Plungee. Your community levels will stop being playable. Reddit posts and comments remain.</p>
        <label><input v-model="confirmDelete" type="checkbox" /> I understand this cannot be undone.</label>
        <button class="build" type="button" :disabled="!confirmDelete || deleting" @click="deleteMyData">{{ deleting ? 'Deleting…' : 'Delete my saved data' }}</button>
      </section>

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

.status { margin: 0; font-weight: 800; text-align: center; color: var(--menu-text); }
.data-settings { padding: 16px; color: var(--text); background: var(--panel); border: 2px solid var(--line); border-radius: 16px; }
.data-link { color: var(--menu-text); font-size: 13px; font-weight: 700; text-decoration: underline; text-underline-offset: 3px; }
.data-settings h2 { margin-top: 0; font-size: 18px; }
.data-settings p, .data-settings label { font-size: 14px; line-height: 1.5; }
.data-settings button { margin-top: 16px; min-width: 0; width: 100%; }
</style>
