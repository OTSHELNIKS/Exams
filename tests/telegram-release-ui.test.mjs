// По умолчанию незавершённый Telegram rollout не включается в сборке.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rmSync } from 'node:fs'
const here=dirname(fileURLToPath(import.meta.url)),app=join(here,'../app'),nm=join(app,'node_modules')
const {JSDOM}=await import(join(nm,'jsdom/lib/api.js'));const esbuild=(await import(join(nm,'esbuild/lib/main.js'))).default
const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'https://example.test/',pretendToBeVisual:true})
globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.HTMLElement=dom.window.HTMLElement;globalThis.Node=dom.window.Node;globalThis.sessionStorage=dom.window.sessionStorage;globalThis.IS_REACT_ACT_ENVIRONMENT=false
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true})
const calls=[];globalThis.fetch=async(url,opts={})=>{calls.push({url:String(url),body:JSON.parse(opts.body||'{}')});return {ok:true,json:async()=>({ok:true,channel:'ingame',ttl:300})}}
const bundle=join(app,'.telegram-release-ui-test.mjs')
await esbuild.build({entryPoints:[join(app,'src/screens.jsx')],bundle:true,format:'esm',outfile:bundle,jsx:'automatic',external:['react','react-dom','react/jsx-runtime','react-dom/client','lucide-react'],define:{'import.meta.env':'{}'},logLevel:'silent'})
const React=(await import(join(nm,'react/index.js'))).default,{createRoot}=await import(join(nm,'react-dom/client.js')),{AuthScreen,GameLoginModal,SocialRow}=await import(bundle)
const wait=()=>new Promise(r=>setTimeout(r,100));let root
function render(component){root?.unmount();root=createRoot(document.getElementById('root'));root.render(component)}
after(()=>{root?.unmount();rmSync(bundle,{force:true});dom.window.close()})
test('неактивный вход не выдаёт ссылку и сообщает о временной недоступности',async()=>{
 sessionStorage.setItem('name:telegram-auth:v1','{}');calls.length=0
 render(React.createElement(AuthScreen,{gameId:'',gameServer:'',setGameId(){},setGameServer(){},supabase:null}));await wait()
 document.querySelector('button[aria-label="Войти через Telegram-бота"]').click();await wait()
 assert.match(document.body.textContent,/Вход через Telegram временно недоступен/);assert.equal(document.querySelector('.modal'),null);assert.equal(calls.length,0);assert.equal(sessionStorage.length,0)
})
test('при выключенном Telegram игровой канал продолжает использовать внутриигровую почту',async()=>{
 calls.length=0;render(React.createElement(GameLoginModal,{open:true,onClose(){},gameId:'123456789',gameServer:'1234',setGameId(){},setGameServer(){},initialChannel:'telegram'}));await wait()
 assert.match(document.body.textContent,/Вход через игру/);assert.doesNotMatch(document.body.textContent,/код отправлен в Telegram/i)
 ;[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Получить код')).click();await wait()
 assert.equal(calls.length,1);assert.equal(calls[0].body.channel,'ingame')
})
test('старую привязку не называют подтверждённой, её можно удалить',async()=>{
 let deleted=0,started=0
 function Parent(){const [legacy,setLegacy]=React.useState(true);return React.createElement(SocialRow,{profile:{socials:[]},telegramNeedsReconfirm:legacy,onUnlinkTelegram:async()=>{deleted++;setLegacy(false);return {ok:true}},onStartTelegram:async()=>{started++}})}
 render(React.createElement(Parent));await wait()
 assert.match(document.body.textContent,/Старая привязка Telegram не подтверждена/);assert.equal(document.querySelector('.social-circle--bot'),null)
 document.querySelector('[aria-label="Привязать соцсеть"]').click();await wait();const issue=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Получить код для бота'));assert.ok(issue.disabled);issue.click();assert.equal(started,0)
 ;[...document.querySelectorAll('button')].find(b=>b.textContent==='Отмена').click();await wait();[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Удалить старую привязку')).click();await wait();assert.equal(deleted,1);assert.doesNotMatch(document.body.textContent,/Старая привязка Telegram не подтверждена/)
})
test('ошибка сети не показывается как отсутствие связи, повторная проверка восстанавливает статус',async()=>{
 let checked=0
 function Parent(){const [failed,setFailed]=React.useState(true);return React.createElement(SocialRow,{profile:{socials:[]},telegramStatusError:failed,telegramLink:{tg_username:'tester'},onRefreshTelegram:async()=>{checked++;setFailed(false)}})}
 render(React.createElement(Parent));await wait()
 assert.match(document.body.textContent,/Не удалось проверить состояние Telegram/);assert.doesNotMatch(document.body.textContent,/Ничего не привязано/);assert.equal(document.querySelector('.social-circle--bot'),null)
 ;[...document.querySelectorAll('button')].find(b=>b.textContent==='Повторить').click();await wait();assert.equal(checked,1);assert.ok(document.querySelector('.social-circle--bot'))
})
