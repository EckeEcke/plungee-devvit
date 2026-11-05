<script setup lang="ts">
import { audioSettings, playSfx, startMusic, stopMusic, toggleAllSound } from '../audio/audio'
import SoundIcon from './SoundIcon.vue'
import SkullIcon from './SkullIcon.vue'
import MedalIcon from './MedalIcon.vue'
import { medalFor } from '../game/medals'
import { consumeControlsHint } from '../game/hintSeen'
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { Game, type HudState } from '../game/game'
import { communityTracker } from '../game/community-stats'
import type { GhostSpec } from '../game/ghost'
import type { Theme } from '../game/theme'
import type { LeaderboardEntry } from '../../../shared/api'
import { compileLevel, formatTicks, TICK_RATE, type LevelData } from '../sim'

const props = withDefaults(
  defineProps<{
    levelData: LevelData
    levelKey: string
    communityPostId?: string
    theme: Theme
    exitIcon?: string
    exitText?: string
    par?: number | null
    showCampaignMedal?: boolean
    hasNext?: boolean
    intro?: { number: number; title: string; label?: string } | null
    nextText?: string
    verification?: string
    allowChallenge?: boolean
    replayAvailable?: boolean
    challengeUrl?: string
    challengeStatus?: string
    leaderboardEntries?: LeaderboardEntry[]
    challengeClosed?: boolean
    allowMainMenu?: boolean
    canPublishLevel?: boolean
    canPostResult?: boolean
    brag?: boolean
    targetTicks?: number | null
    resultCommentStatus?: string
    resultCommentDraft?: string
    /** Zusätzliche Ghosts (Top 5 eines Community-Levels) */
    ghosts?: GhostSpec[]
  }>(),
  { exitIcon: '☰', exitText: 'Menu', par: null, hasNext: false, intro: null, nextText: 'Next level ▶', verification: '', allowChallenge: false, replayAvailable: false, challengeUrl: '', challengeStatus: '', leaderboardEntries: () => [], ghosts: () => [] },
)
const emit = defineEmits<{
  exit: []
  next: []
  finished: [result: { ticks: number; deaths: number; replay: string }]
  createChallenge: []
  watchReplay: []
  postResult: []
  updateResultDraft: [text: string]
  publishLevel: []
}>()

const column = ref<HTMLElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
const hudBar = ref<HTMLElement | null>(null)
const hud = shallowRef<HudState>({
  status: 'ready',
  started: false,
  ticks: 0,
  deaths: 0,
  progress: 0,
  countdown: 3,
  bestTicks: null,
  newBest: false,
  replay: '',
  race: [],
  focusedRunner: null,
})
let game: Game | null = null

const cssVars = computed(() => ({
  '--panel': props.theme.ui.panel,
  '--text': props.theme.ui.text,
  '--accent': props.theme.ui.accent,
  '--success': props.theme.ui.success,
  '--danger': props.theme.danger,
  '--highlight': props.theme.ui.highlight,
  '--muted': props.theme.ui.muted,
  '--player': props.theme.player,
  '--bg1': props.theme.bgTop,
  '--bg2': props.theme.bgBottom,
  '--outline': props.theme.outline,
  '--line': props.theme.ui.line,
  '--surround': props.theme.surround,
  '--frame': props.theme.frame,
}))

const timeText = computed(() => formatTicks(hud.value.ticks))
const timeDifference = computed(() => {
  if (props.targetTicks == null) return null
  const ticks = hud.value.ticks - props.targetTicks
  return { ticks, text: `${ticks < 0 ? '−' : ticks > 0 ? '+' : ''}${(Math.abs(ticks) / TICK_RATE).toFixed(2)} s` }
})
const campaignMedal = computed(() => props.showCampaignMedal && hud.value.status === 'finished'
  ? medalFor(hud.value.ticks, hud.value.deaths, props.par) : null)
