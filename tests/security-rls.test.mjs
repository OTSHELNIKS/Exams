// PostgreSQL RLS regression tests using an isolated PGlite database.
// Run after `npm ci` in app/: node tests/security-rls.test.mjs
// This exercises SQL permissions and policies, not Supabase Realtime/PostgREST.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const requireFromApp = createRequire(new URL('../app/package.json', import.meta.url))
const { PGlite } = await import(pathToFileURL(requireFromApp.resolve('@electric-sql/pglite')).href)
const db = new PGlite()
const migration = (name) => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8')
const ids = Array.from({ length: 15 }, (_, n) => `00000000-0000-4000-8000-${String(n + 1).padStart(12, '0')}`)

await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
  $$;
  grant execute on function auth.jwt() to public;
  grant usage on schema public, auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to public;
  -- Дефолты и обязательные поля совпадают со схемой рабочего проекта.
  create table public.player_profiles (
    user_id uuid primary key references auth.users(id), game_id text not null default '',
    game_server text not null default '', nick text not null default '', age text not null default '',
    gender text not null default '', rank text not null default '', roles text[] not null default '{}',
    regions text[] not null default '{}', bio text not null default '', heroes text[] not null default '{}',
    hero_classes text[] not null default '{}', socials text[] not null default '{}',
    extra_slots int not null default 0, avatar_url text not null default '',
    screenshot_urls text[] not null default '{}', updated_at timestamptz not null default now(),
    pts integer not null default 1000, is_banned boolean not null default false,
    ban_reason text, banned_at timestamptz, game_verified_at timestamptz, game_verified_id text,
    game_kda numeric(6,2), game_winrate integer, game_matches integer, game_stats_at timestamptz,
    matches_played integer not null default 0, wins integer not null default 0
  );
  alter table public.player_profiles enable row level security;
  create policy profile_read on public.player_profiles for select to authenticated using (user_id=auth.uid());
  create policy profile_insert on public.player_profiles for insert to authenticated with check (user_id=auth.uid());
  create policy profile_update on public.player_profiles for update to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());
  grant all on public.player_profiles to anon, authenticated, service_role;
`)
for (const id of ids) {
  await db.query('insert into auth.users(id) values ($1)', [id])
}
await db.exec(await migration('20261101120000_lobbies.sql'))
await db.exec('grant all on public.lobbies, public.lobby_members to anon, authenticated, service_role;')
await db.exec(`
  create function public.is_admin() returns boolean language sql stable as $$ select false $$;
  create view public.leaderboard as select user_id, nick, pts, rank, roles, avatar_url, updated_at from public.player_profiles;
`)
await db.exec(await migration('20261101150000_matches.sql'))
await db.exec('grant all on public.matches, public.match_players to anon, authenticated, service_role;')
await db.exec(await migration('20261105010000_profile_write_permissions.sql'))
await db.exec(await migration('20261105020000_lobby_security.sql'))
await db.exec(await migration('20261105030000_pause_unverified_rating.sql'))
await db.exec(await migration('20261105040000_authoritative_draft.sql'))
await db.exec(await migration('20261105050000_profile_registered_only.sql'))

after(async () => db.close())
async function asUser(id, fn) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${id}', false);`)
  try { return await fn() } finally { await db.exec('reset role') }
}
async function asAnon(fn) {
  await db.exec("set role anon; select set_config('request.jwt.claim.sub', '', false);")
  try { return await fn() } finally { await db.exec('reset role') }
}
const rows = async (sql, params = []) => (await db.query(sql, params)).rows

test('anonymous Supabase sessions cannot create or edit profiles', async () => {
  await asUser(ids[14], async () => {
    await db.exec(`select set_config('request.jwt.claims', '{"is_anonymous":true}', false)`)
    try {
      await assert.rejects(db.query("insert into public.player_profiles (user_id, nick) values ($1, 'Guest')", [ids[14]]), /row-level security/)
      await db.exec('reset role')
      await db.query("insert into public.player_profiles (user_id,nick) values ($1,'Existing')", [ids[14]])
      await db.exec('set role authenticated')
      const changed = await rows("update public.player_profiles set nick='Guest' where user_id=$1 returning nick", [ids[14]])
      assert.deepEqual(changed, [])
    } finally { await db.exec("select set_config('request.jwt.claims', '{}', false)") }
  })
})

