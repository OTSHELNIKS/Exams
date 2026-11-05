// Проверяет настоящие запросы supabase-js к локальному mock HTTP transport.
// Ни один вызов не уходит в Supabase, запись профилей не выполняется.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rmSync } from 'node:fs'

const here = dirname(fileURLToPath(import.meta.url))
const app = join(here, '../app')
const nm = join(app, 'node_modules')
const esbuild = (await import(join(nm, 'esbuild/lib/main.js'))).default
const bundle = join(app, '.lobby-api-under-test.mjs')
const calls = []
let reply = []
const originalFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url
  calls.push({ url, init })
  return new Response(JSON.stringify(reply), { status: 200, headers: { 'Content-Type': 'application/json' } })
}
await esbuild.build({
  entryPoints: [join(app, 'src/supabase.js')], bundle: true, format: 'esm', outfile: bundle,
  external: ['@supabase/supabase-js'],
  define: { 'import.meta.env': JSON.stringify({ VITE_SUPABASE_URL: 'https://supabase.example.invalid', VITE_SUPABASE_PUBLISHABLE_KEY: 'test-publishable-key' }) },
  logLevel: 'silent',
})
const api = await import(bundle)
after(() => { globalThis.fetch = originalFetch; rmSync(bundle, { force: true }) })

test('сохранение профиля посылает только поля, разрешённые в миграции', async () => {
  reply = []
  const payload = api.profileToRow({ nick: 'Player', roles: ['tank'], regions: ['ru'] }, '123456', '1234', 'u1')
  const result = await api.supabase.from('player_profiles').upsert(payload)
  assert.equal(result.error, null)
  const request = calls.at(-1)
  assert.equal(request.init.method, 'POST')
  const sent = JSON.parse(request.init.body)
  const allowed = ['user_id', 'game_id', 'game_server', 'nick', 'age', 'gender', 'rank', 'roles', 'regions', 'bio', 'heroes', 'hero_classes', 'socials', 'extra_slots', 'avatar_url', 'screenshot_urls', 'updated_at']
  assert.deepEqual(Object.keys(sent).sort(), allowed.sort())
  assert.equal(sent.nick, 'Player')
})

test('сохранение комнаты не сообщает об успехе, если RLS не позволила изменить строку', async () => {
  reply = []
  const result = await api.setLobbyRoom('lobby-1', '123456', 'pass')
  assert.equal(result.error, 'not_found')
  const request = calls.at(-1)
  assert.equal(request.init.method, 'PATCH')
  assert.match(request.url, /lobbies/)
  assert.match(request.url, /select=id/)
})

test('обновление собственной отметки проверяет изменённую строку', async () => {
  reply = [{ user_id: 'u1' }]
  assert.deepEqual(await api.setLobbyCheckedIn('lobby-1', 'u1', true), { ok: true })
  const request = calls.at(-1)
  assert.equal(request.init.method, 'PATCH')
  assert.match(request.url, /lobby_members/)
  assert.match(request.url, /select=user_id/)
  assert.equal(JSON.parse(request.init.body).checked_in, true)
  reply = []
  assert.equal((await api.setLobbyCheckedIn('lobby-1', 'u1', true)).error, 'not_found')
})

test('ошибка из RPC выхода передаётся экрану', async () => {
  reply = { error: 'unauthorized' }
  assert.equal((await api.leaveLobby('lobby-1')).error, 'unauthorized')
})