const medalLabels = { gold: 'Gold', silver: 'Silver', bronze: 'Bronze' } as const
const showNewBest = computed(() => props.showCampaignMedal === true && hud.value.newBest)
const challengeReady = computed(() => props.verification.startsWith('Verified'))
const challengePending = computed(() => !props.verification || props.verification.startsWith('Verifying'))
let feedbackTimer = 0
let feedbackPlayed = false
const targets = ref({ gold: 0, silver: 0 })
/** Local best time on this device; server verification is shown separately. */
// Steuerung nur im ersten Level der Sitzung zeigen
const requiresStart = consumeControlsHint()
const showStart = computed(() => requiresStart && hud.value.status === 'ready' && !hud.value.started)

/** Unterkante der Bedienleiste (plus etwas Luft) gemessen, damit das Level darunter beginnt und die Figur oben nie verdeckt wird */
const HUD_GAP_PX = 8
let insetObs: ResizeObserver | null = null
function measureInset(): void {
  if (!game || !column.value || !hudBar.value) return
  const bottom = hudBar.value.getBoundingClientRect().bottom - column.value.getBoundingClientRect().top
  game.setTopInset(Math.max(0, bottom) + HUD_GAP_PX)
}

onMounted(() => {
  startMusic()
  if (!column.value || !canvas.value) return
  game = new Game(canvas.value, column.value, props.theme, (h) => {
    hud.value = h
  })
  if (props.communityPostId) game.onRunActivity = communityTracker(props.communityPostId)
  measureInset()
  game.load(compileLevel(props.levelData), props.levelKey)
  if (props.ghosts.length > 0) {
    game.setGhosts(props.ghosts)
    game.restart()
  }
  if (!requiresStart) game.start()
  insetObs = new ResizeObserver(measureInset)
  insetObs.observe(column.value)
})

onBeforeUnmount(() => {
  window.clearTimeout(feedbackTimer)
  insetObs?.disconnect()
  insetObs = null
  stopMusic()
  game?.dispose()
  game = null
})

watch(
  () => props.theme,
  (t) => game?.setTheme(t),
)

watch(
  () => hud.value.status,
  (status, prev) => {
    if (status === 'finished' && prev !== 'finished') {
      emit('finished', { ticks: hud.value.ticks, deaths: hud.value.deaths, replay: hud.value.replay })
    }
  },
)

// Feedback belongs to the visible achievement, never to a hidden local post best.
watch(
  () => [hud.value.status, showNewBest.value, props.brag && props.canPostResult && challengeReady.value] as const,
  ([status, campaignBest, bragReady]) => {
    if (status !== 'finished') {
      window.clearTimeout(feedbackTimer)
      feedbackPlayed = false
      return
    }
    if (feedbackPlayed) return
    if (campaignBest) {
      feedbackPlayed = true
      feedbackTimer = window.setTimeout(() => playSfx('newBest'), 700)
    } else if (bragReady) {
      feedbackPlayed = true
      playSfx('newBest')
    }
  },
  { flush: 'post' },
)

function restart(): void {
  game?.restart()
}

function startGame(): void {
  column.value?.focus()
  game?.start()
}

const shareError = ref('')
async function shareChallenge(): Promise<void> {
  shareError.value = ''
  const match = props.challengeUrl.match(/^https:\/\/www\.reddit\.com\/comments\/([a-z0-9]+)\/?$/i)
  if (!match) {
    shareError.value = 'Challenge not available to share.'
    return
  }
  const url = `https://www.reddit.com/comments/${match[1]}`
  try {
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ url, title: 'Plungee challenge', text: 'Can you beat my time?' })
        return
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
      }
    }
    await navigator.clipboard.writeText(url)
  } catch {
    shareError.value = 'Could not share challenge. Please try again.'
  }
}

</script>

