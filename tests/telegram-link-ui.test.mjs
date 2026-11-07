// Искусственный UI-сценарий: после ссылки привязка появляется только после ответа сервера.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rmSync } from 'node:fs'
const here=dirname(fileURLToPath(import.meta.url)),app=join(here,'../app'),nm=join(app,'node_modules')
const {JSDOM}=await import(join(nm,'jsdom/lib/api.js'))
const esbuild=(await import(join(nm,'esbuild/lib/main.js'))).default
const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'https://example.test/',pretendToBeVisual:true})
globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.HTMLElement=dom.window.HTMLElement;globalThis.Node=dom.window.Node;globalThis.IS_REACT_ACT_ENVIRONMENT=false
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true})
const bundle=join(app,'.telegram-link-ui-test.mjs')
await esbuild.build({entryPoints:[join(app,'src/screens.jsx')],bundle:true,format:'esm',outfile:bundle,jsx:'automatic',external:['react','react-dom','react/jsx-runtime','react-dom/client','lucide-react'],define:{'import.meta.env':'{\"VITE_TELEGRAM_SECURE_ENABLED\":\"true\"}'},logLevel:'silent'})
const React=(await import(join(nm,'react/index.js'))).default
const {createRoot}=await import(join(nm,'react-dom/client.js'))
const {SocialRow}=await import(bundle)
const wait=(ms=80)=>new Promise(r=>setTimeout(r,ms))
const token='a'.repeat(48);let root,confirmed=false,requests=0
function Parent(){const [link,setLink]=React.useState(null);return React.createElement(SocialRow,{profile:{socials:[]},telegramLink:link,onStartTelegram:async()=>{requests++;return token},onRefreshTelegram:async()=>{if(!confirmed)return null;const row={tg_username:'tester'};setLink(row);return row}})}
after(()=>{root?.unmount();rmSync(bundle,{force:true});dom.window.close()})
test('профиль запрашивает ссылку, сверяет код и ожидает фактическую привязку',async()=>{
 root=createRoot(document.getElementById('root'));root.render(React.createElement(Parent));await wait()
 assert.equal(document.querySelector('.social-circle--bot'),null)
 document.querySelector('[aria-label="Привязать соцсеть"]').click();await wait()
 ;[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Получить код для бота')).click();await wait()
 assert.equal(requests,1);assert.equal(document.querySelector('.social-flow__code').textContent,'aaaaaa')
 assert.equal(document.querySelector('.social-flow__cta[href]').href,'https://t.me/name_mlbb_bot?start=link_'+token)
 assert.equal(document.querySelector('.social-circle--bot'),null)
 confirmed=true;await wait(2700)
 assert.ok(document.querySelector('.social-circle--bot'));assert.match(document.body.textContent,/Telegram привязан/)
})
test('отмена отзываёт ссылку, даже если она выдана после закрытия окна',async()=>{
  root?.unmount(); let resolveIssue; const cancelled=[]
  root=createRoot(document.getElementById('root'))
  root.render(React.createElement(SocialRow,{profile:{socials:[]},onStartTelegram:()=>new Promise(r=>{resolveIssue=r}),onCancelTelegram:async code=>{cancelled.push(code)}}));await wait()
  document.querySelector('[aria-label="Привязать соцсеть"]').click();await wait()
  ;[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Получить код для бота')).click();await wait()
  ;[...document.querySelectorAll('button')].find(b=>b.textContent==='Отмена').click();await wait()
  resolveIssue(token);await wait()
  assert.deepEqual(cancelled,[token]);assert.equal(document.querySelector('.modal'),null)
})
test('неуспешная отвязка не показывает ложного успеха',async()=>{
  root?.unmount();root=createRoot(document.getElementById('root'))
  root.render(React.createElement(SocialRow,{profile:{socials:[]},telegramLink:{tg_username:'tester'},onUnlinkTelegram:async()=>({ok:false,error:'Ошибка сервера'})}));await wait()
  document.querySelector('.social-circle--bot').click();await wait()
  ;[...document.querySelectorAll('button')].find(b=>b.textContent==='Отвязать').click();await wait()
  assert.match(document.body.textContent,/Ошибка сервера/);assert.ok(document.querySelector('.social-circle--bot'));assert.doesNotMatch(document.body.textContent,/Telegram отвязан от аккаунта/)
})
