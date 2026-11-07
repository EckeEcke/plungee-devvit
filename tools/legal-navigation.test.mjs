import assert from 'node:assert/strict'
import { test } from 'node:test'
import { legalDestination } from '../src/client/plungee/game/legalNavigation.ts'

const origin = 'https://plungee.example'

test('document links stay inside Plungee', () => {
  for (const page of ['privacy', 'terms', 'support']) {
    assert.deepEqual(legalDestination(`/${page}.html`, origin), { page })
    assert.deepEqual(legalDestination(`${origin}/${page}.html`, origin), { page })
  }
})

test('the support profile produces an absolute destination for the Devvit navigation API', () => {
  const url = 'https://www.reddit.com/user/Triggerscore/'
  assert.deepEqual(legalDestination(url, origin), { url })
})

test('unsafe protocols and unknown local documents cannot navigate out of the reader', () => {
  for (const href of ['javascript:alert(1)', 'data:text/html,test', '/game.html', 'https://user:secret@www.reddit.com/']) {
    assert.equal(legalDestination(href, origin), null)
  }
})
