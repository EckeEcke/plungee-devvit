/** One post references one existing level; the full level lives in the bundled campaign. */
export type PostInitResponse = {
  postId: string
  levelKey: string
  title: string
  username: string | null
  kind?: 'practice' | 'campaign' | 'challenge' | 'weekly' | 'community' | 'editor'
  levelData?: unknown
  closesAt?: number
  weekId?: string
  targetTicks?: number
}

export type StoredLook = {
  color: string
  eyes: string
  pattern: string
  patternColor: string
}

export type VerifyRunResponse = {
  verified: true
  ticks: number
  deaths: number
  recorded: boolean
  closed: boolean
  canPostResult: boolean
  resultRunId?: string
  improved: boolean
  personalBest: { ticks: number; deaths: number } | null
}

export type LeaderboardEntry = {
  rank: number
  username: string | null
  ticks: number
  deaths: number
  replay: string
  look: StoredLook
  isCreator: boolean
  isCurrentUser: boolean
}

export type LeaderboardResponse = {
  released: boolean
  closesAt: number
  entries: LeaderboardEntry[]
  yourRank: number | null
  yourEntry: LeaderboardEntry | null
}

export type ApiError = { error: string }

export type ChallengeProfile = { username: string | null; avatarUrl: string | null }
export type ChallengeVersusResponse = { creator: ChallengeProfile; viewer: ChallengeProfile }

export type CommunityLevelMeta = {
  id: string
  title: string
  author: string
  size: string
  createdAt: number
  stats?: CommunityStats
}

export type CommunityStats = {
  players: number
  clears: number
  deaths: number
  firstClear: { username: string | null; at: number } | null
}
