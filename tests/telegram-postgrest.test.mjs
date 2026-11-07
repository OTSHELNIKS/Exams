// Optional isolated real PostgREST + PostgreSQL test. Never connect to a
// network DB: only a Unix socket below /tmp is accepted. A random database and
// random roles are created, then deleted. No real accounts or secrets are used.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, realpath, mkdtemp, rm, chmod } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { randomBytes, createHmac } from 'node:crypto'
import { spawn } from 'node:child_process'
import http from 'node:http'
const socket=process.env.NAME_TEST_PG_SOCKET, binary=process.env.NAME_TEST_POSTGREST_BIN
if (!socket || !binary) { console.log('SKIP: set NAME_TEST_PG_SOCKET and NAME_TEST_POSTGREST_BIN for isolated PostgREST tests'); process.exit(0) }
const pgSocket=await realpath(socket),exe=await realpath(binary)
if (!pgSocket.startsWith('/tmp/') || !exe.startsWith('/tmp/')) throw new Error('Refusing non-isolated paths: socket and PostgREST must be inside /tmp')
const requireFromApp=createRequire(new URL('../app/package.json',import.meta.url))
const {Pool,Client}=requireFromApp('pg')
const {createClient}=requireFromApp('@supabase/supabase-js')
const cfg={host:pgSocket,port:Number(process.env.NAME_TEST_PG_PORT||5432),user:process.env.NAME_TEST_PG_USER||'postgres'}
const admin=new Client({...cfg,database:'postgres'});await admin.connect()
const dbname='name_pgrst_'+randomBytes(10).toString('hex')
const roles={anon:dbname+'_a',authenticated:dbname+'_u',service_role:dbname+'_s',authenticator:dbname+'_auth'}
let created=false,rolesCreated=false,pool,child,dir
try {await admin.query(`create database "${dbname}"`);created=true;pool=new Pool({...cfg,database:dbname,max:20})} catch(e){await admin.end();throw e}
let cleaned=false
async function cleanup(){
  if(cleaned)return
  cleaned=true
  if(child && child.exitCode===null){child.kill('SIGTERM');await new Promise(resolve=>{child.once('exit',resolve);setTimeout(()=>{child.kill('SIGKILL');resolve()},3000).unref()})}
  if(pool)await pool.end()
  if(created)await admin.query(`drop database "${dbname}"`)
  if(rolesCreated)for(const role of [roles.authenticator,roles.anon,roles.authenticated,roles.service_role])await admin.query(`drop role "${role}"`)
  await admin.end();if(dir)await rm(dir,{recursive:true,force:true})
}
after(cleanup)
const user='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002',requestId='00000000-0000-4000-8000-000000000003',third='00000000-0000-4000-8000-000000000004',fourth='00000000-0000-4000-8000-000000000005'
let restSocket,secret
function jwt(role,sub=user){const enc=o=>Buffer.from(JSON.stringify(o)).toString('base64url');const input=enc({alg:'HS256',typ:'JWT'})+'.'+enc({role,sub,exp:Math.floor(Date.now()/1000)+300});return input+'.'+createHmac('sha256',secret).update(input).digest('base64url')}
function call(path,{method='GET',role,body,prefer}={}){return new Promise((resolve,reject)=>{
  const data=body===undefined?null:JSON.stringify(body);const headers={};if(data){headers['content-type']='application/json';headers['content-length']=Buffer.byteLength(data)};if(role)headers.authorization='Bearer '+jwt(role);if(prefer)headers.prefer=prefer
  const req=http.request({socketPath:restSocket,path,method,headers},res=>{let text='';res.on('data',v=>{text+=v});res.on('end',()=>{let json;try{json=JSON.parse(text)}catch{json=null}resolve({status:res.statusCode,json,text})})});req.on('error',reject);req.setTimeout(5000,()=>req.destroy(new Error('PostgREST timeout')));req.end(data)
})}
try {
await pool.query(`create role "${roles.anon}" nologin;create role "${roles.authenticated}" nologin;create role "${roles.service_role}" nologin bypassrls;create role "${roles.authenticator}" login noinherit;
grant "${roles.anon}","${roles.authenticated}","${roles.service_role}" to "${roles.authenticator}";
create schema auth;create table auth.users(id uuid primary key,is_anonymous boolean default false);insert into auth.users values('${user}',false),('${other}',false),('${third}',false),('${fourth}',false);
create function auth.uid() returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
grant usage on schema public,auth to "${roles.anon}","${roles.authenticated}","${roles.service_role}";
create table public.player_profiles(user_id uuid primary key);`)
rolesCreated=true
for(const file of ['20261028235500_telegram_linking.sql','20261031120000_game_login.sql','20261031180000_game_login_ingame.sql','20261105055000_secure_telegram_link.sql','20261105060000_secure_telegram_login.sql','20261105070000_telegram_token_auth.sql','20261105080000_telegram_reactions.sql','20261105090000_telegram_auth_rate_limit.sql']) {
  // A pending code from a pre-upgrade client must be retired by the migration.
  if (file==='20261105055000_secure_telegram_link.sql') {
    await pool.query(`insert into public.telegram_link_codes(code,user_id,expires_at) values('123456','${user}',now()+interval '10 minutes')`)
  }
  const sql=(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8')).replace(/\b(anon|authenticated|service_role)\b/g,x=>roles[x])
  await pool.query(sql)
}
await pool.query(`grant select,delete on public.telegram_links to "${roles.authenticated}";grant select on public.telegram_links to "${roles.anon}";grant all on public.telegram_links to "${roles.service_role}";insert into public.telegram_links(user_id,tg_chat_id,tg_username) values('${user}',111,'old'),('${other}',222,'other');`)
dir=await mkdtemp('/tmp/name-pgrst-');await chmod(dir,0o700)
restSocket=dir+'/server.sock';secret=randomBytes(32).toString('hex')
const uri=`postgresql://${encodeURIComponent(roles.authenticator)}@/`+dbname+`?host=${encodeURIComponent(pgSocket)}&port=${cfg.port}`
let logs=''
child=spawn(exe,[],{env:{PATH:'/usr/bin:/bin',HOME:dir,LANG:'C.UTF-8',PGRST_DB_URI:uri,PGRST_DB_SCHEMAS:'public',PGRST_DB_ANON_ROLE:roles.anon,PGRST_JWT_SECRET:secret,PGRST_SERVER_UNIX_SOCKET:restSocket,PGRST_SERVER_UNIX_SOCKET_MODE:'600'}})
child.stdout.on('data',x=>{logs+=x.toString().slice(0,3000)});child.stderr.on('data',x=>{logs+=x.toString().slice(0,3000)})
child.on('error',e=>{logs+=String(e)})
const deadline=Date.now()+12000;let ready=false
while(Date.now()<deadline){if(child.exitCode!==null)break;try{const res=await call('/');if(res.status<500){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}
if(!ready)throw new Error('PostgREST did not start: '+logs.slice(-2500))
} catch(error) { await cleanup(); throw error }
const rpc=(name,body,role)=>call('/rpc/'+name,{method:'POST',role,body})
// Supabase JS uses fetch; this adapter transports its HTTP requests only over
// the isolated Unix socket. It is real PostgREST, not a PostgREST response mock.
async function socketFetch(input,init={}) {
  const request=new Request(input,init),url=new URL(request.url)
  if(url.hostname!=='supabase.test' || !url.pathname.startsWith('/rest/v1/')) throw new Error('Refusing network or non-PostgREST request')
  const body=request.method==='GET'||request.method==='HEAD' ? null : Buffer.from(await request.arrayBuffer())
  const headers=Object.fromEntries(request.headers.entries());delete headers.host
  if(body) headers['content-length']=String(body.length)
  return new Promise((resolve,reject)=>{
    const req=http.request({socketPath:restSocket,path:url.pathname.slice('/rest/v1'.length)+url.search,method:request.method,headers},res=>{
      const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>{
        const payload=Buffer.concat(chunks),status=res.statusCode
        resolve(new Response(status===204||status===304?null:payload,{status,headers:res.headers}))
      })
    });req.on('error',reject);req.setTimeout(5000,()=>req.destroy(new Error('PostgREST timeout')));req.end(body)
  })
}

test('PostgREST: old links are visible only to their owner and remain unverified',async()=>{
 const own=await call('/telegram_links?select=*',{role:roles.authenticated});assert.equal(own.status,200);assert.equal(own.json.length,1);assert.equal(own.json[0].user_id,user);assert.equal(own.json[0].verified_at,null)
 const unauth=await call('/telegram_links?select=*');assert.equal(unauth.status,200);assert.deepEqual(unauth.json,[])
 const filtered=await call('/telegram_links?verified_at=not.is.null&link_instance_id=not.is.null',{role:roles.authenticated});assert.equal(filtered.status,200);assert.deepEqual(filtered.json,[])
})
test('PostgREST: pending legacy codes are retired and old clients cannot access them',async()=>{
 const remaining=await pool.query(`select count(*)::int as n from public.telegram_link_codes where code='123456'`);assert.equal(remaining.rows[0].n,0)
 const old=await call('/telegram_link_codes',{method:'POST',role:roles.authenticated,body:{code:'123456',user_id:user,expires_at:new Date(Date.now()+600000).toISOString()}});assert.ok(old.status>=400,old.text)
 const read=await call('/telegram_link_codes?code=eq.123456',{role:roles.authenticated});assert.ok(read.status>=400,read.text)
 const anon=await call('/telegram_link_codes?code=eq.123456');assert.ok(anon.status>=400,anon.text)
})
test('PostgREST: unauthorised secure RPC access is rejected',async()=>{
 const anonymous=await rpc('issue_telegram_link',{},undefined);assert.ok(anonymous.status>=400)
 const forbidden=await rpc('confirm_telegram_link',{p_token:'a'.repeat(48),p_chat_id:111,p_username:'test'},roles.authenticated);assert.ok(forbidden.status>=400)
})
test('PostgREST: user issues link, only service can confirm, and verified RLS read works',async()=>{
 const issued=await rpc('issue_telegram_link',{},roles.authenticated);assert.equal(issued.status,200,issued.text);assert.match(issued.json.token,/^[0-9a-f]{48}$/)
 const confirmed=await rpc('confirm_telegram_link',{p_token:issued.json.token,p_chat_id:111,p_username:'tester'},roles.service_role);assert.equal(confirmed.status,200,confirmed.text);assert.equal(confirmed.json.ok,true)
 const verified=await call('/telegram_links?verified_at=not.is.null&link_instance_id=not.is.null&select=*',{role:roles.authenticated});assert.equal(verified.status,200);assert.equal(verified.json.length,1);assert.equal(verified.json[0].user_id,user)
 const patch=await call('/telegram_links?user_id=eq.'+user,{method:'PATCH',role:roles.authenticated,body:{tg_chat_id:999},prefer:'return=representation'});assert.ok(patch.status===200||patch.status===204||patch.status===403);if(patch.status===200)assert.deepEqual(patch.json,[])
})
test('PostgREST: a privileged legacy chat change clears verification',async()=>{
 const client=createClient('https://supabase.test',jwt(roles.authenticated,fourth),{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:socketFetch}})
 const service=createClient('https://supabase.test',jwt(roles.service_role),{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:socketFetch}})
 const issued=await client.rpc('issue_telegram_link');assert.equal(issued.error,null)
 const confirmed=await service.rpc('confirm_telegram_link',{p_token:issued.data.token,p_chat_id:444,p_username:'tester'});assert.equal(confirmed.error,null);assert.equal(confirmed.data.ok,true)
 const changed=await service.from('telegram_links').update({tg_chat_id:445}).eq('user_id',fourth).select('verified_at,link_instance_id');assert.equal(changed.error,null);assert.equal(changed.data.length,1);assert.equal(changed.data[0].verified_at,null);assert.equal(changed.data[0].link_instance_id,null)
 const visible=await client.from('telegram_links').select('user_id').not('verified_at','is',null).not('link_instance_id','is',null);assert.equal(visible.error,null);assert.deepEqual(visible.data,[])
 // This trigger does not make an old privileged bot safe: it may still read
 // and trust unverified rows, so the bot must be replaced/disabled as well.
})
test('PostgREST: service-only auth RPCs consume once, user cannot inspect requests',async()=>{
 const hash='a'.repeat(64),verifier='b'.repeat(64)
 const begin=await rpc('begin_telegram_token_auth',{p_id:requestId,p_bot_hash:hash,p_verifier_hash:verifier},roles.service_role);assert.equal(begin.status,200,begin.text);assert.equal(begin.json.ok,true)
 const denied=await call('/telegram_auth_requests?select=*',{role:roles.authenticated});assert.ok(denied.status>=400)
 const approved=await rpc('approve_telegram_token_auth',{p_bot_hash:hash,p_chat_id:111},roles.service_role);assert.equal(approved.status,200,approved.text);assert.equal(approved.json.ok,true)
 const attempts=await Promise.all(Array.from({length:10},()=>rpc('consume_telegram_token_auth',{p_id:requestId,p_verifier_hash:verifier},roles.service_role)))
 assert.equal(attempts.filter(x=>x.json?.ok).length,1);assert.equal(attempts.filter(x=>x.json?.error==='invalid').length,9)
})
test('PostgREST: deletion returns the user ID as the client expects',async()=>{
 const deleted=await call('/telegram_links?user_id=eq.'+user+'&select=user_id',{method:'DELETE',role:roles.authenticated,prefer:'return=representation'});assert.equal(deleted.status,200,deleted.text);assert.deepEqual(deleted.json,[{user_id:user}])
})