<template>
  <div class="stage" :style="cssVars">
    <div ref="column" class="column" tabindex="-1">
      <canvas ref="canvas" class="canvas" />

      <div ref="hudBar" class="hud" :class="{ 'with-target': targetTicks != null }" data-noinput>
        <div class="pill time">{{ timeText }}</div>
        <div class="pill deaths" title="Deaths" :aria-label="`${hud.deaths} deaths`"><SkullIcon :size="17" /> {{ hud.deaths }}</div>
        <div class="spacer" />
        <button
          class="pill btn"
          type="button"
          :aria-label="audioSettings.sfx || audioSettings.music ? 'Mute' : 'Unmute'"
          @click="toggleAllSound"
        >
          <SoundIcon :on="audioSettings.sfx || audioSettings.music" :size="18" />
        </button>
        <button class="pill btn" type="button" aria-label="Restart" @click="restart">↻</button>
        <button class="pill btn" type="button" :aria-label="exitText" @click="emit('exit')">{{ exitIcon }}</button>
        <div v-if="targetTicks != null" class="target-time">Time to beat: <b>{{ formatTicks(targetTicks) }}</b></div>
      </div>

      <div class="progress" aria-hidden="true">
        <div class="progress-fill" :style="{ height: hud.progress * 100 + '%' }" />
        <div class="progress-dot" :style="{ top: hud.progress * 100 + '%' }" />
      </div>

      <Transition name="fadeout">
        <div v-if="intro && hud.status === 'ready' && !hud.started" class="intro" aria-hidden="true">
          <small>{{ intro.label ?? (intro.number > 0 ? 'Level ' + intro.number : 'Community level') }}</small>
          <b>{{ intro.title }}</b>
        </div>
      </Transition>

      <div v-if="showStart" class="start-overlay" data-noinput>
        <div class="start-controls">
          <button class="start-button" type="button" aria-describedby="start-controls-hint" @click="startGame">Start</button>
          <div id="start-controls-hint" class="hint">
            ◀ ▶ or A / D · or hold left / right side · R = restart
          </div>
        </div>
      </div>

      <div v-if="hud.status === 'ready' && hud.started" class="countdown" aria-live="assertive">
        <span :key="hud.countdown">{{ hud.countdown }}</span>
      </div>

      <Transition name="result">
      <div v-if="hud.status === 'finished'" class="result" data-noinput>
        <div class="card">
          <div class="title">Finished!</div>
          <p v-if="targetTicks != null" class="result-target">Time to beat: {{ formatTicks(targetTicks) }}</p>
          <div class="big">{{ timeText }}</div>
          <p v-if="challengeClosed" class="closed-note">Challenge ended · Practice only</p>
          <div v-if="false" class="goals">
            <span>Gold with no deaths ≤ {{ formatTicks(targets.gold) }}</span>
            <span>Silver ≤ {{ formatTicks(targets.silver) }}</span>
          </div>
          <div class="result-deaths">
            <span class="death-label" aria-label="Deaths"><SkullIcon :size="17" /></span><b>{{ hud.deaths }}</b>
            <template v-if="timeDifference">
              <span class="result-separator" aria-hidden="true">|</span>
              <span class="time-difference" :class="{ faster: timeDifference.ticks < 0, slower: timeDifference.ticks > 0 }">{{ timeDifference.text }}</span>
            </template>
          </div>
          <div v-if="campaignMedal" class="medal">
            <MedalIcon :medal="campaignMedal" :size="34" />
            <b>{{ medalLabels[campaignMedal] }}</b>
          </div>
          <div v-if="showNewBest" class="badges">
            <div v-if="showNewBest" class="badge">
              <i v-for="n in 8" :key="n" class="spark" :style="{ '--a': n * 45 + 'deg' }" aria-hidden="true" />
              <span class="badge-text">★ New best!</span>
            </div>
          </div>
          <div v-if="leaderboardEntries.length" class="live-leaderboard">
            <h3>Leaderboard</h3>
            <div v-for="entry in leaderboardEntries" :key="entry.rank + ':' + entry.username" class="leaderboard-row" :class="{ current: entry.isCurrentUser }">
              <b>{{ entry.rank }}</b>
              <span>{{ entry.isCurrentUser ? 'You' : (entry.username ?? 'Deleted user') }}</span>
              <span class="leaderboard-stats"><span>{{ formatTicks(entry.ticks) }}</span><span aria-hidden="true">·</span><span class="leaderboard-deaths" :aria-label="`${entry.deaths} deaths`"><SkullIcon :size="15" />{{ entry.deaths }}</span></span>
            </div>
          </div>
          <div v-if="allowChallenge" class="challenge-action-slot" :aria-busy="challengePending">
            <button
              class="ghost challenge"
              :class="{ 'pending-action': !challengeReady || Boolean(challengeUrl) || challengeStatus === 'Creating challenge…' }"
              :disabled="!challengeReady || Boolean(challengeUrl) || challengeStatus === 'Creating challenge…'"
              type="button"
              @click="emit('createChallenge')"
            >{{ challengeStatus && !challengeUrl && challengeStatus !== 'Creating challenge…' ? challengeStatus + ' — Retry' : 'Create challenge post' }}</button>
            <div v-if="!challengeReady && !challengeUrl" class="challenge-action-state" role="status">
              <template v-if="challengePending"><span class="verification-spinner" aria-hidden="true" /><span>Checking run…</span></template>
              <span v-else>{{ verification }}</span>
            </div>
          <div v-if="challengeUrl || (challengeReady && challengeStatus === 'Creating challenge…')" class="challenge-feedback" role="status">
            <div v-if="challengeUrl" class="challenge-created">
              <b class="challenge-created-label"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>Challenge created</b>
              <button class="ghost share-icon" type="button" aria-label="Share challenge" title="Share challenge" @click="shareChallenge"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m8.6 10.5 6.8-4m-6.8 7 6.8 4" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="5" r="3" /><circle cx="18" cy="19" r="3" /></svg></button>
            </div>
            <b v-else>{{ challengeStatus }}</b>
            <span v-if="shareError" role="alert">{{ shareError }}</span>
          </div>
          </div>
          <button v-if="replayAvailable" class="ghost replay-action" type="button" @click="emit('watchReplay')">Watch top-5 replay</button>
          <button v-if="canPublishLevel" class="ghost challenge" type="button" @click="emit('publishLevel')">Publish level</button>
          <div v-if="canPostResult || resultCommentStatus" class="result-action-slot" :class="{ 'brag-slot': brag }" :aria-busy="resultCommentStatus === 'Posting…'">
            <template v-if="canPostResult">
              <label class="result-comment-label" for="result-comment">Comment</label>
              <textarea id="result-comment" class="result-comment-input" :value="resultCommentDraft ?? ''" maxlength="500" rows="3" @input="emit('updateResultDraft', ($event.target as HTMLTextAreaElement).value)" />
            </template>
            <button :class="[brag ? 'ghost challenge brag-pop' : 'ghost replay-action', { 'pending-action': Boolean(resultCommentStatus) }]" type="button" :disabled="Boolean(resultCommentStatus)" @click="emit('postResult')">Post my result</button>
            <div v-if="resultCommentStatus" class="challenge-action-state" :class="{ 'result-posted': resultCommentStatus === 'Result posted!' }" role="status">
              <span v-if="resultCommentStatus === 'Posting…'" class="verification-spinner" aria-hidden="true" />
              <svg v-else width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>
              <span>{{ resultCommentStatus }}</span>
            </div>
          </div>
          <div class="actions">
            <button :class="allowChallenge || canPublishLevel || (brag && (canPostResult || resultCommentStatus)) ? 'ghost' : 'cta'" type="button" @click="restart">{{ challengeClosed ? 'Practice' : 'Improve' }}</button>
            <button v-if="!hasNext" class="ghost" type="button" @click="emit('exit')">{{ exitText }}</button>
          </div>
          <button v-if="hasNext" class="ghost next" type="button" @click="emit('next')">{{ nextText }}</button>
          <button v-if="allowMainMenu && hasNext" class="ghost next" type="button" @click="emit('exit')">Main menu</button>
        </div>
      </div>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.stage {
  position: fixed;
  inset: 0;
  display: flex;
  justify-content: center;
  /* Neben dem Spielfeld (Desktop, Tablet quer): ruhige, dunklere Fläche statt Spielfeldfarbe */
  background: var(--surround);
  touch-action: none;
}

