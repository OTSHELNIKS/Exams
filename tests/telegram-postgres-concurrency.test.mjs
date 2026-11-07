// Optional REAL PostgreSQL concurrency tests. Only local Unix sockets are
// accepted, and a newly created random test database is always dropped.
// Example: NAME_TEST_PG_SOCKET=/tmp/name-isolated-pg/socket NAME_TEST_PG_USER=name_test NAME_TEST_PG_PORT=55439 node tests/telegram-postgres-concurrency.test.mjs
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, realpath } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { randomBytes } from 'node:crypto'
const socket=process.env.NAME_TEST_PG_SOCKET
if (!socket) { console.log('SKIP: set NAME_TEST_PG_SOCKET for isolated real PostgreSQL tests'); process.exit(0) }
const canonical=await realpath(socket)
if (!canonical.startsWith('/tmp/')) throw new Error('Refusing non-isolated socket; only /tmp Unix sockets are allowed')
const { Pool, Client }=createRequire(new URL('../app/package.json',import.meta.url))('pg')
const cfg={host:canonical,port:Number(process.env.NAME_TEST_PG_PORT||5432),user:process.env.NAME_TEST_PG_USER||'postgres'}
const admin=new Client({...cfg,database:'postgres'});await admin.connect()
const dbname='name_test_'+randomBytes(12).toString('hex')
const roles={anon:dbname+'_a',authenticated:dbname+'_u',service_role:dbname+'_s'}
let created=false,rolesCreated=false,pool
try {await admin.query(`create database "${dbname}"`);created=true;pool=new Pool({...cfg,database:dbname,max:30})} catch(e){await admin.end();throw e}
after(async()=>{await pool.end();if(created)await admin.query(`drop database "${dbname}"`);if(rolesCreated)for(const role of Object.values(roles)) await admin.query(`drop role "${role}"`);await admin.end()})
const user='00000000-0000-4000-8000-000000000001',request='00000000-0000-4000-8000-000000000002',bot='a'.repeat(64),verifier='b'.repeat(64)
await pool.query(`create role "${roles.anon}" nologin; create role "${roles.authenticated}" nologin; create role "${roles.service_role}" nologin bypassrls; create schema auth;
create table auth.users(id uuid primary key,is_anonymous boolean default false);insert into auth.users values('${user}',false);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema public,auth to "${roles.anon}","${roles.authenticated}","${roles.service_role}";
create table public.telegram_links(user_id uuid primary key references auth.users(id),tg_chat_id bigint unique not null,tg_username text not null default '');
create table public.telegram_link_codes(code text primary key,user_id uuid references auth.users(id),expires_at timestamptz,created_at timestamptz default now());`)
rolesCreated=true
for(const file of ['20261031120000_game_login.sql','20261031180000_game_login_ingame.sql','20261105055000_secure_telegram_link.sql','20261105060000_secure_telegram_login.sql','20261105070000_telegram_token_auth.sql','20261105080000_telegram_reactions.sql','20261105090000_telegram_auth_rate_limit.sql']) await pool.query((await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8')).replace(/\b(anon|authenticated|service_role)\b/g, x=>roles[x]))
const scalar=async(sql,args=[]) => (await pool.query(sql,args)).rows[0].v
const issue=async()=>{const c=await pool.connect();try{await c.query('begin');await c.query(`set local role "${roles.authenticated}"`);await c.query("select set_config('request.jwt.claim.sub',$1,true)",[user]);const r=await c.query('select public.issue_telegram_link() v');await c.query('commit');return r.rows[0].v}catch(e){await c.query('rollback');throw e}finally{c.release()}}
const confirm=(token,chat)=>scalar('select public.confirm_telegram_link($1,$2,$3) v',[token,chat,'tester'])
const begin=()=>scalar('select public.begin_telegram_token_auth($1,$2,$3) v',[request,bot,verifier])
const approve=()=>scalar('select public.approve_telegram_token_auth($1,111) v',[bot])
const consume=()=>scalar('select public.consume_telegram_token_auth($1,$2) v',[request,verifier])
async function clear(){await pool.query('delete from public.telegram_auth_requests; delete from public.telegram_link_challenges; delete from public.telegram_link_issue_throttle; delete from public.telegram_link_confirm_throttle; delete from public.telegram_login_throttle; delete from public.game_login_codes; delete from public.telegram_links;')}
async function linked(){const x=await issue();assert.equal((await confirm(x.token,111)).ok,true)}
async function blocked(pid){const end=Date.now()+5000;while(Date.now()<end){const r=await pool.query("select wait_event_type='Lock' waiting from pg_stat_activity where pid=$1",[pid]);if(r.rows[0]?.waiting)return;await new Promise(r=>setTimeout(r,25))}throw new Error('transaction was not observed waiting on a lock')}

test('real PostgreSQL: parallel issue is limited to one challenge',async()=>{await clear();const r=await Promise.all(Array.from({length:20},issue));assert.equal(r.filter(x=>x.token).length,1);assert.equal(r.filter(x=>x.error==='too_often').length,19)})
test('real PostgreSQL: a link challenge cannot bind two chats concurrently',async()=>{await clear();const {token}=await issue();const r=await Promise.all(Array.from({length:16},(_,i)=>confirm(token,1000+i)));assert.equal(r.filter(x=>x.ok).length,1);assert.equal(Number((await pool.query('select count(*) n from public.telegram_links')).rows[0].n),1)})
test('real PostgreSQL: one approved login yields exactly one consumption under concurrency',async()=>{await clear();await linked();await begin();await approve();const r=await Promise.all(Array.from({length:20},consume));assert.equal(r.filter(x=>x.ok).length,1);assert.equal(r.filter(x=>x.error==='invalid').length,19)})
test('real PostgreSQL: concurrent OTP consumption succeeds only once',async()=>{await clear();await linked();assert.equal((await scalar('select public.start_telegram_login($1,$2,$3,111,$4) v',[user,'123456789','1234','123456'])).ok,true);const r=await Promise.all(Array.from({length:20},()=>scalar('select public.consume_telegram_login($1,$2,$3,$4) v',[user,'123456789','1234','123456'])));assert.equal(r.filter(x=>x.ok).length,1)})
test('real PostgreSQL: unlink holding row lock wins over a waiting login',async()=>{await clear();await linked();await begin();await approve();const deleter=await pool.connect(),reader=await pool.connect();try{await deleter.query('begin');await deleter.query('delete from public.telegram_links where user_id=$1',[user]);const pid=(await reader.query('select pg_backend_pid() pid')).rows[0].pid;const pending=reader.query('select public.consume_telegram_token_auth($1,$2) v',[request,verifier]);await blocked(pid);await deleter.query('commit');assert.equal((await pending).rows[0].v.error,'invalid')}finally{await deleter.query('rollback').catch(()=>{});deleter.release();reader.release()}})
test('real PostgreSQL: cancellation committed before confirmation makes the challenge unusable',async()=>{await clear();const {token}=await issue();const cancel=await pool.connect(),reader=await pool.connect();try{await cancel.query('begin');await cancel.query('delete from public.telegram_link_challenges where user_id=$1',[user]);const pid=(await reader.query('select pg_backend_pid() pid')).rows[0].pid;const pending=reader.query('select public.confirm_telegram_link($1,111,$2) v',[token,'test']);await blocked(pid);await cancel.query('commit');assert.equal((await pending).rows[0].v.error,'invalid')}finally{await cancel.query('rollback').catch(()=>{});cancel.release();reader.release()}})

test('real PostgreSQL: parallel rate-limit claims do not exceed the limit',async()=>{const key='c'.repeat(64);const r=await Promise.all(Array.from({length:30},()=>scalar('select public.claim_telegram_auth_rate_limit($1,$2) v',[key,'begin'])));assert.equal(r.filter(x=>x.ok).length,8);assert.equal(r.filter(x=>x.ok===false).length,22)})
test('real PostgreSQL + real Edge/bot handlers: link, confirm, login and replay (HTTP/Auth mocked)',async()=>{
  await clear()
  const oldFetch=globalThis.fetch,oldDeno=globalThis.Deno,telegram=[],env={SUPABASE_URL:'https://database.test',SUPABASE_SERVICE_ROLE_KEY:'fake-service',TELEGRAM_BOT_TOKEN:'fake-bot',TELEGRAM_WEBHOOK_SECRET:'webhook-test',TELEGRAM_SETUP_SECRET:'setup-test',TELEGRAM_AUTH_TRUST_PROXY:'cloudflare',TELEGRAM_AUTH_IP_HMAC_KEY:'synthetic-hmac-key-at-least-32-characters'}
  let handler
  globalThis.Deno={env:{get:k=>env[k]||''},serve:h=>{handler=h}}
  globalThis.fetch=async (input,options={})=>{
    const u=new URL(String(input)); const body=options.body?JSON.parse(options.body):{}
    if(u.hostname==='api.telegram.org') { const method=u.pathname.split('/').pop();telegram.push({method,body});return Response.json({ok:true,result:{}}) }
    if(u.pathname==='/auth/v1/admin/users/'+user)return Response.json({id:user,email:'synthetic@example.test'})
    if(u.pathname==='/auth/v1/admin/generate_link')return Response.json({properties:{hashed_token:'synthetic-supabase-otp'}})
    if(u.pathname==='/rest/v1/telegram_links') {
      const chat=String(u.searchParams.get('tg_chat_id')||'').replace(/^eq\./,'')
      const r=await pool.query('select user_id from public.telegram_links where tg_chat_id=$1 and verified_at is not null and link_instance_id is not null',[chat])
      return Response.json(r.rows)
    }
    const name=u.pathname.match(/^\/rest\/v1\/rpc\/(\w+)$/)?.[1]
    if(!['confirm_telegram_link','claim_telegram_auth_rate_limit','begin_telegram_token_auth','approve_telegram_token_auth','consume_telegram_token_auth'].includes(name)) throw new Error('unexpected mock route '+u.pathname)
    const args=Object.values(body), placeholders=args.map((_,i)=>'$'+(i+1)).join(',')
    const c=await pool.connect();try {await c.query('begin');await c.query(`set local role "${roles.service_role}"`);const out=await c.query(`select public.${name}(${placeholders}) v`,args);await c.query('commit');return Response.json(out.rows[0].v)}catch(e){await c.query('rollback');throw e}finally{c.release()}
  }
  try {
    const load=async file=>{const source=await readFile(new URL('../supabase/functions/'+file,import.meta.url),'utf8');await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64')+'#'+Math.random());return handler}
    const botHandler=await load('telegram-bot/index.ts'),authHandler=await load('telegram-auth/index.ts')
    const postBot=body=>botHandler(new Request('http://isolated.test/',{method:'POST',headers:{'content-type':'application/json','x-telegram-bot-api-secret-token':'webhook-test'},body:JSON.stringify(body)}))
    const postAuth=(action,body)=>authHandler(new Request('http://isolated.test/?action='+action,{method:'POST',headers:{'content-type':'application/json','cf-connecting-ip':'203.0.113.17'},body:JSON.stringify(body)}))
    const link=(await issue()).token
    await postBot({message:{chat:{id:111,type:'private'},from:{id:111,username:'tester'},text:'/start link_'+link}})
    const linkPayload=telegram.find(x=>x.method==='sendMessage'&&x.body.reply_markup)?.body.reply_markup.inline_keyboard[0][0].callback_data
    assert.equal(linkPayload,'link:'+link)
    await postBot({callback_query:{id:'confirm-link',from:{id:111,username:'tester'},data:linkPayload,message:{chat:{id:111,type:'private'}}}})
    assert.ok(await scalar('select verified_at is not null v from public.telegram_links where user_id=$1',[user]))
    const browserVerifier='v'.repeat(43);const hash=await import('node:crypto').then(x=>x.createHash('sha256').update(browserVerifier).digest('hex'))
    const beginResponse=await postAuth('begin',{verifierHash:hash});assert.equal(beginResponse.status,200);const created=await beginResponse.json()
    const waiting=await postAuth('complete',{id:created.id,verifier:browserVerifier});assert.equal((await waiting.json()).status,'pending')
    telegram.length=0;await postBot({message:{chat:{id:111,type:'private'},from:{id:111},text:'/start login_'+created.botToken}})
    const loginPayload=telegram.find(x=>x.method==='sendMessage'&&x.body.reply_markup)?.body.reply_markup.inline_keyboard[0][0].callback_data
    assert.equal(loginPayload,'login:'+created.botToken)
    await postBot({callback_query:{id:'confirm-login',from:{id:111},data:loginPayload,message:{chat:{id:111,type:'private'}}}})
    const done=await postAuth('complete',{id:created.id,verifier:browserVerifier});assert.equal((await done.json()).tokenHash,'synthetic-supabase-otp')
    const replay=await postAuth('complete',{id:created.id,verifier:browserVerifier});assert.equal(replay.status,401)
  } finally {globalThis.fetch=oldFetch;globalThis.Deno=oldDeno}
})
