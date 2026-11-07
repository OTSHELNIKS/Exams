// Реальная миграция в изолированном PGlite. Настоящий PostgREST и гонки не проверяются.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
const req=createRequire(new URL('../app/package.json',import.meta.url))
const {PGlite}=await import(pathToFileURL(req.resolve('@electric-sql/pglite')).href)
const db=new PGlite()
const a='00000000-0000-4000-8000-000000000001',b='00000000-0000-4000-8000-000000000002',anon='00000000-0000-4000-8000-000000000003'
await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth; create table auth.users(id uuid primary key,is_anonymous boolean not null default false);
insert into auth.users values('${a}',false),('${b}',false),('${anon}',true);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema public,auth to anon,authenticated,service_role;
create table public.telegram_links(user_id uuid primary key references auth.users(id),tg_chat_id bigint unique not null,tg_username text not null default '');
alter table public.telegram_links enable row level security;
create policy own_read on public.telegram_links for select to authenticated using(auth.uid()=user_id);
create policy own_delete on public.telegram_links for delete to authenticated using(auth.uid()=user_id);
grant select,insert,update,delete on public.telegram_links to authenticated;
create table public.telegram_link_codes(code text primary key,user_id uuid references auth.users(id),expires_at timestamptz,created_at timestamptz default now());
alter table public.telegram_link_codes enable row level security;
create policy "Users can manage their own link codes" on public.telegram_link_codes for all to authenticated using (auth.uid()=user_id) with check (auth.uid()=user_id);
grant all on public.telegram_link_codes to authenticated;
insert into public.telegram_links values('${a}',111,'legacy');
insert into public.telegram_link_codes(code,user_id,expires_at) values('123456','${a}',now()+interval '10 min');`)
await db.exec(await readFile(new URL('../supabase/migrations/20261105055000_secure_telegram_link.sql',import.meta.url),'utf8'))
after(()=>db.close())
const value=async(q,args=[]) => (await db.query(q,args)).rows[0].v
async function issue(user=a) { await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]); await db.exec('set role authenticated'); try {return await value('select public.issue_telegram_link() v')} finally {await db.exec('reset role')} }
const confirm=(token,chat=111)=>value('select public.confirm_telegram_link($1,$2,$3) v',[token,chat,'tester'])
async function clear(){await db.exec('delete from public.telegram_link_challenges; delete from public.telegram_link_issue_throttle; delete from public.telegram_link_confirm_throttle; delete from public.telegram_links;')}
test('старые коды удалены, старая связка не помечена подтверждённой',async()=>{assert.equal(await value('select count(*)::int v from public.telegram_link_codes'),0);assert.equal(await value('select verified_at is null v from public.telegram_links where tg_chat_id=111'),true);await db.exec('set role authenticated');try{await assert.rejects(db.query("insert into public.telegram_link_codes(code) values('123456')"),/permission denied/)}finally{await db.exec('reset role')}})
test('только зарегистрированный пользователь может выпустить секрет; лимит выдачи',async()=>{await clear();assert.equal((await issue(anon)).error,'auth_required');const r=await issue();assert.match(r.token,/^[a-f0-9]{48}$/);assert.equal((await issue()).error,'too_often');assert.notEqual((await value('select token_hash v from public.telegram_link_challenges')),r.token);assert.equal(await value('select user_id::text v from public.telegram_link_challenges'),a)})
test('подтверждение атомарно связывает чат, код одноразовый',async()=>{await clear();const r=await issue();assert.equal((await confirm('a'.repeat(48))).error,'invalid');assert.equal(await value('select count(*)::int v from public.telegram_links'),0);assert.equal((await confirm(r.token)).ok,true);assert.equal(await value('select verified_at is not null v from public.telegram_links where tg_chat_id=111'),true);assert.equal((await confirm(r.token)).error,'invalid')})
test('истекшая и заменённая ссылки не привязывают аккаунт',async()=>{await clear();let r=await issue();await db.exec("update public.telegram_link_challenges set expires_at=now()-interval '1 second'");assert.equal((await confirm(r.token)).error,'invalid');await db.exec("update public.telegram_link_issue_throttle set last_issued_at=now()-interval '21 seconds'");const s=await issue();assert.notEqual(r.token,s.token);assert.equal((await confirm(r.token)).error,'invalid');assert.equal((await confirm(s.token)).ok,true)})
test('старый бот не может сохранить подтверждение при смене chat ID',async()=>{await clear();const r=await issue();await confirm(r.token);await db.exec("update public.telegram_links set tg_chat_id=222,verified_at=now() where tg_chat_id=111");assert.equal(await value('select verified_at is null v from public.telegram_links where tg_chat_id=222'),true)})
test('доступ к RPC и таблицам закрыт другим ролям',async()=>{for(const role of ['anon','authenticated']){await db.exec(`set role ${role}`);try{await assert.rejects(db.query("select public.confirm_telegram_link($1,111,'x')",['a'.repeat(48)]),/permission denied/);await assert.rejects(db.query('select * from public.telegram_link_challenges'),/permission denied/)}finally{await db.exec('reset role')}}await db.exec('set role anon');try{await assert.rejects(db.query('select public.issue_telegram_link()'),/permission denied/)}finally{await db.exec('reset role')}})
test('после десяти неверных попыток чат временно ограничен',async()=>{await clear();for(let i=0;i<10;i++)assert.equal((await confirm('b'.repeat(48))).error,'invalid');const r=await issue();assert.equal((await confirm(r.token)).error,'too_often');await db.exec("update public.telegram_link_confirm_throttle set window_started_at=now()-interval '61 seconds'");assert.equal((await confirm(r.token)).ok,true)})
test('перепривязка чата обновляет только после подтверждения',async()=>{await clear();const first=await issue();await confirm(first.token,111);const second=await issue(b);assert.equal(await value('select user_id::text v from public.telegram_links where tg_chat_id=111'),a);assert.equal((await confirm(second.token,111)).ok,true);assert.equal(await value('select user_id::text v from public.telegram_links where tg_chat_id=111'),b)})
test('отмена владельцем отзывает только указанную ссылку и не затрагивает новую',async()=>{
  await clear(); const first=await issue()
  await db.exec("update public.telegram_link_issue_throttle set last_issued_at=now()-interval '21 seconds'")
  const second=await issue()
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[a]);await db.exec('set role authenticated')
  try {assert.equal((await value('select public.cancel_telegram_link($1) v',[first.token])).ok,true)} finally {await db.exec('reset role')}
  assert.equal((await confirm(second.token)).ok,true)
  await clear();const third=await issue();await db.query("select set_config('request.jwt.claim.sub',$1,false)",[b]);await db.exec('set role authenticated')
  try {await value('select public.cancel_telegram_link($1) v',[third.token])} finally {await db.exec('reset role')}
  assert.equal((await confirm(third.token)).ok,true)
  await clear();const fourth=await issue();await db.query("select set_config('request.jwt.claim.sub',$1,false)",[a]);await db.exec('set role authenticated')
  try {await value('select public.cancel_telegram_link($1) v',[fourth.token])} finally {await db.exec('reset role')}
  assert.equal((await confirm(fourth.token)).error,'invalid')
})
test('пользователь не может напрямую установить подтверждение или создать связку',async()=>{
  await clear();const r=await issue();await confirm(r.token)
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[a]);await db.exec('set role authenticated')
  try {
    const update=await db.query('update public.telegram_links set tg_chat_id=222 where user_id=$1 returning user_id',[a]);assert.equal(update.rows.length,0)
    await assert.rejects(db.query('insert into public.telegram_links(user_id,tg_chat_id,verified_at,link_instance_id) values($1,222,now(),gen_random_uuid())',[b]),/row-level security/)
  } finally { await db.exec('reset role') }
  assert.equal(await value('select tg_chat_id v from public.telegram_links where user_id=$1',[a]),111)
})
