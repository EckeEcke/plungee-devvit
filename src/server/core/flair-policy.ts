export type PlungeeFlair = 'Weekly' | 'Replay' | 'Challenge' | 'Build a level'

export function flairForPost(kind: string): PlungeeFlair | null {
  switch (kind) {
    case 'weekly': return 'Weekly'
    case 'weeklyReplay': return 'Replay'
    case 'challenge': return 'Challenge'
    case 'editor': case 'community': return 'Build a level'
    default: return null
  }
}

export function matchingFlair<T extends { text: string }>(templates: T[], name: PlungeeFlair): T | undefined {
  return templates.find(template => template.text.trim().toLowerCase() === name.toLowerCase())
}
