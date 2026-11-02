import type { CommunityStats } from '../../shared/api'

export type CommunityPlayer = { username: string | null; deaths: number; clearedAt: number | null; eligible: boolean }

export function replayExtends(before: ArrayLike<number>, after: ArrayLike<number>): boolean {
  if (after.length < before.length) return false
  for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) return false
  return true
}

export function applyCheckpoint(player: CommunityPlayer, previousDeaths: number, result: { deaths: number; finished: boolean }, now: number): CommunityPlayer {
  return { ...player, deaths: player.deaths + Math.max(0, result.deaths - previousDeaths),
    clearedAt: player.clearedAt ?? (result.finished ? now : null) }
}

export function summarizePlayers(records: Record<string, CommunityPlayer>): CommunityStats {
  const players = Object.values(records)
  const first = players.filter(p => p.eligible && p.clearedAt !== null).sort((a, b) => a.clearedAt! - b.clearedAt!)[0]
  return { players: players.length, clears: players.filter(p => p.clearedAt !== null).length,
    deaths: players.reduce((sum, p) => sum + p.deaths, 0),
    firstClear: first ? { username: first.username, at: first.clearedAt! } : null }
}
