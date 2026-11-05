
<script setup lang="ts">
import PageShell from './PageShell.vue'
import SkullIcon from './SkullIcon.vue'

import { computed, onMounted, ref } from 'vue'
import type { Theme } from '../game/theme'

import { fetchLevels, type OnlineMeta } from '../editor/community'

defineProps<{ theme: Theme }>()
const emit = defineEmits<{ exit: []; play: [id: string] }>()

const PAGE = 20

const levels = ref<OnlineMeta[]>([])
const total = ref(0)
const loading = ref(false)
const error = ref('')
const reporting = ref('')
const reported = ref(new Set<string>())

/** Verwirft Antworten veralteter Anfragen (schnelles Umschalten der Reiter) */
let ticket = 0

/** Freigegebene Level können in der Liste fehlen (Seite voll, aber nicht alle sichtbar): offset zählt Server-Zeilen */
let offset = 0

async function load(reset: boolean): Promise<void> {
  const mine = ++ticket

  if (reset) {
    levels.value = []
    offset = 0
    total.value = 0
  }

  loading.value = true
  error.value = ''

  try {
    const res = await fetchLevels(offset, PAGE)

    if (mine !== ticket) return

    levels.value = reset ? res.levels : [...levels.value, ...res.levels]
    offset += PAGE
    total.value = res.total
  } catch (e) {
    if (mine !== ticket) return
    error.value = e instanceof Error ? e.message : 'Could not load levels'
  } finally {
    if (mine === ticket) loading.value = false
  }
}

onMounted(() => load(true))

async function reportLevel(id: string): Promise<void> {
  if (reporting.value || reported.value.has(id)) return
  reporting.value = id
  try {
    const response = await fetch(`/api/community/${encodeURIComponent(id)}/report`, { method: 'POST' })
    const data = await response.json() as { error?: string }
    if (!response.ok) throw new Error(data.error ?? 'Could not report level.')
    reported.value = new Set(reported.value).add(id)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not report level.'
  } finally { reporting.value = '' }
}


const canMore = computed(
  () => !loading.value && !error.value && offset < total.value,
)

function ago(ts: number): string {
  const min = Math.max(0, Math.floor((Date.now() - ts) / 60000))

  if (min < 60) {
    return min <= 1 ? 'just now' : `${min} min ago`
  }

  const h = Math.floor(min / 60)

  if (h < 24) return `${h} h ago`

  const d = Math.floor(h / 24)

  return d < 30 ? `${d} d ago` : new Date(ts).toLocaleDateString()
}

const SIZE_TEXT: Record<string, string> = {
  short: 'Short',
  medium: 'Medium',
  long: 'Long',
}
</script>

<template>
  <PageShell :theme="theme">
    <div class="community">
      <header class="top">
        <div class="top-in">
          <button
            class="ib"
            type="button"
            aria-label="Back to menu"
            @click="emit('exit')"
          >
            ←
          </button>

          <div class="title">
            <b>Community levels</b>
            <small>Built by players</small>
          </div>
        </div>
      </header>

      <div class="scroll">
        <ul class="list">
          <li
            v-for="l in levels"
            :key="l.id"
            class="item"
          >
            <button
              class="play"
              type="button"
              @click="emit('play', l.id)"
            >
              <span class="t">{{ l.title }}</span>

              <span class="m">
                by {{ l.author }} ·
                {{ SIZE_TEXT[l.size] ?? l.size }} ·
                {{ ago(l.createdAt) }}
              </span>
              <span class="p community-stats">
                <span>{{ l.stats?.players ?? 0 }} played</span>
                <span>{{ l.stats?.clears ?? 0 }} cleared</span>
                <span class="death-stat" :aria-label="`${l.stats?.deaths ?? 0} deaths`"><SkullIcon :size="15" />{{ l.stats?.deaths ?? 0 }}</span>
              </span>
              <span v-if="l.stats?.firstClear" class="p fc"><svg class="flag" viewBox="0 0 12 14" fill="currentColor" aria-hidden="true"><path d="M1 0h1v14H1zM3 1h8L8 4l3 3H3z" /></svg><span class="fc-name">First clear: {{ l.stats.firstClear.username ?? 'Deleted user' }}</span></span>

            </button>
            <button class="report" type="button" :disabled="reporting === l.id || reported.has(l.id)" @click="reportLevel(l.id)">{{ reported.has(l.id) ? 'Reported' : reporting === l.id ? 'Reporting…' : 'Report' }}</button>
          </li>
        </ul>

        <p v-if="loading" class="note">
          Loading …
        </p>

        <div v-else-if="error" class="note err">
          <p>{{ error }}</p>

          <button
            class="more"
            type="button"
            @click="load(levels.length === 0)"
          >
            Try again
          </button>
        </div>

        <p v-else-if="levels.length === 0" class="note">
          No levels here yet. Build a level and publish it from the editor!
        </p>

        <button
          v-if="canMore"
          class="more"
          type="button"
          @click="load(false)"
        >
          Show more
        </button>
      </div>
    </div>
  </PageShell>
