// NAME MLBB — каталог героев (статическая проверка, без сети и зависимостей).
// Защищает от рассинхрона: в HEROES попал герой без иконки, с неизвестной ролью
// или с дублем имени — тогда фильтр по ролям и сетка в анкете ломаются.
// Run: node tests/heroes.test.mjs
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

const data = read('app/src/data.js')
const screens = read('app/src/screens.jsx')
const ui = read('app/src/ui.jsx')
const iconsDir = join(root, 'app/public/heroes')
const iconFiles = new Set(readdirSync(iconsDir))

// Достаём HEROES из модуля данных разбором текста — без исполнения JSX-окружения.
const heroBlock = data.slice(data.indexOf('export const HEROES = ['), data.indexOf('// Фильтр героев по ролям'))
const heroes = [...heroBlock.matchAll(/\{ id: '([a-z0-9-]+)', name: ('[^']*'|"[^"]*"), roles: \[([^\]]*)\] \}/g)]
  .map(([, id, name, roles]) => ({
    id,
    name: name.slice(1, -1),
    roles: roles.split(',').map((r) => r.trim().replace(/'/g, '')).filter(Boolean),
  }))

const roleBlock = data.slice(data.indexOf('export const HERO_ROLE_FILTERS = ['), data.indexOf('export const HERO_BY_NAME'))
const roleIds = [...roleBlock.matchAll(/\{ id: '([a-z]+)'/g)].map((m) => m[1]).filter((id) => id !== 'all')

let passed = 0
let failed = 0
function test(name, fn) {
  try {
    fn()
    passed += 1
    console.log('PASS ' + name)
  } catch (error) {
    failed += 1
    console.log('FAIL ' + name + ' — ' + error.message)
  }
}

test('T-HERO-01 ростер MLBB загружен целиком', () => {
  assert.ok(heroes.length >= 130, `ожидалось ≥130 героев, найдено ${heroes.length}`)
})

test('T-HERO-02 у каждого героя есть иконка в public/heroes', () => {
  const missing = heroes.filter((h) => !iconFiles.has(h.id + '.webp'))
  assert.equal(missing.length, 0, 'нет иконок: ' + missing.map((h) => h.id).join(', '))
})

test('T-HERO-03 лишних иконок без героя нет', () => {
  const ids = new Set(heroes.map((h) => h.id + '.webp'))
  const extra = [...iconFiles].filter((f) => !ids.has(f))
  assert.equal(extra.length, 0, 'лишние файлы: ' + extra.join(', '))
})

test('T-HERO-04 имена уникальны и непустые', () => {
  assert.equal(new Set(heroes.map((h) => h.name)).size, heroes.length, 'дубли имён')
  heroes.forEach((h) => assert.ok(h.name.trim().length > 0, 'пустое имя у ' + h.id))
})

test('T-HERO-05 роли героев входят в фильтры', () => {
  const known = new Set(roleIds)
  const bad = heroes.filter((h) => h.roles.length === 0 || h.roles.some((r) => !known.has(r)))
  assert.equal(bad.length, 0, 'неизвестные роли: ' + bad.map((h) => h.id).join(', '))
})

test('T-HERO-06 фильтр покрывает все шесть ролей, в каждой есть герои', () => {
  assert.deepEqual([...roleIds].sort(), ['assassin', 'fighter', 'mage', 'marksman', 'support', 'tank'])
  roleIds.forEach((role) => {
    const count = heroes.filter((h) => h.roles.includes(role)).length
    assert.ok(count > 0, `роль ${role} пустая`)
  })
})

test('T-HERO-07 иконки лёгкие (оптимизированы под мобильный)', () => {
  const heavy = [...iconFiles]
    .map((f) => ({ f, size: statSync(join(iconsDir, f)).size }))
    .filter((x) => x.size > 20 * 1024)
  assert.equal(heavy.length, 0, 'слишком тяжёлые: ' + heavy.map((x) => x.f).join(', '))
  const total = [...iconFiles].reduce((sum, f) => sum + statSync(join(iconsDir, f)).size, 0)
  assert.ok(total < 1.2 * 1024 * 1024, 'весь набор весит больше 1.2 МБ')
})

test('T-HERO-08 анкета использует сетку иконок с фильтром, а не текстовые чипы', () => {
  assert.match(screens, /<HeroPicker[\s\S]*heroes=\{HEROES\}[\s\S]*roleFilters=\{HERO_ROLE_FILTERS\}/)
  assert.doesNotMatch(screens, /HEROES\.map\(\(h\) => <Chip/)
  assert.match(ui, /export function HeroPicker/)
  assert.match(ui, /h\.roles\.includes\(role\)/)
})

test('T-HERO-09 картинки грузятся с учётом base path (GitHub Pages /Exams/)', () => {
  assert.match(ui, /import\.meta\.env\.BASE_URL/)
  assert.match(ui, /\/heroes\/\$\{id\}\.webp/)
})

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`)
if (failed > 0) process.exit(1)