.column {
  position: relative;
  /* Keep the playable viewport portrait (at most 2:3), including desktop webviews. */
  width: min(100%, 520px, 66.6667dvh);
  flex: none;
  height: 100%;
  touch-action: none;
  overflow: hidden;
  background: linear-gradient(180deg, var(--bg1), var(--bg2));
  /* Rahmenlinie: wird nur sichtbar, wenn neben dem Spielfeld Platz ist (auf Handys füllt es den Bildschirm) */
  box-shadow: 0 0 0 4px var(--frame);
}

.canvas {
  display: block;
  touch-action: none;
}

.hud {
  position: absolute;
  top: max(10px, env(safe-area-inset-top));
  left: 10px;
  right: 22px;
  display: flex;
  gap: 8px;
  align-items: center;
  pointer-events: none;
}


.spacer {
  flex: 1;
}

.pill {
  background: var(--panel);
  color: var(--text);
  border: 2px solid var(--line);
  border-radius: 999px;
  padding: 6px 14px;
  font-weight: 800;
  font-size: 16px;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  /* nie umbrechen oder schrumpfen: sonst rutscht die Zahl hinter dem ✕ in eine zweite Zeile */
  white-space: nowrap;
  flex: none;
}

.time {
  font-size: 20px;
  /* feste Breite: sonst ändert sich das Pill mit jeder Stelle der Zeit (0.00 → 10.00 → 1:05.00) und flackert.
     7ch reicht für alle Formate bis 10:00.00, weil ':' und '.' schmaler sind als eine Ziffer (tabular-nums) */
  box-sizing: content-box;
  width: 7ch;
  text-align: center;
}

