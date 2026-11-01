// NAME MLBB — лобби по региону.
//
// Проверяем то, что легко сломать и трудно заметить: разбор кода приглашения и
// Room ID, тексты ошибок, сверку серверов (номера наружу не уходят) и то, что
// экран матча больше не показывает выдуманный ID лобби.
//
// Run: node tests/lobby.test.mjs
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

const {
  REGIONS, LOBBY_CAPACITY, normalizeLobbyCode, lobbyCodeValid, normalizeRoomId, normalizeRoomPassword,
  parseLobbyReply, describeLobbyError, regionLabel, regionHint, isRegion, lobbyProgress,
  serverMismatch, lobbyRoomState, lobbyInvite, lobbyDeepLink,
} = await import('../app/src/lobby.js')

let passed = 0
let failed = 0
const queue = []
function test(name, fn) { queue.push({ name, fn }) }

// --------------------------------------------------------------- код и ввод

test('T-LOB-01 код приглашения очищается от пробелов и дефисов', () => {
  assert.equal(normalizeLobbyCode(' 123-456 '), '123456')
  assert.equal(normalizeLobbyCode('12 34'), '1234')
  assert.equal(normalizeLobbyCode('abc'), '')
})

test('T-LOB-02 код приглашения — ровно шесть цифр', () => {
  assert.equal(normalizeLobbyCode('12345678'), '123456')
  assert.equal(lobbyCodeValid('123456'), true)
  assert.equal(lobbyCodeValid('12345'), false)
  assert.equal(lobbyCodeValid('1234567'), false)
  assert.equal(lobbyCodeValid(''), false)
})

test('T-LOB-03 Room ID разбирается из любого вида вставки', () => {
  assert.equal(normalizeRoomId('12345678'), '12345678')
  assert.equal(normalizeRoomId('Room ID: 12345678'), '12345678')
  assert.equal(normalizeRoomId('номер № 998877'), '998877')
  assert.equal(normalizeRoomId(' 12 34 56 '), '123456')
  assert.equal(normalizeRoomId(''), '')
})

test('T-LOB-04 пароль комнаты без пробелов и не длиннее 12 знаков', () => {
  assert.equal(normalizeRoomPassword(' 12 34 '), '1234')
  assert.equal(normalizeRoomPassword('abcdefghijklmnop'), 'abcdefghijkl')
})

// ------------------------------------------------------------ ответ сервера

test('T-LOB-05 успешный ответ create_lobby превращается в объект лобби', () => {
  const reply = parseLobbyReply({ lobby_id: 'a1b2', code: '123456', region: 'ru', status: 'open' })
  assert.deepEqual(reply, { lobbyId: 'a1b2', code: '123456', region: 'ru', status: 'open' })
})

test('T-LOB-06 ответ строкой (jsonb как текст) тоже читается', () => {
  const reply = parseLobbyReply('{"lobby_id":"x1","code":"000123","region":"sea"}')
  assert.equal(reply.lobbyId, 'x1')
  assert.equal(reply.code, '000123')
  assert.equal(reply.region, 'sea')
  assert.equal(reply.status, 'open')
})

test('T-LOB-07 ошибки базы переводятся в коды, а не в текст SQL', () => {
  assert.equal(parseLobbyReply({ error: 'not_found' }).error, 'not_found')
  assert.equal(parseLobbyReply({ error: 'closed' }).error, 'closed')
  assert.equal(parseLobbyReply(null).error, 'server')
  assert.equal(parseLobbyReply('не json').error, 'server')
  assert.equal(parseLobbyReply({ foo: 1 }).error, 'server')
})

test('T-LOB-08 у каждой ошибки понятный текст', () => {
  assert.match(describeLobbyError('not_found'), /кодом не нашлось/i)
  assert.match(describeLobbyError('closed'), /закрыл лобби/i)
  assert.match(describeLobbyError('bad_code'), /шесть цифр/i)
  assert.match(describeLobbyError('unauthorized'), /Войди/i)
  assert.match(describeLobbyError('что-то новое'), /Попробуй ещё раз/i)
})

// ------------------------------------------------------------------ регионы

test('T-LOB-09 регионы — реальные зоны MLBB, семь штук', () => {
  assert.equal(REGIONS.length, 7)
  for (const r of REGIONS) {
    assert.ok(r.label && r.hint, 'у региона нет подписи или подсказки: ' + r.id)
    assert.equal(isRegion(r.id), true)
  }
  assert.equal(isRegion('mars'), false)
  assert.equal(regionLabel('sea'), 'Юго-Восточная Азия')
  assert.match(regionHint('eu'), /2xxx/)
  assert.equal(regionLabel('mars'), 'Регион не выбран')
})

test('T-LOB-10 в лобби до 10 человек, как в комнате MLBB', () => {
  assert.equal(LOBBY_CAPACITY, 10)
})

// ------------------------------------------------------------------ состав

test('T-LOB-11 прогресс: кто зашёл, сколько мест осталось', () => {
  const progress = lobbyProgress([{ checked_in: true }, { checked_in: false }, { checked_in: true }])
  assert.deepEqual(progress, { total: 3, checked: 2, free: 7, full: false, allIn: false })
})

test('T-LOB-12 пустое лобби не считается «все зашли»', () => {
  const progress = lobbyProgress([])
  assert.equal(progress.allIn, false)
  assert.equal(progress.free, 10)
})

test('T-LOB-13 полный состав и все отметились', () => {
  const full = lobbyProgress(Array.from({ length: 10 }, () => ({ checked_in: true })))
  assert.equal(full.full, true)
  assert.equal(full.free, 0)
  assert.equal(full.allIn, true)
})

