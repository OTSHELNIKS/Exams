// Изолированный SQL: не заменяет тесты конкурентности и реального PostgREST.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
const req = createRequire(new URL('../app/package.json', import.meta.url))
const { PGlite } = await import(pathToFileURL(req.resolve('@electric-sql/pglite')).href)
const db = new PGlite()
const id='00000000-0000-4000-8000-000000000001', request='00000000-0000-4000-8000-000000000002', bot='a'.repeat(64), verifier='b'.repeat(64)
await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; create schema auth; create table auth.users(id uuid primary key); insert into auth.users values('${id}'); create table public.telegram_links(user_id uuid primary key,tg_chat_id bigint unique,verified_at timestamptz default now(),link_instance_id uuid default gen_random_uuid()); insert into public.telegram_links(user_id,tg_chat_id) values('${id}',111); grant usage on schema public to anon,authenticated,service_role;`)
for (const file of ['20261105070000_telegram_token_auth.sql','20261105080000_telegram_reactions.sql']) await db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'))
after(async()=>db.close())
const val=async(q,args=[]) => (await db.query(q,args)).rows[0].v
const begin=()=>val('select public.begin_telegram_token_auth($1,$2,$3) v',[request,bot,verifier])
const approve=(chat=111)=>val('select public.approve_telegram_token_auth($1,$2) v',[bot,chat])
const consume=(v=verifier)=>val('select public.consume_telegram_token_auth($1,$2) v',[request,v])
async function reset(){await db.exec('delete from public.telegram_auth_requests; delete from public.telegram_links;');await db.query('insert into public.telegram_links(user_id,tg_chat_id) values ($1,111)',[id])}
test('два разных секрета и подтверждение связанного чата; токен однократен',async()=>{await reset();assert.equal((await begin()).ok,true);assert.equal((await consume()).status,'pending');assert.equal((await consume('c'.repeat(64))).error,'invalid');assert.equal((await approve(222)).error,'not_linked');assert.equal((await approve()).ok,true);assert.equal((await approve()).error,'invalid');assert.equal((await consume()).user_id,id);assert.equal((await consume()).error,'invalid')})
test('смена связки между подтверждением и входом отменяет вход',async()=>{await reset();await begin();await approve();await db.exec('delete from public.telegram_links');assert.equal((await consume()).error,'invalid');await db.query('insert into public.telegram_links(user_id,tg_chat_id) values ($1,111)',[id]);assert.equal((await consume()).error,'invalid')})
test('истёкший запрос не принимается',async()=>{await reset();await begin();await db.exec("update public.telegram_auth_requests set expires_at=now()-interval '1 second'");assert.equal((await approve()).error,'invalid');assert.equal((await consume()).error,'invalid')})
test('доступ только у service_role',async()=>{for(const role of ['anon','authenticated']){await db.exec(`set role ${role}`);try{await assert.rejects(begin(),/permission denied/);await assert.rejects(db.query('select * from public.telegram_auth_requests'),/permission denied/);await assert.rejects(db.query('select public.claim_telegram_reaction(111)'),/permission denied/)}finally{await db.exec('reset role')}}})
test('реакции не чаще раза в минуту для каждого чата',async()=>{const claim=()=>val('select public.claim_telegram_reaction(111) v');assert.equal((await claim()).ok,true);assert.equal((await claim()).ok,false);assert.equal((await val('select public.claim_telegram_reaction(222) v')).ok,true);await db.exec("update public.telegram_reaction_throttle set last_reaction_at=now()-interval '61 seconds' where tg_chat_id=111");assert.equal((await claim()).ok,true)})

test('старая неподтверждённая связка не может подтвердить вход',async()=>{await reset();await begin();await db.exec('update public.telegram_links set verified_at=null');assert.equal((await approve()).error,'not_linked')})

test('отвязка и повторная привязка того же чата отменяют ранее подтверждённый вход',async()=>{await reset();await begin();await approve();await db.exec('delete from public.telegram_links');await db.query('insert into public.telegram_links(user_id,tg_chat_id) values ($1,111)',[id]);assert.equal((await consume()).error,'invalid')})
