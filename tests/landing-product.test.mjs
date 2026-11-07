import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const here=dirname(fileURLToPath(import.meta.url)),app=join(here,'../app'),nm=join(app,'node_modules')
const {JSDOM}=await import(join(nm,'jsdom/lib/api.js'))
const esbuild=(await import(join(nm,'esbuild/lib/main.js'))).default
const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'https://example.test/',pretendToBeVisual:true})
globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.HTMLElement=dom.window.HTMLElement;globalThis.Node=dom.window.Node;globalThis.IS_REACT_ACT_ENVIRONMENT=false
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true})
const bundle=join(app,'.landing-test.mjs')
await esbuild.build({entryPoints:[join(app,'src/landing.jsx')],bundle:true,format:'esm',outfile:bundle,jsx:'automatic',external:['react','react-dom','react/jsx-runtime','react-dom/client','lucide-react'],define:{'import.meta.env':'{}'},logLevel:'silent'})
const React=(await import(join(nm,'react/index.js'))).default
const {createRoot}=await import(join(nm,'react-dom/client.js'))
const {Landing}=await import(bundle)
let opened=0,root=createRoot(document.getElementById('root'))
after(()=>{root.unmount();rmSync(bundle,{force:true});dom.window.close()})
test('промо показывает продукт, а не форму регистрации; CTA открывает приложение',async()=>{
 root.render(React.createElement(Landing,{onOpen:()=>opened++,callbackError:'Ошибка входа'}));await new Promise(r=>setTimeout(r,100))
 assert.ok(document.querySelector('.product-preview'));assert.equal(document.querySelector('form'),null);assert.equal(document.querySelector('input'),null)
 assert.match(document.body.textContent,/приостановлены/);assert.match(document.querySelector('[role="alert"]').textContent,/Ошибка входа/)
 document.querySelector('.product-preview__cta').click();assert.equal(opened,1)
 const css=readFileSync(join(app,'src/styles.css'),'utf8');assert.doesNotMatch(css,/\.product-preview\s*\{[^}]*display\s*:\s*none/)
})
