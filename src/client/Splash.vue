<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { requestExpandedMode } from '@devvit/web/client'
import type { PostInitResponse } from '../shared/api'

const loading = ref(true)
const title = ref('Plungee')
const error = ref('')

onMounted(async () => {
  try {
    const response = await fetch('/api/init')
    if (!response.ok) throw new Error('This challenge is unavailable')
    const info = await response.json() as PostInitResponse
    title.value = info.title
  } catch (e) { error.value = e instanceof Error ? e.message : 'Could not load challenge' }
  finally { loading.value = false }
})

function play(event: MouseEvent): void {
  // Must be called synchronously from the actual click, without awaiting an API call.
  void requestExpandedMode(event, 'game', { title: 'Plungee' })
}
</script>

<template>
  <main class="preview">
    <div class="shape" aria-hidden="true"></div>
    <small>PLUNGEE · PLAYABLE POST</small>
    <h1>Can you beat this level?</h1>
    <p>{{ loading ? 'Loading level…' : error || title }}</p>
    <button type="button" :disabled="loading || !!error" @click="play">▶ Play</button>
    <span>Fall fast. Land smart.</span>
  </main>
</template>
