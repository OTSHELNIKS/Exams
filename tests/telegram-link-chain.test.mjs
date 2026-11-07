// Все связанные миграции последовательно на изолированных данных.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
const req=createRequire(new URL('../app/package.json',import.meta.url))
const {PGlite}=await import(pathToFileURL(req.resolve('@electric-sql/pglite')).href)
const db=new PGlite(),user='00000000-0000-4000-8000-000000000001',request='00000000-0000-4000-8000-000000000002',bot='a'.repeat(64),verifier='b'.repeat(64)
await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; create schema auth; create table auth.users(id uuid primary key,is_anonymous boolean default false);insert into auth.users values('${user}',false);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; grant usage on schema public,auth to anon,authenticated,service_role;
create table public.telegram_links(user_id uuid primary key references auth.users(id),tg_chat_id bigint unique not null,tg_username text not null default '');
create table public.telegram_link_codes(code text primary key,user_id uuid references auth.users(id),expires_at timestamptz,created_at timestamptz default now());
insert into public.telegram_links values('${user}',111,'legacy');`)
for(const file of ['20261031120000_game_login.sql','20261031180000_game_login_ingame.sql','20261105055000_secure_telegram_link.sql','20261105060000_secure_telegram_login.sql','20261105070000_telegram_token_auth.sql','20261105080000_telegram_reactions.sql']) await db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'))
after(()=>db.close())
const value=async(q,args=[]) => (await db.query(q,args)).rows[0].v
const issue=async()=>{await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);await db.exec('set role authenticated');try{return await value('select public.issue_telegram_link() v')}finally{await db.exec('reset role')}}
const confirm=token=>value('select public.confirm_telegram_link($1,111,$2) v',[token,'tester'])
const begin=()=>value('select public.begin_telegram_token_auth($1,$2,$3) v',[request,bot,verifier])
const approve=()=>value('select public.approve_telegram_token_auth($1,111) v',[bot])
const consume=()=>value('select public.consume_telegram_token_auth($1,$2) v',[request,verifier])
test('старая связка отклоняется, новая связывается и авторизуется один раз',async()=>{
 await begin();assert.equal((await approve()).error,'not_linked');assert.equal((await value('select public.start_telegram_login($1,$2,$3,111,$4) v',[user,'123456789','1234','123456'])).error,'telegram_not_linked')
 const {token}=await issue();assert.equal((await confirm(token)).ok,true);assert.equal((await approve()).ok,true);assert.equal((await consume()).user_id,user);assert.equal((await consume()).error,'invalid')
 assert.equal((await value('select public.start_telegram_login($1,$2,$3,111,$4) v',[user,'123456789','1234','123456'])).ok,true)
 assert.equal((await value('select public.consume_telegram_login($1,$2,$3,$4) v',[user,'123456789','1234','123456'])).ok,true)
})
