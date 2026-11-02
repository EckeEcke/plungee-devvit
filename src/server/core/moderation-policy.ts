export function hasLevelModerationPermission(userId: string, moderators: ReadonlyArray<{
  id: string
  moderatorInfo: { modPermissions: readonly string[] }
}>): boolean {
  return moderators.some(mod => mod.id === userId &&
    (mod.moderatorInfo.modPermissions.includes('all') || mod.moderatorInfo.modPermissions.includes('posts')))
}
