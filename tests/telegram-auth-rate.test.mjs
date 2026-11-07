// SQL лимит в PGlite: изоляция, окна, отказ и запрет прямого доступа.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
const req=createRequire(new URL('../app/package.json',import.meta.url));const {PGlite}=await import(pathToFileURL(req.resolve('@electric-sql/pglite')).href);const db=new PGlite()
await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create table public.telegram_auth_requests(id uuid,expires_at timestamptz,status text);grant usage on schema public to anon,authenticated,service_role;`)
await db.exec(await readFile(new URL('../supabase/migrations/20261105090000_telegram_auth_rate_limit.sql',import.meta.url),'utf8'))
after(()=>db.close())
const val=async(h,a)=> (await db.query('select public.claim_telegram_auth_rate_limit($1,$2) v',[h,a])).rows[0].v
const a='a'.repeat(64),b='b'.repeat(64)
test('восемь запросов на вход за пять минут, другие клиенты не блокируются',async()=>{for(let i=0;i<8;i++)assert.equal((await val(a,'begin')).ok,true);assert.equal((await val(a,'begin')).ok,false);assert.equal((await val(b,'begin')).ok,true);await db.exec("update public.telegram_auth_rate_limits set window_started_at=now()-interval '301 seconds' where identity_hash='"+a+"'");assert.equal((await val(a,'begin')).ok,true)})
test('опрос имеет отдельный лимит, не расходует квоту начала',async()=>{for(let i=0;i<120;i++)assert.equal((await val(a,'complete')).ok,true);assert.equal((await val(a,'complete')).ok,false);assert.equal((await val(a,'begin')).ok,true);await db.exec("update public.telegram_auth_rate_limits set window_started_at=now()-interval '61 seconds' where action='complete'");assert.equal((await val(a,'complete')).ok,true)})
test('невалидный хэш, канал и доступ обычных ролей отклоняются',async()=>{assert.equal((await val('anything','begin')).error,'invalid');assert.equal((await val(a,'other')).error,'invalid');for(const role of ['anon','authenticated']){await db.exec('set role '+role);try{await assert.rejects(val(a,'begin'),/permission denied/);await assert.rejects(db.query('select * from public.telegram_auth_rate_limits'),/permission denied/)}finally{await db.exec('reset role')}}})
