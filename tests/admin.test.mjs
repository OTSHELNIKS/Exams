// NAME MLBB — admin panel guardrails (static checks, no network, no deps).
// Ensures the admin tab stays hidden for regular users and that the analytics
// RPC can never be executed by a non-admin.
// Run: node tests/admin.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

const migration = read('supabase/migrations/20261030150000_admin_analytics.sql')
const adminScreen = read('app/src/admin.jsx')
const app = read('app/src/App.jsx')

let passed = 0
let failed = 0
function test(name, fn) {
  try {
    fn()
    passed += 1
    console.log('PASS ' + name)
  } catch (error) {
    failed += 1
    console.log('FAIL ' + name + ' — ' + error.message)
  }
}

test('T-ADM-01 admin_stats is SECURITY DEFINER with a pinned search_path', () => {
  assert.match(migration, /create or replace function public\.admin_stats\(\)[\s\S]*security definer[\s\S]*set search_path = public, pg_temp/)
})

test('T-ADM-02 admin_stats refuses non-admins before reading anything', () => {
  assert.match(migration, /if not public\.is_admin\(\) then\s*\n\s*raise exception 'admin_stats: forbidden' using errcode = '42501'/)
})

test('T-ADM-03 analytics functions are revoked from anon and public', () => {
  for (const fn of ['admin_stats', 'is_admin']) {
    assert.match(migration, new RegExp(`revoke all on function public\\.${fn}\\(\\) from public;`))
    assert.match(migration, new RegExp(`revoke all on function public\\.${fn}\\(\\) from anon;`))
    assert.match(migration, new RegExp(`grant execute on function public\\.${fn}\\(\\) to authenticated;`))
  }
})

test('T-ADM-04 is_admin looks only at the caller row', () => {
  assert.match(migration, /where a\.user_id = \(select auth\.uid\(\)\)/)
})

test('T-ADM-05 dashboard blocks rendering without the admin flag', () => {
  assert.match(adminScreen, /if \(!supabase \|\| !isAdmin\) \{[\s\S]*?Нет доступа\. Этот раздел только для администраторов\./)
})

test('T-ADM-06 dashboard never queries data when not an admin', () => {
  assert.match(adminScreen, /const load = async \(\) => \{\s*\n\s*if \(!supabase \|\| !isAdmin\) return/)
})

test('T-ADM-07 admin screen ships from its own module', () => {
  assert.match(app, /import \{ AdminScreen \} from '\.\/admin\.jsx'/)
  assert.match(app, /\{isAdmin && \(/)
})

test('T-ADM-08 statistics come from the gated RPC, not from wide-open tables', () => {
  assert.match(adminScreen, /supabase\.rpc\('admin_stats'\)/)
  assert.match(adminScreen, /statsError/)
})

test('T-ADM-09 moderation policies are limited to authenticated users', () => {
  assert.match(migration, /alter policy "Users can read own moderation reviews" on public\.moderation_reviews to authenticated/)
})

test('T-ADM-10 player card is an overlay portaled to body, not inline in the list', () => {
  assert.match(adminScreen, /<Modal open=\{Boolean\(row\)\}/)
  assert.match(adminScreen, /from '\.\/ui\.jsx'/)
  assert.doesNotMatch(adminScreen, /className="modal"/, 'карточка не должна рисоваться внутри ленты')
})

test('T-ADM-11 overlay freezes background scrolling while open', () => {
  const ui = read('app/src/ui.jsx')
  const css = read('app/src/styles.css')
  assert.match(ui, /createPortal\(/)
  assert.match(ui, /document\.documentElement\.classList\.add\('is-modal-open'\)/)
  assert.match(ui, /n\.style\.overflow = 'hidden'/)
  assert.match(css, /html\.is-modal-open[^{]*\{[^}]*overflow: hidden !important/)
  assert.match(css, /\.modal \{[^}]*position: fixed/)
})

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`)
if (failed > 0) process.exit(1)
