// Реальный код клиентского API с изолированным клиентом Supabase.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rmSync } from 'node:fs'
const here=dirname(fileURLToPath(import.meta.url)),app=join(here,'../app'),nm=join(app,'node_modules')
const esbuild=(await import(join(nm,'esbuild/lib/main.js'))).default
let calls=[], result={data:null,error:null}
const query={select(...args){calls.push(['select',...args]);return this},eq(...args){calls.push(['eq',...args]);return this},not(...args){calls.push(['not',...args]);return this},delete(){calls.push(['delete']);return this},maybeSingle(){return Promise.resolve(result)},then(resolve,reject){return Promise.resolve(result).then(resolve,reject)}}
globalThis.__telegramTestClient={rpc(name,args){calls.push(['rpc',name,args]);return Promise.resolve(result)},from(name){calls.push(['from',name]);return query}}
const bundle=join(app,'.telegram-link-api-test.mjs')
await esbuild.build({entryPoints:[join(app,'src/supabase.js')],bundle:true,format:'esm',outfile:bundle,define:{'import.meta.env':'{"VITE_SUPABASE_URL":"https://example.test","VITE_SUPABASE_PUBLISHABLE_KEY":"public"}'},plugins:[{name:'stub-supabase',setup(build){build.onResolve({filter:/^@supabase\/supabase-js$/},()=>({path:join(here,'fixtures/telegram-supabase-client.mjs')}))}}],logLevel:'silent'})
const api=await import(bundle);after(()=>{rmSync(bundle,{force:true});delete globalThis.__telegramTestClient})
test('клиент запрашивает серверную ссылку без произвольного user_id',async()=>{calls=[];result={data:{token:'a'.repeat(48)},error:null};assert.equal(await api.createTelegramLinkCode('attacker-selected-id'),'a'.repeat(48));assert.deepEqual(calls,[['rpc','issue_telegram_link',undefined]])})
test('старая связь не считается подтверждённой, но отображается необходимость перепривязки',async()=>{calls=[];result={data:{user_id:'me',tg_chat_id:111},error:null};assert.deepEqual(await api.getTelegramLinkStatus('me'),{link:null,needsReconfirm:true});assert.equal(await api.getTelegramLink('me'),null);result={data:{user_id:'me',verified_at:'date',link_instance_id:'uuid'},error:null};const status=await api.getTelegramLinkStatus('me');assert.equal(status.needsReconfirm,false);assert.equal(status.link.user_id,'me');result={data:null,error:null};assert.deepEqual(await api.getTelegramLinkStatus('me'),{link:null,needsReconfirm:false})})
test('отвязка сообщает об ошибке, если сервер не удалил строку',async()=>{calls=[];result={data:[],error:null};await assert.rejects(api.deleteTelegramLink('me'),/Не удалось подтвердить/);result={data:[{user_id:'me'}],error:null};await api.deleteTelegramLink('me')})
test('отмена отправляет только конкретную ссылку',async()=>{calls=[];result={data:{ok:true},error:null};await api.cancelTelegramLink('a'.repeat(48));assert.deepEqual(calls,[['rpc','cancel_telegram_link',{p_token:'a'.repeat(48)}]])})