test('profile upsert remains possible, including all actual client fields', async () => {
  await asUser(ids[0], async () => {
    const q = `insert into public.player_profiles
      (user_id, game_id, game_server, nick, age, gender, rank, roles, regions, bio,
       heroes, hero_classes, socials, extra_slots, avatar_url, screenshot_urls, updated_at)
      values ($1,'123','1234','Player','18','','', '{}','{}','','{}','{}','{}',0,'','{}',now())
      on conflict (user_id) do update set game_id=excluded.game_id, game_server=excluded.game_server,
      nick=excluded.nick, age=excluded.age, gender=excluded.gender, rank=excluded.rank,
      roles=excluded.roles, regions=excluded.regions, bio=excluded.bio, heroes=excluded.heroes,
      hero_classes=excluded.hero_classes, socials=excluded.socials, extra_slots=excluded.extra_slots,
      avatar_url=excluded.avatar_url, screenshot_urls=excluded.screenshot_urls, updated_at=excluded.updated_at`
    await db.query(q, [ids[0]])
    await db.query(q, [ids[0]])
    assert.equal((await rows('select nick from public.player_profiles'))[0].nick, 'Player')
  })
})

test('client cannot write protected rating, ban, verified and game-stat fields, or truncate', async () => {
  await asUser(ids[0], async () => {
    for (const [col, value] of Object.entries({ pts: '9000', wins: '2', matches_played: '2', is_banned: 'true', game_verified_id: "'123'", game_winrate: '99' })) {
      await assert.rejects(db.exec(`update public.player_profiles set ${col}=${value}`), /permission denied/i, col)
    }
    await assert.rejects(db.query('insert into public.player_profiles (user_id, pts) values ($1, 9000)', [ids[0]]), /permission denied/i)
    await assert.rejects(db.exec('truncate public.player_profiles'), /permission denied/i)
  })
})

test('service role can still write protected fields for server-side integrations', async () => {
  await db.exec('set role service_role')
  try {
    const result = await rows('update public.player_profiles set game_verified_id=$1, pts=$2 where user_id=$3 returning game_verified_id, pts', ['123', 1200, ids[0]])
    assert.equal(result[0].game_verified_id, '123')
    assert.equal(result[0].pts, 1200)
  } finally { await db.exec('reset role') }
})

test('profile RLS still prevents reading or changing another player', async () => {
  await db.query('insert into public.player_profiles(user_id,nick) values ($1,$2)', [ids[1], 'Other'])
  await asUser(ids[0], async () => {
    assert.equal((await rows('select * from public.player_profiles where user_id=$1', [ids[1]])).length, 0)
    assert.equal((await rows("update public.player_profiles set nick='Oops' where user_id=$1 returning user_id", [ids[1]])).length, 0)
  })
})

let lobbyId, code
test('rating pause preserves points and pending history, including admin resolution path', async () => {
  const matchId = '10000000-0000-4000-8000-000000000001'
  await db.query("insert into public.matches(id,team_a,team_b,winner,reported_by) values ($1, ARRAY[$2]::uuid[], ARRAY[$3]::uuid[], 'a', $2)", [matchId, ids[0], ids[1]])
  const before = (await rows('select pts, matches_played, wins from public.player_profiles where user_id=$1', [ids[0]]))[0]
  await asUser(ids[0], async () => {
    assert.equal((await rows("select public.report_match(ARRAY[$1]::uuid[], ARRAY[$2]::uuid[], 'a', null) as result", [ids[0], ids[1]]))[0].result.error, 'rating_paused')
    assert.equal((await rows("select public.resolve_match($1, 'a') as result", [matchId]))[0].result.error, 'rating_paused')
    await assert.rejects(db.query("insert into public.matches (team_a,team_b,winner,reported_by) values (ARRAY[$1]::uuid[],ARRAY[$2]::uuid[],'a',$1)", [ids[0], ids[1]]), /permission denied/i)
  })
  await asUser(ids[1], async () => assert.equal((await rows('select public.confirm_match($1) as result', [matchId]))[0].result.error, 'rating_paused'))
  const after = (await rows('select pts, matches_played, wins from public.player_profiles where user_id=$1', [ids[0]]))[0]
  assert.deepEqual(after, before)
  assert.equal((await rows('select status from public.matches where id=$1', [matchId]))[0].status, 'pending')
  await asAnon(async () => await assert.rejects(db.query('select public.confirm_match($1)', [matchId]), /permission denied/i))
})