.deaths {
  color: var(--accent);
}

.btn {
  pointer-events: auto;
  cursor: pointer;
  width: 40px;
  height: 36px;
  padding: 0;
  display: grid;
  place-items: center;
  font-size: 18px;
}

.btn:active {
  transform: translateY(1px);
}

.progress {
  position: absolute;
  top: 64px;
  bottom: 24px;
  right: 8px;
  width: 4px;
  border-radius: 4px;
  /* durchscheinend, damit das Spielfeld dahinter sichtbar bleibt */
  background: rgba(255, 255, 255, 0.22);
  border: 1px solid rgba(0, 0, 0, 0.28);
  opacity: 0.6;
  overflow: visible;
  pointer-events: none;
}

.progress-fill {
  width: 100%;
  background: var(--accent);
  border-radius: 6px;
  opacity: 0.55;
}

.progress-dot {
  position: absolute;
  left: 50%;
  width: 11px;
  height: 11px;
  margin: -5.5px 0 0 -5.5px;
  border-radius: 50%;
  background: var(--player);
  border: 2px solid var(--outline);
}

.intro {
  position: absolute;
  left: 50%;
  /* Direkt über dem Start-Button, mit kompaktigem Abstand. */
  bottom: calc(50% + 55px);
  transform: translateX(-50%);
  width: max-content;
  max-width: calc(100% - 40px);
  text-align: center;
  padding: 10px 22px 12px;
  background: var(--panel);
  color: var(--text);
  border: 3px solid var(--line);
  border-radius: 20px;
  box-shadow: 5px 5px 0 var(--outline);
  pointer-events: none;
  animation: intro-in 0.35s ease-out;
}

.intro small {
  display: block;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 1px;
  text-transform: uppercase;
  color: var(--muted);
}

.intro b {
  font-size: 24px;
  font-weight: 900;
  color: var(--accent);
}

.start-overlay {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  pointer-events: none;
}

.start-button {
  pointer-events: auto;
  cursor: pointer;
  min-width: 180px;
  padding: 14px 30px;
  font: inherit;
  font-size: 24px;
  font-weight: 900;
  color: var(--outline);
  background: var(--accent);
  border: 4px solid var(--outline);
  border-radius: 16px;
  box-shadow: 5px 5px 0 var(--outline);
}

.start-controls {
  position: relative;
  width: min(420px, calc(100% - 32px));
  text-align: center;
}

.start-button:active {
  transform: translate(3px, 3px);
  box-shadow: 2px 2px 0 var(--outline);
}

.start-button:focus-visible {
  outline: 3px solid var(--text);
  outline-offset: 5px;
}

@keyframes intro-in {
  from {
    opacity: 0;
    transform: translateX(-50%) translateY(12px);
  }
  to {
    opacity: 1;
    transform: translateX(-50%);
  }
}