</template>

<style scoped>
/* Layout */

.community {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/* Header */

.top,
.bar {
  background: var(--panel);
  border-bottom: 3px solid var(--line);
}

.top-in,
.bar-in {
  width: min(100%, 520px);
  margin: 0 auto;
  display: flex;
  align-items: center;
  gap: 10px;
}

.top-in {
  padding: max(10px, env(safe-area-inset-top)) 12px 10px;
}

.ib {
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  font-size: 20px;
  font-weight: 900;
  color: var(--text);
  background: transparent;
  border: 2px solid var(--line);
  border-radius: 12px;
  cursor: pointer;
}

.title b {
  display: block;
  font-size: 18px;
  font-weight: 900;
  color: var(--accent);
}

.title small {
  font-size: 12px;
  font-weight: 700;
  color: var(--muted);
}

/* Sort and ghosts */

.bar-in {
  padding: 10px 12px;
  justify-content: space-between;
  flex-wrap: wrap;
}

.tabs {
  display: flex;
  gap: 4px;
  padding: 2px;
  border: 3px solid var(--line);
  border-radius: 999px;
}

.tabs button {
  cursor: pointer;
  font: inherit;
  font-size: 14px;
  font-weight: 800;
  padding: 5px 12px;
  color: var(--muted);
  background: transparent;
  border: 0;
  border-radius: 999px;
}

.tabs button.on {
  color: var(--outline);
  background: var(--accent);
}

.ghosts {
  flex-shrink: 0;
}

/* Level list */

.scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 14px 12px max(24px, env(safe-area-inset-bottom));
}

.list {
  list-style: none;
  width: min(100%, 520px);
  margin: 0 auto;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.item {
  display: flex;
  gap: 8px;
}

.play {
  flex: 1;
  min-width: 0;
  display: grid;
  gap: 2px;
  text-align: left;
  cursor: pointer;
  font: inherit;
  padding: 10px 14px;
  color: var(--text);
  background: var(--panel);
  border: 3px solid var(--line);
  border-radius: 16px;
  box-shadow: 4px 4px 0 var(--outline);
}

.play:active {
  transform: translate(2px, 2px);
  box-shadow: 2px 2px 0 var(--outline);
}

/* Level details */

.t {
  font-size: 17px;
  font-weight: 900;
  color: var(--accent);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.m,
.p {
  font-size: 13px;
  font-weight: 700;
  color: var(--muted);
}
.community-stats { flex-wrap: wrap; margin-top: 6px; }
.death-stat { display: inline-flex; align-items: center; gap: 4px; }
.death-stat :deep(svg) { display: block; }

.p {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

/* First clear */

.fc {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  color: var(--accent);
}

.flag {
  flex: none;
  width: 11px;
  height: 13px;
}

.fc-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Loading, errors and pagination */

.note {
  width: min(100%, 520px);
  margin: 18px auto 0;
  text-align: center;
  font-weight: 700;
  color: var(--muted);
}

.note.err {
  color: var(--accent);
}

.more {
  display: block;
  margin: 16px auto 0;
  cursor: pointer;
  font: inherit;
  font-size: 16px;
  font-weight: 900;
  padding: 10px 24px;
  color: var(--outline);
  background: var(--accent);
  border: 3px solid var(--outline);
  border-radius: 14px;
  box-shadow: 3px 3px 0 var(--outline);
}

/* Responsive */

@media (max-width: 380px) {
  .bar-in {
    gap: 6px;
  }

  .tabs button {
    font-size: 12px;
    padding: 5px 7px;
  }
}

@media (min-width: 600px) {
  .top-in,
  .bar-in {
    width: 100%;
    padding-inline: 24px;
  }
}
</style>


