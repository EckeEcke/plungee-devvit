import type { LevelData } from '../sim'
import type { RunProof } from './share'

export interface Draft { level: LevelData; proof: { hash: string; run: RunProof } | null }
let draft: Draft | null = null
let pending: ReturnType<typeof setTimeout> | undefined
export async function prepareDraft(): Promise<void> {
  const response = await fetch('/api/editor/draft')
  if (!response.ok) throw new Error('Could not load your Reddit editor draft.')
  draft = await response.json() as Draft | null
}
export function loadDraft(): Draft | null { return draft }
export function saveDraft(value: Draft): void {
  draft = value
  if (pending) clearTimeout(pending)
  pending = setTimeout(() => {
    void fetch('/api/editor/draft', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) })
      .catch(error => console.error('Could not save editor draft', error))
  }, 500)
}