test('host can create a lobby and set room details', async () => {
  await asUser(ids[0], async () => {
    const created = (await rows("select public.create_lobby('ru') as result"))[0].result
    lobbyId = created.lobby_id; code = created.code
    assert.match(code, /^\d{6}$/)
    assert.equal((await rows("update public.lobbies set room_id='123456',room_password='secret' where id=$1 returning id", [lobbyId])).length, 1)
  })
})

test('outsider cannot read lobby secrets or member view, or insert membership directly', async () => {
  await asUser(ids[2], async () => {
    assert.equal((await rows('select * from public.lobbies where id=$1', [lobbyId])).length, 0)
    assert.equal((await rows('select * from public.lobby_members where lobby_id=$1', [lobbyId])).length, 0)
    assert.equal((await rows('select * from public.lobby_members_public where lobby_id=$1', [lobbyId])).length, 0)
    await assert.rejects(db.query('insert into public.lobby_members (lobby_id,user_id) values ($1,$2)', [lobbyId,ids[2]]), /permission denied/i)
  })
})

test('anonymous calls and access are denied', async () => {
  await asAnon(async () => {
    await assert.rejects(db.query('select * from public.lobbies'), /permission denied/i)
    await assert.rejects(db.query('select public.join_lobby($1)', [code]), /permission denied/i)
  })
})

test('joining with code grants access, but cannot change other members or lobby identity', async () => {
  await asUser(ids[1], async () => {
    const joined = (await rows('select public.join_lobby($1) as result', [code]))[0].result
    assert.equal(joined.lobby_id, lobbyId)
    assert.equal((await rows('select room_password from public.lobbies where id=$1', [lobbyId]))[0].room_password, 'secret')
    assert.equal((await rows('select * from public.lobby_members_public where lobby_id=$1', [lobbyId])).length, 2)
    assert.equal((await rows('update public.lobby_members set checked_in=true where user_id=$1 returning user_id', [ids[0]])).length, 0)
    assert.equal((await rows('update public.lobby_members set checked_in=true where user_id=$1 returning user_id', [ids[1]])).length, 1)
    await assert.rejects(db.query('update public.lobby_members set user_id=$1 where user_id=$2', [ids[2],ids[1]]), /permission denied/i)
    await assert.rejects(db.query('update public.lobbies set host_id=$1 where id=$2', [ids[1],lobbyId]), /permission denied/i)
    assert.equal((await rows("update public.lobbies set room_id='bad' where id=$1 returning id", [lobbyId])).length, 0)
    assert.equal((await rows('select public.join_lobby($1) as result', [code]))[0].result.lobby_id, lobbyId)
  })
})

test('capacity is 10 including host; existing members can reconnect when full', async () => {
  for (const id of ids.slice(3, 11)) {
    await asUser(id, async () => assert.equal((await rows('select public.join_lobby($1) as result', [code]))[0].result.lobby_id, lobbyId))
  }
  await asUser(ids[11], async () => assert.equal((await rows('select public.join_lobby($1) as result', [code]))[0].result.error, 'full'))
  await asUser(ids[1], async () => assert.equal((await rows('select public.join_lobby($1) as result', [code]))[0].result.lobby_id, lobbyId))
})

test('access is isolated between two simultaneous lobbies', async () => {
  await asUser(ids[13], async () => {
    const second = (await rows("select public.create_lobby('eu') as result"))[0].result
    assert.ok(second.lobby_id)
    assert.equal((await rows('select * from public.lobbies where id=$1', [lobbyId])).length, 0)
    assert.equal((await rows('select * from public.lobby_members_public where lobby_id=$1', [lobbyId])).length, 0)
    assert.equal((await rows('select * from public.lobbies where id=$1', [second.lobby_id])).length, 1)
  })
})

