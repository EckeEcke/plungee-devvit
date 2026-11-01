import type { LevelData } from '../sim'
export function nameProblem(title: string): string | null {
  return /[\u0000-\u001f]/.test(title) ? 'Invalid title' : null
}
export async function uploadLevel(title: string, level: LevelData, replay: string): Promise<string> {
  const response = await fetch('/api/community', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, level, replay }) })
  const result = await response.json() as { error?: string; postId?: string }
  if (!response.ok) throw new Error(result.error ?? 'Could not publish level')
  if (!result.postId) throw new Error('Published post ID missing')
  return `https://www.reddit.com/comments/${result.postId.replace(/^t3_/, '')}`
}
