<script setup lang="ts">
import PageShell from './PageShell.vue'
import type { Theme } from '../game/theme'
import { ref, watch } from 'vue'
import { navigateTo } from '@devvit/web/client'
import { legalDestination, type LegalPage } from '../game/legalNavigation'

const props = defineProps<{ theme: Theme; page: LegalPage }>()
const emit = defineEmits<{ exit: []; page: [page: LegalPage] }>()
const titles = { privacy: 'Privacy Policy', terms: 'Terms of Use', support: 'Help & Support' }
const content = ref('')
const loading = ref(true)
const error = ref('')

watch(() => props.page, async (page, _previous, onCleanup) => {
  const controller = new AbortController()
  onCleanup(() => controller.abort())
  loading.value = true
  error.value = ''
  content.value = ''
  try {
    const response = await fetch(`/${page}.html`, { signal: controller.signal })
    if (!response.ok) throw new Error('Document unavailable.')
    // These are our bundled static documents, never user-submitted markup.
    const document = new DOMParser().parseFromString(await response.text(), 'text/html')
    if (controller.signal.aborted) return
    document.querySelector('h1')?.remove()
    const allowed = new Set(['P', 'H2', 'H3', 'UL', 'OL', 'LI', 'A', 'STRONG', 'EM', 'NAV', 'BR'])
    for (const element of document.body.querySelectorAll('*')) {
      if (!allowed.has(element.tagName)) { element.remove(); continue }
      for (const attribute of [...element.attributes]) {
        if (attribute.name !== 'href' && attribute.name !== 'class') element.removeAttribute(attribute.name)
      }
      if (element instanceof HTMLAnchorElement && !legalDestination(element.getAttribute('href') ?? '', window.location.origin)) element.removeAttribute('href')
    }
    content.value = document.body.innerHTML
  } catch {
    if (!controller.signal.aborted) error.value = 'Could not load this document. Please reopen it from the menu.'
  } finally {
    if (!controller.signal.aborted) loading.value = false
  }
}, { immediate: true })

function followLink(event: MouseEvent): void {
  const anchor = event.target instanceof Element ? event.target.closest('a') : null
  if (!anchor) return
  event.preventDefault()
  const destination = legalDestination(anchor.getAttribute('href') ?? '', window.location.origin)
  if (!destination) return
  if ('page' in destination) emit('page', destination.page)
  else {
    try { navigateTo(destination.url) }
    catch { error.value = 'Could not open Reddit. You can contact u/Triggerscore directly in Reddit.' }
  }
}
</script>

<template>
  <PageShell :theme="theme">
    <section class="legal-page">
      <header>
        <button type="button" aria-label="Back to menu" @click="emit('exit')">←</button>
        <h1>{{ titles[page] }}</h1>
      </header>
      <div :key="page" class="document" :aria-label="titles[page]" :aria-busy="loading" @click="followLink">
        <p v-if="loading" role="status">Loading…</p>
        <p v-if="error" role="alert">{{ error }}</p>
        <article v-html="content" />
      </div>
    </section>
  </PageShell>
</template>

<style scoped>
.legal-page { flex: 1; min-height: 0; display: flex; flex-direction: column; background: var(--panel); }
header { display: flex; align-items: center; gap: 12px; padding: 12px; border-bottom: 3px solid var(--line); }
h1 { margin: 0; color: var(--accent); font-size: 18px; }
button { min-width: 44px; min-height: 44px; border: 2px solid var(--line); border-radius: 12px; background: transparent; color: var(--text); font-size: 22px; cursor: pointer; }
.document { flex: 1; min-height: 0; overflow-y: auto; padding: 8px 22px 32px; color: var(--text); line-height: 1.65; overflow-wrap: anywhere; }
article { max-width: 760px; margin: 0 auto; }
article :deep(h2) { margin-top: 26px; color: var(--accent); font-size: 18px; }
article :deep(a) { color: var(--accent); text-decoration: underline; text-underline-offset: 3px; }
article :deep(a:focus-visible) { outline: 2px solid var(--accent); outline-offset: 3px; }
article :deep(nav) { display: flex; flex-wrap: wrap; gap: 16px; margin-top: 30px; }
article :deep(.updated) { color: var(--muted); font-size: 13px; }
</style>