test('join attempts are throttled, even for a correct code, then reset', async () => {
  const second = (await rows('select id,code from public.lobbies where host_id=$1', [ids[13]]))[0]
  const usedCodes = new Set((await rows('select code from public.lobbies')).map((l) => l.code))
  const wrong = ['999999', '888888', '777777'].find((c) => !usedCodes.has(c))
  await asUser(ids[12], async () => {
    for (let i=0; i<12; i++) assert.equal((await rows('select public.join_lobby($1) as result', [wrong]))[0].result.error, 'not_found')
    assert.equal((await rows('select public.join_lobby($1) as result', [second.code]))[0].result.error, 'rate_limited')
    await assert.rejects(db.exec('select * from public.lobby_join_attempts'), /permission denied/i)
  })
  await db.query("update public.lobby_join_attempts set window_started_at=now()-interval '16 minutes' where user_id=$1", [ids[12]])
  await asUser(ids[12], async () => assert.equal((await rows('select public.join_lobby($1) as result', [second.code]))[0].result.lobby_id, second.id))
  assert.equal((await rows('select count(*)::int as n from public.lobby_join_attempts where user_id=$1', [ids[12]]))[0].n, 0)
})

test('leaving removes access and host closes the lobby', async () => {
  await asUser(ids[1], async () => {
    assert.equal((await rows('select public.leave_lobby($1) as result', [lobbyId]))[0].result.ok, true)
    assert.equal((await rows('select * from public.lobbies where id=$1', [lobbyId])).length, 0)
  })
  await asUser(ids[0], async () => assert.equal((await rows('select public.leave_lobby($1) as result', [lobbyId]))[0].result.ok, true))
  await asUser(ids[11], async () => assert.equal((await rows('select public.join_lobby($1) as result', [code]))[0].result.error, 'closed'))
})

let draftLobbyId, draftCode, draftState
const draftRpc = async (name, id, args = []) => (await rows(`select public.${name}(${[id, ...args].map((_, n) => '$' + (n + 1)).join(',')}) as result`, [id, ...args]))[0].result

test('5v5 draft requires an actual ten-player lobby and the host to start', async () => {
  await asUser(ids[14], async () => {
    const created = (await rows("select public.create_lobby('eu') as result"))[0].result
    draftLobbyId = created.lobby_id; draftCode = created.code
    assert.equal((await draftRpc('start_lobby_draft', draftLobbyId)).error, 'need_ten')
  })
  await asUser(ids[0], async () => {
    assert.equal((await rows('select public.join_lobby($1) as result', [draftCode]))[0].result.lobby_id, draftLobbyId)
    assert.equal((await draftRpc('start_lobby_draft', draftLobbyId)).error, 'not_host')
  })
  for (const id of ids.slice(1, 9)) {
    await asUser(id, async () => assert.equal((await rows('select public.join_lobby($1) as result', [draftCode]))[0].result.lobby_id, draftLobbyId))
  }
  await asUser(ids[9], async () => {
    assert.equal((await draftRpc('get_lobby_draft', draftLobbyId)).error, 'not_member')
    await assert.rejects(db.exec('select * from public.lobby_drafts'), /permission denied/i)
    await assert.rejects(db.query('select public._draft_pick($1,$2,false)', [draftLobbyId, ids[1]]), /permission denied/i)
  })
  await asUser(ids[14], async () => {
    draftState = await draftRpc('start_lobby_draft', draftLobbyId)
    assert.equal(draftState.status, 'active')
    assert.equal(draftState.captain_a, ids[14])
    assert.equal(draftState.captain_b, ids[0]) // 1200 PTS, strongest in this lobby
    assert.equal(draftState.pool.length, 8)
    assert.equal(draftState.turn, 'a')
  })
})