.countdown {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  pointer-events: none;
}

.countdown span {
  font-size: 120px;
  font-weight: 900;
  color: var(--accent);
  -webkit-text-stroke: 4px var(--outline);
  paint-order: stroke fill;
  text-shadow: 6px 6px 0 var(--outline);
  animation: pop 0.65s ease-out;
}

@keyframes pop {
  0% {
    transform: scale(1.6);
    opacity: 0;
  }
  35% {
    transform: scale(1);
    opacity: 1;
  }
  100% {
    transform: scale(0.9);
    opacity: 0.85;
  }
}

.hint {
  position: absolute;
  left: 50%;
  top: calc(100% + 16px);
  transform: translateX(-50%);
  width: max-content;
  max-width: 100%;
  text-align: center;
  background: var(--panel);
  color: var(--muted);
  border-radius: 12px;
  padding: 8px 12px;
  font-size: 13px;
  font-weight: 700;
  pointer-events: none;
}

.result {
  position: absolute;
  inset: 0;
  display: flex;
  /* Passt das Fenster nicht auf den Bildschirm, scrollt es von oben statt oben abgeschnitten zu werden */
  overflow-y: auto;
  background: rgba(10, 6, 30, 0.45);
  padding: 20px;
  animation: fade 0.25s ease-out;
}
.live-leaderboard { margin: 16px 0 24px; padding-top: 10px; text-align: left; }
.death-label, .pill.deaths { display: inline-flex; align-items: center; gap: 5px; }
.result-deaths { display: flex; align-items: center; justify-content: center; gap: 6px; margin: 2px 0 18px; color: var(--muted); font-size: 16px; }
.result-deaths b { color: var(--text); }
.hud.with-target { flex-wrap: wrap; }
.target-time { flex: 0 0 100%; text-align: center; color: var(--text); font-size: 14px; font-weight: 800; }
.target-time b { color: var(--accent); font-variant-numeric: tabular-nums; }
.result-target { margin: 0 0 4px; color: var(--muted); font-size: 14px; font-weight: 800; }
.result-separator { margin-inline: 6px; color: var(--muted); }
.time-difference { color: var(--muted); font-size: 18px; font-weight: 900; font-variant-numeric: tabular-nums; }
.time-difference.faster { color: var(--success); }
.time-difference.slower { color: var(--danger); }
.death-label :deep(svg), .pill.deaths :deep(svg) { display: block; flex: none; }
.leaderboard-stats, .leaderboard-deaths { display: inline-flex; align-items: center; gap: 4px; font-variant-numeric: tabular-nums; }
.leaderboard-deaths :deep(svg) { display: block; flex: none; }
.closed-note { margin: 8px 0; color: var(--muted); font-size: 13px; font-weight: 800; }
.live-leaderboard h3 { margin: 0 0 6px; color: var(--accent); font-size: 16px; text-align: center; }
.leaderboard-row { display: grid; grid-template-columns: 34px 1fr auto; gap: 6px; padding: 4px 0; color: var(--muted); font-size: 12px; font-weight: 800; }
.leaderboard-row.current { color: var(--outline); background: var(--highlight); border-radius: 7px; padding-left: 6px; padding-right: 6px; }