test('T-LOB-14 другой сервер у игрока — честное предупреждение', () => {
  const result = serverMismatch([
    { same_server: true },
    { same_server: false },
    { same_server: false },
  ])
  assert.equal(result.ok, false)
  assert.equal(result.others.length, 2)
  assert.match(result.message, /другой сервер/)
})

test('T-LOB-15 если сервер не указан — просим свериться, а не врём', () => {
  const result = serverMismatch([{ same_server: true }, { same_server: null }])
  assert.equal(result.ok, true)
  assert.equal(result.unknown.length, 1)
  assert.match(result.message, /Не у всех в профиле указан сервер/)
})

test('T-LOB-16 все на одном сервере — короткое подтверждение', () => {
  const result = serverMismatch([{ same_server: true }, { same_server: true }])
  assert.equal(result.ok, true)
  assert.match(result.message, /Все на одном сервере/)
})

test('T-LOB-17 один игрок — предупреждения нет', () => {
  assert.equal(serverMismatch([{ same_server: true }]).message, '')
  assert.equal(serverMismatch([]).ok, true)
})

// ------------------------------------------------------------------ комната

test('T-LOB-18 пока хост не создал комнату, состав видит подсказку', () => {
  const state = lobbyRoomState({ room_id: '', room_password: '' })
  assert.equal(state.ready, false)
  assert.match(state.text, /Create Room/)
})

test('T-LOB-19 Room ID и пароль отдаются составу как есть', () => {
  const state = lobbyRoomState({ room_id: ' 1234 5678 ', room_password: ' play ' })
  assert.equal(state.ready, true)
  assert.equal(state.roomId, '12345678')
  assert.equal(state.password, 'play')
  assert.match(state.text, /Join Room/)
})

test('T-LOB-20 приглашение содержит код и регион', () => {
  const text = lobbyInvite({ code: '123456', region: 'eu' })
  assert.match(text, /123456/)
  assert.match(text, /Европа/)
  assert.match(text, /Войти по коду/)
  assert.equal(lobbyDeepLink('12-34-56'), 'lobby:123456')
  assert.equal(lobbyDeepLink(''), '')
})

// --------------------------------------------------------- исходники и схема

test('T-LOB-21 экран лобби подключён в приложение', () => {
  const app = read('app/src/App.jsx')
  const screens = read('app/src/screens.jsx')
  assert.match(app, /\{ id: 'lobby'/, 'нет экрана лобби в навигации')
  assert.match(app, /<LobbyScreen/, 'экран не рендерится')
  assert.match(screens, /export function LobbyScreen/, 'нет компонента LobbyScreen')
  assert.match(screens, /createLobby\(/, 'кнопка создания не вызывает базу')
  assert.match(screens, /joinLobby\(/, 'нет входа по коду')
  assert.match(screens, /lobby_members_public|loadLobbyMembers/, 'состав грузится не из вьюхи')
})

test('T-LOB-22 карточка матча больше не выдумывает ID лобби', () => {
  const screens = read('app/src/screens.jsx')
  const match = screens.slice(screens.indexOf('export function MatchScreen'), screens.indexOf('export function LobbyScreen'))
  assert.ok(!/Math\.random\(\) \* 9000000/.test(match), 'остался случайный ID лобби')
  assert.ok(!match.includes('Бот создал лобби'), 'остался текст про бота, который создаёт лобби')
  assert.match(match, /lobbyCode/, 'карточка матча не берёт настоящий код')
})

test('T-LOB-23 в базе есть таблицы, права и функции лобби', () => {
  const file = join(root, 'supabase/migrations/20261101120000_lobbies.sql')
  assert.equal(existsSync(file), true, 'нет миграции лобби')
  const sql = readFileSync(file, 'utf8')
  assert.match(sql, /create table if not exists public\.lobbies/i)
  assert.match(sql, /create table if not exists public\.lobby_members/i)
  assert.match(sql, /enable row level security/i)
  assert.match(sql, /function public\.create_lobby/i)
  assert.match(sql, /function public\.join_lobby/i)
  assert.match(sql, /function public\.leave_lobby/i)
  assert.match(sql, /code ~ '\^\[0-9\]\{6\}\$'/, 'код приглашения не ограничен шестью цифрами')
})

test('T-LOB-24 номера серверов не уходят наружу даже в составе лобби', () => {
  const sql = read('supabase/migrations/20261101120000_lobbies.sql')
  const view = sql.slice(sql.indexOf('create or replace view public.lobby_members_public'))
  const selectList = view.slice(view.indexOf('select'), view.indexOf('from public.lobby_members'))
  // Колонки вывода не должно быть: номер сервера виден только внутри CASE.
  assert.ok(!/^\s*(?:hp\.|p\.)?game_server\s*(?:as\s+\w+)?,?\s*$/m.test(selectList),
    'вьюха отдаёт сам номер сервера, а не флаг same_server')
  assert.match(view, /same_server/, 'нет флага сравнения серверов')
  assert.match(view, /hp\.game_server = p\.game_server/, 'серверы сравниваются не равенством')
})

test('T-LOB-25 клиент ходит в базу только через функции и вьюху', () => {
  const client = read('app/src/supabase.js')
  assert.match(client, /rpc\('create_lobby'/)
  assert.match(client, /rpc\('join_lobby'/)
  assert.match(client, /rpc\('leave_lobby'/)
  assert.match(client, /from\('lobby_members_public'\)/)
})

for (const { name, fn } of queue) {
  try {
    await fn()
    passed += 1
    console.log('PASS ' + name)
  } catch (error) {
    failed += 1
    console.log('FAIL ' + name + ' — ' + error.message)
  }
}

console.log(`\nlobby: ${passed}/${passed + failed}`)
process.exitCode = failed ? 1 : 0
