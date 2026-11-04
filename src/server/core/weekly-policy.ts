const WEEK_MS = 7 * 86400000

export type WeeklyWindow = { weekId: string; startsAt: number; closesAt: number }
export type WeeklyChallenge = WeeklyWindow & { levelKey: string; postId: string; replayPostId?: string }

export function currentWeeklyWindow(now = new Date()): WeeklyWindow {
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() || 7) + 1)
  const startsAt = monday.getTime()
  return { weekId: monday.toISOString().slice(0, 10), startsAt, closesAt: startsAt + WEEK_MS }
}

export type WeeklyPublishing = {
  get(weekId: string): Promise<WeeklyChallenge | null>
  lock(weekId: string): Promise<boolean>
  unlock(weekId: string): Promise<void>
  create(window: WeeklyWindow): Promise<WeeklyChallenge>
  createReplay(previous: WeeklyChallenge): Promise<string>
  saveReplay(weekId: string, postId: string): Promise<void>
}

/** A retry completes a missing replay post even when the current weekly already exists. */
export async function ensureWeeklyPair(publishing: WeeklyPublishing, now = new Date()): Promise<WeeklyChallenge> {
  const window = currentWeeklyWindow(now)
  if (!await publishing.lock(window.weekId)) throw new Error('Weekly posts are already being prepared. Please retry shortly.')
  try {
    const current = await publishing.get(window.weekId) ?? await publishing.create(window)
    const previousWeek = currentWeeklyWindow(new Date(window.startsAt - 1))
    const previous = await publishing.get(previousWeek.weekId)
    if (previous && previous.closesAt <= window.startsAt && !previous.replayPostId) {
      const postId = await publishing.createReplay(previous)
      await publishing.saveReplay(previous.weekId, postId)
    }
    return current
  } finally { await publishing.unlock(window.weekId) }
}

/** A replay post may only expose the canonical, already-closed weekly it references. */
export function releasedWeeklySource(raw: Record<string, unknown>, weekly: WeeklyChallenge | null, now = Date.now()): WeeklyChallenge {
  if (!weekly || !/^t3_[a-z0-9]+$/.test(weekly.postId) || raw.weekId !== weekly.weekId || raw.sourcePostId !== weekly.postId || raw.levelKey !== weekly.levelKey || !Number.isFinite(weekly.closesAt) || weekly.closesAt > now) {
    throw new Error('Weekly replay unavailable.')
  }
  return weekly
}
