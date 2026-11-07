// Полный UI-клик: отдельные секреты, подтверждение бота и обмен на сессию (моки).
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rmSync } from 'node:fs'
const here=dirname(fileURLToPath(import.meta.url)), app=join(here,'../app'), nm=join(app,'node_modules')
const { JSDOM }=await import(join(nm,'jsdom/lib/api.js'))
const esbuild=(await import(join(nm,'esbuild/lib/main.js'))).default
const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'https://example.test/',pretendToBeVisual:true})
globalThis.window=dom.window; globalThis.document=dom.window.document; globalThis.HTMLElement=dom.window.HTMLElement; globalThis.Node=dom.window.Node; globalThis.sessionStorage=dom.window.sessionStorage; globalThis.IS_REACT_ACT_ENVIRONMENT=false
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true})
const calls=[], token='T'.repeat(43), id='00000000-0000-4000-8000-000000000001'
globalThis.fetch=async (url,options={}) => { const body=JSON.parse(options.body||'{}'); calls.push({url:String(url),body}); return {ok:true,json:async()=>String(url).includes('action=begin')?{id,botToken:token,expiresIn:300}:{tokenHash:'fake-token'}} }
const bundle=join(app,'.telegram-login-ui-test.mjs')
await esbuild.build({entryPoints:[join(app,'src/screens.jsx')],bundle:true,format:'esm',outfile:bundle,jsx:'automatic',external:['react','react-dom','react/jsx-runtime','react-dom/client','lucide-react'],define:{'import.meta.env':'{\"VITE_TELEGRAM_SECURE_ENABLED\":\"true\"}'},logLevel:'silent'})
const React=(await import(join(nm,'react/index.js'))).default
const {createRoot}=await import(join(nm,'react-dom/client.js'))
const {AuthScreen}=await import(bundle)
const wait=(ms=70)=>new Promise((r)=>setTimeout(r,ms))
let root,verified
const supabase={auth:{async verifyOtp(value){verified=value;return {error:null}}}}
function Parent(){const [id,setId]=React.useState('');const [server,setServer]=React.useState('');return React.createElement(AuthScreen,{supabase,gameId:id,setGameId:setId,gameServer:server,setGameServer:setServer})}
after(()=>{root?.unmount();rmSync(bundle,{force:true});dom.window.close()})
test('кнопка Telegram получает одноразовую ссылку и обменивает подтверждение',async()=>{
  root=createRoot(document.getElementById('root'));root.render(React.createElement(Parent));await wait()
  document.querySelector('button[aria-label="Войти через Telegram-бота"]').click();await wait(180)
  const modal=document.querySelector('.modal');assert.match(modal.textContent,/сверь код/i)
  assert.match(modal.querySelector('a[href*="start=login_"]').href,new RegExp(token))
  const begin=calls.find(x=>x.url.includes('action=begin'));assert.match(begin.body.verifierHash,/^[a-f0-9]{64}$/);assert.deepEqual(Object.keys(begin.body),['verifierHash'])
  await wait(3200)
  const finish=calls.find(x=>x.url.includes('action=complete'));assert.equal(finish.body.id,id);assert.match(finish.body.verifier,/^[A-Za-z0-9_-]{43}$/);assert.notEqual(finish.body.verifier,token)
  assert.deepEqual(verified,{type:'magiclink',token_hash:'fake-token'});assert.equal(sessionStorage.length,0)
})