test('real Supabase JS client: link status, RPC and confirmed deletion over PostgREST',async()=>{
 const token=jwt(roles.authenticated,other)
 const client=createClient('https://supabase.test',token,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:socketFetch}})
 const previous=await client.from('telegram_links').select('*').eq('user_id',other).maybeSingle()
 assert.equal(previous.error,null);assert.equal(previous.data.user_id,other);assert.equal(previous.data.verified_at,null)
 const issued=await client.rpc('issue_telegram_link');assert.equal(issued.error,null);assert.match(issued.data.token,/^[0-9a-f]{48}$/)
 const service=createClient('https://supabase.test',jwt(roles.service_role),{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:socketFetch}})
 const confirmed=await service.rpc('confirm_telegram_link',{p_token:issued.data.token,p_chat_id:222,p_username:'tester'});assert.equal(confirmed.error,null);assert.equal(confirmed.data.ok,true)
 const verified=await client.from('telegram_links').select('*').eq('user_id',other).maybeSingle();assert.equal(verified.error,null);assert.ok(verified.data.verified_at);assert.ok(verified.data.link_instance_id)
 const deleted=await client.from('telegram_links').delete().eq('user_id',other).select('user_id');assert.equal(deleted.error,null);assert.deepEqual(deleted.data,[{user_id:other}])
})

