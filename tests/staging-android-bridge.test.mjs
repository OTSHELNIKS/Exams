import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = await readFile(new URL('../.github/scripts/staging-android-bridge.js', import.meta.url), 'utf8')
const host = 'https://bhurngeasoekgzqxzrlq.supabase.co'
function harness(prompts = ['A'.repeat(22)], status = 200) {
  const calls = [], asked = []
  const window = {
    location: { href: 'https://localhost/' },
    prompt(message) { asked.push(message); return prompts.shift() },
    async fetch(input, init) { calls.push({ input, init }); return new Response('{}', { status }) },
  }
  const document = { addEventListener() {} }
  vm.runInNewContext(source, { window, document, URL, Headers, Request, Response })
  return { window, calls, asked }
}

test('bridge leaves other services alone and never asks for a key', async () => {
  const h = harness()
  await h.window.fetch(host + '/rest/v1/player_profiles', { method: 'GET' })
  assert.equal(h.calls[0].input, host + '/rest/v1/player_profiles')
  assert.equal(h.asked.length, 0)
})
test('bridge sends the device-entered key only to the staging relay', async () => {
  const h = harness(), input = host + '/functions/v1/telegram-auth?action=begin'
  await h.window.fetch(input, { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } })
  assert.equal(h.calls[0].input, host + '/functions/v1/stage-auth-relay?action=begin')
  assert.equal(h.calls[0].init.headers.get('x-stage-key'), 'A'.repeat(22))
  assert.equal(h.calls[0].init.body, '{}')
  await h.window.fetch(input, { method: 'POST', body: '{}' })
  assert.equal(h.asked.length, 1)
})
test('cancel or malformed key does not send a request', async () => {
  const h = harness([null, 'short'])
  assert.equal((await h.window.fetch(host + '/functions/v1/telegram-auth?action=begin')).status, 503)
  assert.equal((await h.window.fetch(host + '/functions/v1/telegram-auth?action=begin')).status, 503)
  assert.equal(h.calls.length, 0)
})
test('a rejected key is forgotten and can be replaced', async () => {
  const h = harness(['A'.repeat(22), 'B'.repeat(22)], 404)
  await h.window.fetch(host + '/functions/v1/telegram-auth?action=begin')
  await h.window.fetch(host + '/functions/v1/telegram-auth?action=begin')
  assert.equal(h.asked.length, 2)
  assert.equal(h.calls[1].init.headers.get('x-stage-key'), 'B'.repeat(22))
})
