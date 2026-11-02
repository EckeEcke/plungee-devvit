<script setup lang="ts">
import { onMounted, ref } from 'vue'
import PageShell from './PageShell.vue'
import type { Theme } from '../game/theme'
import type { CommunityLevelMeta } from '../../../shared/api'
defineProps<{ theme: Theme }>()
const emit = defineEmits<{ exit: [] }>()
type Row = CommunityLevelMeta & { unpublished: boolean }
const levels = ref<Row[]>([])
const total = ref(0)
const loading = ref(false)
const busy = ref('')
const error = ref('')
const status = ref('')
const deleting = ref('')
const confirmation = ref('')
async function load(reset = true): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const response = await fetch('/api/moderation/levels?offset=' + (reset ? 0 : levels.value.length))
    const data = await response.json()
    if (!response.ok) throw new Error(data.error ?? 'Could not load moderation view.')
    levels.value = reset ? data.levels : [...levels.value, ...data.levels]
    total.value = data.total
  } catch (e) { error.value = e instanceof Error ? e.message : 'Could not load levels.' }
  finally { loading.value = false }
}
async function act(level: Row, action: 'unpublish' | 'restore' | 'delete'): Promise<void> {
  if (busy.value) return
  if (action === 'delete' && confirmation.value !== level.title) return
  busy.value = level.id
  error.value = ''
  status.value = ''
  try {
    const response = await fetch('/api/moderation/levels/' + level.id, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...(action === 'delete' ? { confirmation: level.id } : {}) }),
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error ?? 'Action failed.')
    if (action === 'delete') {
      levels.value = levels.value.filter(row => row.id !== level.id)
      total.value--
    } else { level.unpublished = action === 'unpublish' }
    deleting.value = ''
    confirmation.value = ''
    status.value = action === 'delete' ? 'Level data permanently deleted. The Reddit post was not deleted.' : action === 'restore' ? 'Level restored.' : 'Level unpublished and disabled.'
  } catch (e) { error.value = e instanceof Error ? e.message : 'Action failed.' }
  finally { busy.value = '' }
}
onMounted(() => { void load() })
</script>

<template>
  <PageShell :theme="theme">
    <div class="community" :style="{ '--danger': theme.danger }">
      <header class="top"><div class="top-in">
        <button class="ib" type="button" aria-label="Back to menu" @click="emit('exit')">←</button>
        <div class="title"><b>Moderate levels</b><small>Community level moderation</small></div>
      </div></header>
      <div class="scroll">
        <p class="note">Unpublish hides a level and disables playing it. Restore makes it available again. Reddit posts and comments remain unchanged.</p>
        <p v-if="error" class="note" role="alert">{{ error }}</p>
        <p v-if="status" class="note" role="status">{{ status }}</p>
        <ul class="list">
          <li v-for="level in levels" :key="level.id" class="item">
            <div class="play moderation-row">
              <span class="t">{{ level.title }}</span>
              <span class="m">by {{ level.author }} · {{ level.unpublished ? 'Unpublished' : 'Published' }}</span>
              <a class="post-link" :href="'https://www.reddit.com/comments/' + level.id.slice(3)">View Reddit post</a>
              <div class="mod-actions">
                <button class="more" type="button" :disabled="Boolean(busy)" @click="act(level, level.unpublished ? 'restore' : 'unpublish')">{{ level.unpublished ? 'Restore' : 'Unpublish' }}</button>
                <button v-if="level.unpublished" class="more danger-action" type="button" :disabled="Boolean(busy)" @click="deleting = level.id; confirmation = ''">Delete permanently…</button>
              </div>
              <div v-if="deleting === level.id" class="delete-confirm">
                <p>This permanently deletes the level, its leaderboard and replays. It cannot be undone. Type the level title to confirm.</p>
                <input v-model="confirmation" :aria-label="'Confirm deletion of ' + level.title" autocomplete="off" />
                <div class="mod-actions">
                  <button class="more danger-action" type="button" :disabled="Boolean(busy) || confirmation !== level.title" @click="act(level, 'delete')">Permanently delete</button>
                  <button class="more" type="button" :disabled="Boolean(busy)" @click="deleting = ''; confirmation = ''">Cancel</button>
                </div>
              </div>
            </div>
          </li>
        </ul>
        <p v-if="loading" class="note" role="status">Loading…</p>
        <p v-else-if="!levels.length && !error" class="note">No community levels yet.</p>
        <button v-if="levels.length < total" class="more" type="button" :disabled="loading || Boolean(busy)" @click="load(false)">Show more</button>
        <button v-if="error" class="more" type="button" :disabled="loading" @click="load()">Try again</button>
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

.moderation-row { cursor: default; }
.mod-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 12px; }
.mod-actions .more { margin: 0; width: auto; }
.post-link { color: var(--muted); font-size: 13px; }
.danger-action { color: var(--danger); }
.delete-confirm { margin-top: 14px; font-size: 14px; line-height: 1.5; }
.delete-confirm input { box-sizing: border-box; width: 100%; padding: 10px; border: 2px solid var(--line); border-radius: 10px; color: var(--text); background: var(--panel); font: inherit; }
button:disabled { opacity: 0.5; cursor: default; }
</style>

