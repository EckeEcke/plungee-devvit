import type { CommunityLevelMeta } from '../../../shared/api'
export type OnlineMeta = CommunityLevelMeta
export async function fetchLevels(offset = 0, limit = 20): Promise<{ levels: OnlineMeta[]; total: number }> {
  const response = await fetch(`/api/community?offset=${offset}&limit=${limit}`)
  if (!response.ok) throw new Error('Could not load community levels')
  return response.json()
}