@keyframes fade {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.card {
  width: min(100%, 340px);
  background: var(--panel);
  color: var(--text);
  border: 3px solid var(--line);
  border-radius: 24px;
  padding: 30px 22px 20px;
  text-align: center;
  box-shadow: 6px 6px 0 var(--outline);
  margin: auto;
}

.title {
  font-size: 26px;
  font-weight: 900;
  color: var(--accent);
  margin-bottom: 6px;
}

.big {
  font-size: 56px;
  font-weight: 900;
  margin: 0 0 6px;
  font-variant-numeric: tabular-nums;
}

.row {
  display: flex;
  justify-content: space-between;
  padding: 6px 4px;
  font-size: 16px;
  color: var(--muted);
}

.row b {
  color: var(--text);
}

.medal {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 22px;
  font-weight: 900;
}

.goals {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 8px;
  font-size: 12px;
  font-weight: 700;
  color: var(--muted);
}

.share {
  width: 100%;
  margin-top: 10px;
}

.ghost.challenge {
  width: 100%;
  margin-top: 24px;
  padding: 15px 12px;
  font-size: 20px;
  color: var(--outline);
  background: var(--accent);
  border-color: var(--outline);
  box-shadow: 4px 4px 0 var(--outline);
}

.ghost.challenge:active {
  transform: translate(3px, 3px);
  box-shadow: 1px 1px 0 var(--outline);
}
.challenge-action-slot { position: relative; display: grid; height: 70px; margin-top: 24px; }
.challenge-action-slot .challenge { margin-top: 0; }
.result-action-slot { position: relative; display: grid; margin-top: 10px; }
.result-action-slot.brag-slot { margin-top: 24px; }
.result-action-slot > button { margin-top: 0; }
.challenge-action-state.result-posted { color: var(--success); }
.pending-action { visibility: hidden; }
.challenge-action-state { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: 10px; color: var(--muted); font-size: 14px; font-weight: 800; }
.verification-spinner { width: 22px; height: 22px; flex: none; border: 3px solid var(--line); border-top-color: var(--accent); border-radius: 50%; animation: verification-spin 0.8s linear infinite; }
@keyframes verification-spin { to { transform: rotate(360deg); } }
.brag-pop { animation: brag-pop 0.45s cubic-bezier(0.2, 1.3, 0.4, 1) both; }
@keyframes brag-pop { from { transform: scale(0.8); opacity: 0; } 65% { transform: scale(1.05); opacity: 1; } to { transform: scale(1); opacity: 1; } }

.replay-action {
  width: 100%;
  margin-top: 10px;
}

.challenge-feedback {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 5px;
  color: var(--text);
  font-size: 14px;
}
.challenge-created { display: flex; align-items: center; justify-content: center; gap: 12px; }
.challenge-created-label { display: inline-flex; align-items: center; gap: 6px; color: var(--success); }
.challenge-created-label svg { flex: none; }
.ghost.share-icon { display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 44px; padding: 0; flex: none; }


.next {
  width: 100%;
  margin-top: 14px;
}

.badges {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 4px 12px;
  margin-top: 10px;
}

.badge {
  position: relative;
  display: inline-block;
  background: var(--accent);
  color: var(--outline);
  font-weight: 900;
  border: 2px solid var(--outline);
  border-radius: 999px;
  padding: 5px 14px;
  transform: rotate(-3deg);
  /* Delay passt zum Sound, der kurz nach dem Ziel-Jingle folgt */
  animation: badge-pop 0.6s cubic-bezier(0.2, 1.3, 0.4, 1) 0.7s both;
}

.badge-first {
  animation-delay: 0s;
  transform: rotate(3deg);
}

.badge-first .spark {
  animation-delay: 0.15s;
}

.badge-text {
  position: relative;
}

@keyframes badge-pop {
  0% {
    transform: scale(0) rotate(-24deg);
    opacity: 0;
  }
  55% {
    transform: scale(1.3) rotate(3deg);
    opacity: 1;
  }
  100% {
    transform: scale(1) rotate(-3deg);
    opacity: 1;
  }
}

/* Funken, die beim Aufpoppen vom Badge wegfliegen */
.spark {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 13px;
  height: 13px;
  margin: -6.5px 0 0 -6.5px;
  background: var(--accent);
  clip-path: polygon(50% 0, 62% 38%, 100% 50%, 62% 62%, 50% 100%, 38% 62%, 0 50%, 38% 38%);
  pointer-events: none;
  animation: spark-fly 0.7s ease-out 0.85s both;
}

.spark:nth-child(even) {
  background: #fff;
  animation-duration: 0.6s;
}

@keyframes spark-fly {
  0% {
    transform: rotate(var(--a)) translateX(20px) scale(0.3);
    opacity: 1;
  }
  100% {
    transform: rotate(var(--a)) translateX(78px) scale(1.1);
    opacity: 0;
  }
}

/* Die Zeile "Best" leuchtet einmal auf, wenn sie gerade verbessert wurde */
.row-best b {
  display: inline-block;
  color: var(--accent);
  animation: best-bump 0.5s ease-out 0.7s both;
}

@keyframes best-bump {
  0% {
    transform: scale(1);
  }
  40% {
    transform: scale(1.35);
  }
  100% {
    transform: scale(1);
  }
}

.board {
  margin-top: 10px;
  padding-top: 8px;
  text-align: left;
}

.name-form {
  display: grid;
  gap: 8px;
}

.name-form input {
  font: inherit;
  font-size: 16px;
  font-weight: 700;
  padding: 8px 10px;
  color: var(--text);
  background: transparent;
  border: 2px solid var(--line);
  border-radius: 10px;
}

.name-form .cta:disabled {
  opacity: 0.45;
  cursor: default;
}

.name-form .link {
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  font-weight: 800;
  color: var(--muted);
  background: none;
  border: 0;
  text-decoration: underline;
  padding: 2px;
}

.board-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: 14px;
}

