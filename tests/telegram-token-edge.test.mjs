// Реальный код Edge-функции с сетевыми моками; настоящий шлюз не проверяется.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
const tmp='/tmp/name-telegram-auth-test.mjs'
let handler, calls=[], scenario={}
const env={SUPABASE_URL:'https://supabase.test',SUPABASE_SERVICE_ROLE_KEY:'secret',TELEGRAM_AUTH_TRUST_PROXY:'cloudflare',TELEGRAM_AUTH_IP_HMAC_KEY:'test-hmac-key-long-enough-1234567890'}
globalThis.Deno={env:{get:k=>env[k]||''},serve:h=>{handler=h}}
globalThis.fetch=async (url,opts={})=>{
  const u=String(url),body=opts.body?JSON.parse(opts.body):null;calls.push({url:u,body,headers:opts.headers})
  if(u.includes('claim_telegram_auth_rate_limit'))return scenario.limiterDown?new Response('',{status:503}):Response.json(scenario.limit||{ok:true})
  if(u.includes('begin_telegram_token_auth'))return Response.json(scenario.begin||{ok:true})
  if(u.includes('consume_telegram_token_auth'))return Response.json(scenario.consume||{status:'pending'})
  if(u.includes('/admin/users/'))return Response.json({email:'user@example.test'})
  if(u.includes('/admin/generate_link'))return Response.json({properties:{hashed_token:'mock-hash'}})
  throw new Error('unexpected request')
}
writeFileSync(tmp,readFileSync(new URL('../supabase/functions/telegram-auth/index.ts',import.meta.url),'utf8')); await import(tmp+'?initial='+Date.now());after(()=>rmSync(tmp,{force:true}))
async function request(action,body,headers={}){const h={ 'Content-Type':'application/json','cf-connecting-ip':'203.0.113.17',...headers };for(const key of Object.keys(h))if(h[key]===null)delete h[key];const r=await handler(new Request('https://edge.test/?action='+action,{method:'POST',headers:h,body:JSON.stringify(body)}));return {status:r.status,data:await r.json()}}
const hash=s=>createHash('sha256').update(s).digest('hex'),verifier='v'.repeat(43),id='00000000-0000-4000-8000-000000000001'
const lastCall=name=>calls.find(x=>x.url.includes(name))
test('begin выдаёт ссылку, сервер хранит только хэши',async()=>{calls=[];scenario={};const r=await request('begin',{verifierHash:hash(verifier)});assert.equal(r.status,200);assert.match(r.data.botToken,/^[A-Za-z0-9_-]{43}$/);const db=lastCall('begin_telegram_token_auth').body;assert.equal(db.p_bot_hash,hash(r.data.botToken));assert.equal(db.p_verifier_hash,hash(verifier));assert.notEqual(r.data.botToken,verifier);assert.equal(lastCall('claim_telegram_auth_rate_limit').headers.Authorization,'Bearer secret');assert.match(calls[0].body.p_identity_hash,/^[0-9a-f]{64}$/);assert.ok(!JSON.stringify(calls[0].body).includes('203.0.113.17'))})
test('неподтверждённый запрос не получает сессию',async()=>{calls=[];scenario={};const r=await request('complete',{id,verifier});assert.equal(r.data.status,'pending');assert.equal(calls.length,2);assert.equal(lastCall('consume_telegram_token_auth').body.p_verifier_hash,hash(verifier))})
test('только подтверждённое потребление выдаёт одноразовый auth hash',async()=>{calls=[];scenario={consume:{ok:true,user_id:id}};const r=await request('complete',{id,verifier});assert.equal(r.data.tokenHash,'mock-hash');assert.equal(calls.length,4);assert.equal(r.data.user_id,undefined)})
test('неверные данные и просроченный запрос не дают сессию',async()=>{calls=[];scenario={consume:{error:'invalid'}};assert.equal((await request('complete',{id,verifier})).status,401);assert.equal(calls.length,2);assert.equal((await request('begin',{verifierHash:'x'})).status,400);assert.equal((await request('complete',{id,verifier:'x'})).status,400)})
test('отсутствующий или неверный доверенный IP не заменяется заголовком пользователя',async()=>{calls=[];scenario={};assert.equal((await request('begin',{verifierHash:hash(verifier)},{'cf-connecting-ip':null,'x-forwarded-for':'203.0.113.1'})).status,503);assert.equal((await request('begin',{verifierHash:hash(verifier)},{'cf-connecting-ip':'invalid'})).status,503);assert.equal(calls.length,0)})
test('сфальсифицированный x-forwarded-for не влияет на ключ ограничения',async()=>{calls=[];scenario={};await request('begin',{verifierHash:hash(verifier)},{'x-forwarded-for':'1.1.1.1'});const key=calls[0].body.p_identity_hash;calls=[];await request('begin',{verifierHash:hash(verifier)},{'x-forwarded-for':'8.8.8.8'});assert.equal(calls[0].body.p_identity_hash,key)})
test('IPv6 адреса одной сети /64 и IPv4-mapped адрес не обходят лимит',async()=>{calls=[];scenario={};await request('begin',{verifierHash:hash(verifier)},{'cf-connecting-ip':'2001:db8:abcd:1::1'});const ipv6=calls[0].body.p_identity_hash;calls=[];await request('begin',{verifierHash:hash(verifier)},{'cf-connecting-ip':'2001:db8:abcd:1:ffff::4'});assert.equal(calls[0].body.p_identity_hash,ipv6);calls=[];await request('begin',{verifierHash:hash(verifier)},{'cf-connecting-ip':'203.0.113.17'});const ipv4=calls[0].body.p_identity_hash;calls=[];await request('begin',{verifierHash:hash(verifier)},{'cf-connecting-ip':'::ffff:203.0.113.17'});assert.equal(calls[0].body.p_identity_hash,ipv4)})
test('лимит и его сбой блокируют выпуск и погашение токенов',async()=>{calls=[];scenario={limit:{ok:false}};assert.equal((await request('begin',{verifierHash:hash(verifier)})).status,429);assert.equal(calls.length,1);calls=[];scenario={limiterDown:true};assert.equal((await request('complete',{id,verifier})).status,503);assert.equal(calls.length,1)})
test('слишком большое тело не попадает в функцию выпуска токена',async()=>{calls=[];scenario={};assert.equal((await request('begin',{verifierHash:hash(verifier),padding:'x'.repeat(5000)})).status,413);assert.equal(calls.length,1)})
test('без настройки доверенного прокси и секрета вход закрыт',async()=>{calls=[];scenario={};env.TELEGRAM_AUTH_TRUST_PROXY='';await import(tmp+'?no-proxy='+Date.now());assert.equal((await request('begin',{verifierHash:hash(verifier)})).status,503);assert.equal(calls.length,0);env.TELEGRAM_AUTH_TRUST_PROXY='cloudflare';env.TELEGRAM_AUTH_IP_HMAC_KEY='short';await import(tmp+'?short-key='+Date.now());assert.equal((await request('begin',{verifierHash:hash(verifier)})).status,503);assert.equal(calls.length,0)})