test('real PostgREST + Supabase JS + bot/Edge code: link and one-time sign-in (Telegram/Auth simulated)',async()=>{
 const originalFetch=globalThis.fetch,originalDeno=globalThis.Deno,telegram=[]
 const env={SUPABASE_URL:'https://supabase.test',SUPABASE_SERVICE_ROLE_KEY:jwt(roles.service_role),TELEGRAM_BOT_TOKEN:'synthetic-bot-token',TELEGRAM_WEBHOOK_SECRET:'synthetic-webhook',TELEGRAM_SETUP_SECRET:'synthetic-setup',TELEGRAM_AUTH_TRUST_PROXY:'cloudflare',TELEGRAM_AUTH_IP_HMAC_KEY:'synthetic-key-with-at-least-32-characters'}
 let currentHandler
 globalThis.Deno={env:{get:k=>env[k]||''},serve:h=>{currentHandler=h}}
 globalThis.fetch=async(input,options={})=>{
  const u=new URL(String(input));const body=options.body?JSON.parse(options.body):{}
  if(u.hostname==='api.telegram.org'){telegram.push({method:u.pathname.split('/').pop(),body});return Response.json({ok:true,result:{}})}
  if(u.hostname!=='supabase.test')throw new Error('Refusing external request')
  if(u.pathname.startsWith('/rest/v1/'))return socketFetch(input,options)
  if(u.pathname==='/auth/v1/admin/users/'+third)return Response.json({id:third,email:'synthetic@example.test'})
  if(u.pathname==='/auth/v1/admin/generate_link')return Response.json({properties:{hashed_token:'synthetic-auth-token'}})
  throw new Error('Unexpected synthetic route: '+u.pathname)
 }
 try {
  const load=async file=>{const source=await readFile(new URL('../supabase/functions/'+file,import.meta.url),'utf8');await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64')+'#'+randomBytes(8).toString('hex'));return currentHandler}
  const botHandler=await load('telegram-bot/index.ts'),authHandler=await load('telegram-auth/index.ts')
  const postBot=body=>botHandler(new Request('http://isolated.test/',{method:'POST',headers:{'content-type':'application/json','x-telegram-bot-api-secret-token':'synthetic-webhook'},body:JSON.stringify(body)}))
  const postAuth=(action,body)=>authHandler(new Request('http://isolated.test/?action='+action,{method:'POST',headers:{'content-type':'application/json','cf-connecting-ip':'203.0.113.17'},body:JSON.stringify(body)}))
  const client=createClient('https://supabase.test',jwt(roles.authenticated,third),{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:socketFetch}})
  const issued=await client.rpc('issue_telegram_link');assert.equal(issued.error,null);assert.match(issued.data.token,/^[0-9a-f]{48}$/)
  await postBot({message:{chat:{id:333,type:'private'},from:{id:333,username:'test'},text:'/start link_'+issued.data.token}})
  const link=telegram.find(x=>x.method==='sendMessage'&&x.body.reply_markup)?.body.reply_markup.inline_keyboard[0][0].callback_data;assert.equal(link,'link:'+issued.data.token)
  await postBot({callback_query:{id:'link',from:{id:333,username:'test'},data:link,message:{chat:{id:333,type:'private'}}}})
  const row=await client.from('telegram_links').select('*').eq('user_id',third).maybeSingle();assert.equal(row.error,null);assert.ok(row.data.verified_at);assert.ok(row.data.link_instance_id)
  const verifier='v'.repeat(43),hash=(await import('node:crypto')).createHash('sha256').update(verifier).digest('hex')
  const begin=await postAuth('begin',{verifierHash:hash});assert.equal(begin.status,200);const started=await begin.json()
  const waiting=await postAuth('complete',{id:started.id,verifier});assert.equal((await waiting.json()).status,'pending')
  telegram.length=0;await postBot({message:{chat:{id:333,type:'private'},from:{id:333},text:'/start login_'+started.botToken}})
  const login=telegram.find(x=>x.method==='sendMessage'&&x.body.reply_markup)?.body.reply_markup.inline_keyboard[0][0].callback_data;assert.equal(login,'login:'+started.botToken)
  await postBot({callback_query:{id:'login',from:{id:333},data:login,message:{chat:{id:333,type:'private'}}}})
  const complete=await postAuth('complete',{id:started.id,verifier});assert.equal(complete.status,200);assert.equal((await complete.json()).tokenHash,'synthetic-auth-token')
  const replay=await postAuth('complete',{id:started.id,verifier});assert.equal(replay.status,401)
 } finally {globalThis.fetch=originalFetch;globalThis.Deno=originalDeno}
})
