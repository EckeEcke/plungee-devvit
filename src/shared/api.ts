/** One post references one existing level; the full level lives in the bundled campaign. */
export type PostInitResponse = {
  postId: string
  levelKey: string
  title: string
  username: string | null
}

export type VerifyRunResponse = {
  verified: true
  ticks: number
  deaths: number
}

export type ApiError = { error: string }
