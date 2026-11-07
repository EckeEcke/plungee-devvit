import { context, redis } from '@devvit/web/server'
import type { LeaderboardEntry, StoredLook } from '../../shared/api'
import { COLORS, EYES, PATTERNS, PATTERN_COLORS } from '../../shared/character-options'

const SCORE_VERSION = 'v1'
const SCORE_TTL_SECONDS = 90 * 24 * 60 * 60

export type StoredScore = {
  postId: string
  userId: string
  username: string | null
  ticks: number
  deaths: number
  replay: string
  look: StoredLook
  verifiedAt: string
}

export type ScoreWriteResult = {
  userId: string
  username: string | null
  improved: boolean
  personalBest: StoredScore
}

function keyPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9:_-]/g, '_')
}

function scoreHash(postId: string): string {
  return `plungee:${SCORE_VERSION}:post:${keyPart(postId)}:scores`
}

function leaderboardKey(postId: string): string {
  return `plungee:${SCORE_VERSION}:post:${keyPart(postId)}:leaderboard`
}

function userIndex(userId: string): string {
  return `plungee:v2:user:${keyPart(userId)}:scores`
}

export async function deleteOwnScores(): Promise<void> {
  const identity = currentIdentity()
  if (!identity) throw new Error('Sign in required.')
  const legacy = `plungee:v1:user:${keyPart(identity.userId)}:scores`
  const entries = { ...await redis.hGetAll(legacy), ...await redis.hGetAll(userIndex(identity.userId)) }
  for (const postId of Object.keys(entries)) {
    await redis.hDel(scoreHash(postId), [identity.userId])
    await redis.zRem(leaderboardKey(postId), [identity.userId])
  }
  await redis.del(userIndex(identity.userId), legacy)
}

function currentIdentity(): { userId: string; username: string | null } | null {
  if (!context.userId) return null
  return {
    userId: String(context.userId),
    username: context.username ?? null,
  }
}

function parseScore(raw: string | undefined): StoredScore | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Partial<StoredScore>
    if (
      typeof value.postId === 'string' &&
      typeof value.userId === 'string' &&
      typeof value.ticks === 'number' &&
      typeof value.deaths === 'number' &&
      typeof value.replay === 'string' &&
      isStoredLook(value.look) &&
      typeof value.verifiedAt === 'string'
    ) {
      return {
        postId: value.postId,
        userId: value.userId,
        username: typeof value.username === 'string' ? value.username : null,
        ticks: value.ticks,
        deaths: value.deaths,
        replay: value.replay,
        look: value.look,
        verifiedAt: value.verifiedAt,
      }
    }
  } catch {
    // Beschädigte Daten werden ignoriert; der nächste gültige Lauf ersetzt sie.
  }
  return null
}

const LOOK_COLORS = new Set<string>(COLORS.map(option => option.id))
const LOOK_EYES = new Set<string>(EYES.map(option => option.id))
const LOOK_PATTERNS = new Set<string>(PATTERNS.map(option => option.id))
const LOOK_PATTERN_COLORS = new Set<string>(PATTERN_COLORS.map(option => option.id))

function isStoredLook(value: unknown): value is StoredLook {
  if (!value || typeof value !== 'object') return false
  const look = value as Record<string, unknown>
  return typeof look.color === 'string' && LOOK_COLORS.has(look.color) &&
    typeof look.eyes === 'string' && LOOK_EYES.has(look.eyes) &&
    typeof look.pattern === 'string' && LOOK_PATTERNS.has(look.pattern) &&
    typeof look.patternColor === 'string' && LOOK_PATTERN_COLORS.has(look.patternColor)
}

function sanitizeLook(value: unknown): StoredLook | null {
  return isStoredLook(value) ? {
    color: value.color,
    eyes: value.eyes,
    pattern: value.pattern,
    patternColor: value.patternColor,
  } : null
}

/** Returns the current Reddit user's stored best for this post, if available. */
export async function getPersonalBest(postId: string): Promise<StoredScore | null> {
  const identity = currentIdentity()
  if (!identity) return null
  return parseScore(await redis.hGet(scoreHash(postId), identity.userId))
}

/**
 * Public results are only read after the challenge has closed. The caller is
 * responsible for checking the close timestamp from the post metadata.
 */
