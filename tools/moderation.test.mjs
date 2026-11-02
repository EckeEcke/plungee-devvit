import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hasLevelModerationPermission } from '../src/server/core/moderation-policy.ts'

const moderator = (id, permissions) => ({ id, moderatorInfo: { modPermissions: permissions } })
test('matching subreddit moderator with posts or all rights can manage levels', () => {
  assert.equal(hasLevelModerationPermission('t2_me', [moderator('t2_me', ['posts'])]), true)
  assert.equal(hasLevelModerationPermission('t2_me', [moderator('t2_me', ['all'])]), true)
})
test('other moderator identity cannot authorize the viewer', () => {
  assert.equal(hasLevelModerationPermission('t2_me', [moderator('t2_other', ['all'])]), false)
  assert.equal(hasLevelModerationPermission('t2_me', []), false)
})
test('unrelated subreddit permissions do not grant level moderation', () => {
  assert.equal(hasLevelModerationPermission('t2_me', [moderator('t2_me', ['wiki', 'mail', 'flair'])]), false)
})