test('only the active captain may pick, and auto-pick cannot run early', async () => {
  const target = draftState.pool[0].user_id
  await asUser(ids[0], async () => {
    assert.equal((await draftRpc('pick_lobby_draft_player', draftLobbyId, [target])).error, 'not_turn')
    assert.equal((await draftRpc('auto_pick_lobby_draft_player', draftLobbyId)).error, 'too_early')
  })
  await asUser(ids[14], async () => assert.equal((await draftRpc('pick_lobby_draft_player', draftLobbyId, [ids[12]])).error, 'not_in_pool'))
  await db.query("update public.lobby_drafts set deadline=clock_timestamp()-interval '1 second' where lobby_id=$1", [draftLobbyId])
  await asUser(ids[14], async () => assert.equal((await draftRpc('pick_lobby_draft_player', draftLobbyId, [target])).error, 'turn_expired'))
  await asUser(ids[1], async () => { draftState = await draftRpc('auto_pick_lobby_draft_player', draftLobbyId) })
  assert.equal(draftState.team_a.length, 2)
  assert.equal(draftState.team_a[1].user_id, target)
  assert.equal(draftState.turn, 'b')
})

test('captain transfer is restricted to the current captain and same team', async () => {
  const teammateA = draftState.team_a[1].user_id
  await asUser(ids[14], async () => {
    assert.equal((await draftRpc('transfer_draft_captain', draftLobbyId, [ids[0]])).error, 'not_teammate')
    assert.equal((await draftRpc('transfer_lobby_host', draftLobbyId, [ids[0]])).error, 'use_draft_transfer')
    draftState = await draftRpc('transfer_draft_captain', draftLobbyId, [teammateA])
    assert.equal(draftState.captain_a, teammateA)
    assert.equal(draftState.team_a.find((x) => x.user_id===teammateA).isCaptain, true)
  })
  await asUser(ids[14], async () => assert.equal((await draftRpc('transfer_draft_captain', draftLobbyId, [teammateA])).error, 'not_captain'))
  await asUser(ids[0], async () => assert.equal((await draftRpc('transfer_draft_captain', draftLobbyId, [teammateA])).error, 'not_teammate'))
})

test('both captains finish a shared 5v5 draft; the result is identical for all members', async () => {
  while (draftState.status === 'active') {
    const captain = draftState.turn === 'a' ? draftState.captain_a : draftState.captain_b
    const target = draftState.pool[0].user_id
    await asUser(captain, async () => { draftState = await draftRpc('pick_lobby_draft_player', draftLobbyId, [target]) })
    assert.equal(draftState.error, undefined)
  }
  assert.equal(draftState.status, 'complete')
  assert.equal(draftState.team_a.length, 5)
  assert.equal(draftState.team_b.length, 5)
  assert.equal(new Set([...draftState.team_a, ...draftState.team_b].map((p) => p.user_id)).size, 10)
  await asUser(ids[8], async () => {
    const other = await draftRpc('get_lobby_draft', draftLobbyId)
    const { server_time: _a, ...expected } = draftState
    const { server_time: _b, ...observed } = other
    assert.deepEqual(observed, expected)
  })
  const bTeammate = draftState.team_b.find((p) => p.user_id !== draftState.captain_b).user_id
  await asUser(ids[0], async () => { draftState = await draftRpc('transfer_draft_captain', draftLobbyId, [bTeammate]) })
  assert.equal(draftState.captain_b, bTeammate)
  assert.equal((await rows('select host_id from public.lobbies where id=$1', [draftLobbyId]))[0].host_id, ids[14])
})

test('a departure cancels the draft, reopens the lobby and permits a fresh draft after refill', async () => {
  await asUser(ids[8], async () => assert.equal((await draftRpc('leave_lobby', draftLobbyId)).ok, true))
  await asUser(ids[14], async () => {
    assert.equal((await draftRpc('get_lobby_draft', draftLobbyId)).status, 'cancelled')
    assert.equal((await draftRpc('start_lobby_draft', draftLobbyId)).error, 'need_ten')
  })
  await asUser(ids[9], async () => assert.equal((await rows('select public.join_lobby($1) as result', [draftCode]))[0].result.lobby_id, draftLobbyId))
  await asUser(ids[14], async () => {
    const restarted = await draftRpc('start_lobby_draft', draftLobbyId)
    assert.equal(restarted.status, 'active')
    assert.equal(restarted.team_a.length, 1)
    assert.equal(restarted.team_b.length, 1)
    assert.equal(restarted.pool.length, 8)
  })
})