export async function getReleasedLeaderboard(
  postId: string,
  viewerUserId: string | null,
  creatorUserId: string | null,
  limit = 5,
): Promise<{ entries: LeaderboardEntry[]; yourRank: number | null; yourEntry: LeaderboardEntry | null }> {
  const safeLimit = Math.max(1, Math.min(5, Math.floor(limit)))
  // Redis orders by ticks, but the product tie-breakers are deaths and then
  // the first verified submission. Read all members before applying them.
  const ranked = await redis.zRange(leaderboardKey(postId), 0, -1)
  if (ranked.length === 0) return { entries: [], yourRank: null, yourEntry: null }

  const records = await redis.hMGet(scoreHash(postId), ranked.map(entry => entry.member))
  const scores: StoredScore[] = []
  for (let i = 0; i < records.length; i++) {
    const score = parseScore(records[i] ?? undefined)
    if (!score) continue
    scores.push(score)
  }

  scores.sort((a, b) =>
    a.ticks - b.ticks ||
    a.deaths - b.deaths ||
    a.verifiedAt.localeCompare(b.verifiedAt) ||
    a.userId.localeCompare(b.userId),
  )

  const toEntry = (score: StoredScore, rank: number): LeaderboardEntry => ({
      rank,
      username: score.username,
      ticks: score.ticks,
      deaths: score.deaths,
      replay: score.replay,
      look: score.look,
      isCreator: creatorUserId !== null && score.userId === creatorUserId,
      isCurrentUser: viewerUserId !== null && score.userId === viewerUserId,
    })
  const yourIndex = viewerUserId === null ? -1 : scores.findIndex(score => score.userId === viewerUserId)
  return {
    entries: scores.slice(0, safeLimit).map((score, index) => toEntry(score, index + 1)),
    yourRank: yourIndex >= 0 ? yourIndex + 1 : null,
    yourEntry: yourIndex >= 0 ? toEntry(scores[yourIndex]!, yourIndex + 1) : null,
  }
}

/**
 * Stores only a server-verified improvement. The client never supplies userId,
 * username, or the accepted time; all identity data comes from request context.
 */
export async function recordVerifiedScore(
  postId: string,
  score: Pick<StoredScore, 'ticks' | 'deaths' | 'replay'> & { look: unknown },
  closesAt: number | null = null,
): Promise<ScoreWriteResult | null> {
  if (closesAt !== null && Date.now() >= closesAt) return null
  const identity = currentIdentity()
  if (!identity) return null

  const hash = scoreHash(postId)
  const existing = parseScore(await redis.hGet(hash, identity.userId))
  if (existing && (existing.ticks < score.ticks || (existing.ticks === score.ticks && existing.deaths <= score.deaths))) {
    return {
      userId: identity.userId,
      username: existing.username ?? identity.username,
      improved: false,
      personalBest: existing,
    }
  }

  const look = sanitizeLook(score.look)
  if (!look) return null

  const personalBest: StoredScore = {
    postId,
    userId: identity.userId,
    username: identity.username,
    ticks: score.ticks,
    deaths: score.deaths,
    replay: score.replay,
    look,
    verifiedAt: new Date().toISOString(),
  }
  const encoded = JSON.stringify(personalBest)

  // Recheck after asynchronous reads: verification started before close may finish after it.
  if (closesAt !== null && Date.now() >= closesAt) return null
  if (await redis.get(`plungee:v1:post:${postId}:deleted`)) return null
  await redis.hSet(hash, { [identity.userId]: encoded })
  await redis.hSet(userIndex(identity.userId), { [postId]: encoded })
  await redis.zAdd(leaderboardKey(postId), { member: identity.userId, score: score.ticks })
  // A deletion may arrive between the pre-write check and the asynchronous writes.
  if (await redis.get(`plungee:v1:post:${postId}:deleted`)) {
    await redis.hDel(hash, [identity.userId])
    await redis.hDel(userIndex(identity.userId), [postId])
    await redis.zRem(leaderboardKey(postId), [identity.userId])
    return null
  }

  // Keep score records bounded while the user index remains available for cleanup.
  await redis.expire(hash, SCORE_TTL_SECONDS)
  await redis.expire(leaderboardKey(postId), SCORE_TTL_SECONDS)
  // The user's complete score index follows the user's last score update.
  // After 90 days without an improved verified score, it expires automatically.
  await redis.expire(userIndex(identity.userId), SCORE_TTL_SECONDS)

  return {
    userId: identity.userId,
    username: identity.username,
    improved: true,
    personalBest,
  }
}