.board-head span {
  color: var(--muted);
  font-size: 13px;
  font-weight: 700;
}

.board-note {
  margin: 6px 0 0;
  font-size: 13px;
  color: var(--muted);
}

.board-note.err {
  color: var(--accent);
}

.board-list {
  list-style: none;
  margin: 6px 0 0;
  padding: 0;
  max-height: 132px;
  overflow-y: auto;
  font-size: 14px;
  font-weight: 700;
}

.board-list li {
  display: grid;
  grid-template-columns: 26px 1fr auto;
  gap: 6px;
  padding: 3px 4px;
  border-radius: 8px;
}

.board-list li.you {
  background: var(--accent);
  color: var(--outline);
}

.board-list .n {
  opacity: 0.7;
}

.board-list .who {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.board-list .t {
  font-variant-numeric: tabular-nums;
}

.actions {
  display: flex;
  gap: 10px;
  margin-top: 16px;
}

.cta,
.ghost {
  flex: 1;
  cursor: pointer;
  font-size: 17px;
  font-weight: 900;
  border-radius: 14px;
  padding: 12px 10px;
  border: 3px solid var(--line);
}

.cta {
  background: var(--accent);
  color: var(--outline);
  box-shadow: 3px 3px 0 var(--outline);
}

.ghost {
  background: transparent;
  color: var(--text);
}

.cta:active {
  transform: translate(2px, 2px);
  box-shadow: 1px 1px 0 var(--outline);
}

/* Intro banner and result card fade out instead of vanishing */
.fadeout-leave-active,
.result-leave-active {
  transition: opacity 0.18s ease;
}
.fadeout-leave-to,
.result-leave-to {
  opacity: 0;
}

/* Schmale Bildschirme: Leiste enger, damit Zeit, Tode (auch dreistellig) und drei Knöpfe in eine Zeile passen */
/* Niedrige Bildschirme: Ergebnisfenster enger, damit es möglichst ohne Scrollen passt */
@media (max-height: 700px) {
  .card {
    padding: 14px 16px 12px;
  }
  .card .big {
    font-size: 44px;
  }
  .board-list {
    max-height: 96px;
  }
  .actions {
    margin-top: 10px;
  }
}

@media (max-width: 380px) {
  .hud {
    gap: 5px;
    left: 8px;
    right: 14px;
  }
  .pill {
    padding: 6px 9px;
    font-size: 15px;
  }
  .time {
    font-size: 16px;
  }
  .btn {
    width: 32px;
    height: 32px;
    padding: 0;
    font-size: 15px;
  }
}

@media (max-width: 300px) {
  .hud {
    gap: 4px;
  }
  .pill {
    padding: 5px 7px;
    font-size: 14px;
  }
  .time {
    font-size: 15px;
  }
  .btn {
    width: 28px;
    height: 28px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .brag-pop, .verification-spinner { animation: none; }
  .fadeout-leave-active,
  .result-leave-active {
    transition: none;
  }
  .intro,
  .result,
  .card,
  .badge,
  .row-best b {
    animation: none;
  }
  .spark {
    display: none;
  }
}
</style>
