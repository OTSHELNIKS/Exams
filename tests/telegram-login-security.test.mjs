// Изолированный PGlite: реальные SQL RPC, не настоящий PostgREST и не нагрузка.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
const requireFromApp = createRequire(new URL('../app/package.json', import.meta.url))
const { PGlite } = await import(pathToFileURL(requireFromApp.resolve('@electric-sql/pglite')).href)
const db = new PGlite()
const id = '00000000-0000-4000-8000-000000000001'
const mig = async (name) => db.exec(await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8'))
await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth; create table auth.users(id uuid primary key); insert into auth.users values ('${id}');
create table public.telegram_links(user_id uuid primary key, tg_chat_id bigint not null unique, verified_at timestamptz default now(),link_instance_id uuid default gen_random_uuid());
insert into public.telegram_links(user_id,tg_chat_id) values ('${id}',111);
grant usage on schema public to anon,authenticated,service_role;`)
await mig('20261031120000_game_login.sql'); await mig('20261031180000_game_login_ingame.sql'); await mig('20261105060000_secure_telegram_login.sql')
after(async () => db.close())
const value = async (sql, params = []) => (await db.query(sql, params)).rows[0].v
const start = (code = '123456', chat = 111) => value('select public.start_telegram_login($1,$2,$3,$4,$5) v', [id,'123456789','1234',chat,code])
const consume = (code = '123456') => value('select public.consume_telegram_login($1,$2,$3,$4) v', [id,'123456789','1234',code])
async function reset() { await db.exec('delete from public.game_login_codes; delete from public.telegram_login_throttle; delete from public.telegram_links;'); await db.query('insert into public.telegram_links(user_id,tg_chat_id) values ($1,111)',[id]) }

test('код создаётся только для настоящей связки, повторный запрос ограничен', async () => { await reset(); assert.equal((await start('123456',222)).error, 'telegram_not_linked'); assert.equal((await start()).ok,true); assert.equal((await start('654321')).error,'too_often') })
test('верный код работает один раз, после отвязки не работает', async () => { await reset(); await start(); assert.equal((await consume()).ok,true); assert.equal((await consume()).error,'bad_code'); await reset(); await start(); await db.exec('delete from public.telegram_links'); assert.equal((await consume()).error,'bad_code') })
test('пять ошибок блокируют новые коды на 15 минут', async () => { await reset(); await start(); for(let i=0;i<4;i++) assert.equal((await consume('999999')).attemptsLeft,4-i); assert.equal((await consume('999999')).error,'too_many_attempts'); assert.equal((await consume()).error,'too_many_attempts'); await db.exec("update public.telegram_login_throttle set last_requested_at=now()-interval '1 minute'"); assert.equal((await start('654321')).error,'too_many_attempts'); await db.exec("update public.telegram_login_throttle set locked_until=now()-interval '1 second'"); assert.equal((await start('654321')).ok,true) })
test('просроченный код и пустое значение отвергаются', async () => { await reset(); await start(); assert.equal((await consume(null)).error,'bad_code'); await db.exec("update public.game_login_codes set expires_at=now()-interval '1 second'"); assert.equal((await consume()).error,'code_expired'); assert.equal((await consume()).error,'bad_code') })
test('анонимам и обычным пользователям RPC и таблица недоступны', async () => { for(const role of ['anon','authenticated']) { await db.exec(`set role ${role}`); try { await assert.rejects(start(), /permission denied/); await assert.rejects(db.query('select * from public.telegram_login_throttle'), /permission denied/) } finally { await db.exec('reset role') } } })

test('неподтверждённая старая связка не разрешает кодовый вход', async () => { await reset(); await db.exec('update public.telegram_links set verified_at=null'); assert.equal((await start()).error,'telegram_not_linked') })

test('код не переживает перепривязку того же Telegram', async () => { await reset(); await start(); await db.exec('delete from public.telegram_links'); await db.query('insert into public.telegram_links(user_id,tg_chat_id) values ($1,111)',[id]); assert.equal((await consume()).error,'bad_code') })
