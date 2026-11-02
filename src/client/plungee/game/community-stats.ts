/** One server-issued run per attempt; serialize checkpoints to avoid reordering. */
export function communityTracker(postId: string): (replay: string | null) => void {
  const url = `/api/community-run?postId=${encodeURIComponent(postId)}`
  let queue = Promise.resolve()
  let run: { id?: string } = {}
  async function send(body: object): Promise<{ runId?: string }> {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), keepalive: true })
    if (!response.ok) throw new Error('Community statistics could not be saved.')
    return response.json()
  }
  return replay => {
    if (replay === null) run = {}
    const attempt = run
    queue = queue.then(async () => {
      for (let retry = 0; retry < 3; retry++) {
        try {
          if (!attempt.id) attempt.id = (await send({})).runId
          if (replay && attempt.id) await send({ runId: attempt.id, replay })
          return
        } catch (error) {
          if (retry === 2) console.warn(error)
        }
      }
    })
  }
}
