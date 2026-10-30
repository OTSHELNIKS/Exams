// NAME MLBB — читаемый шрифт на десктопе (статическая проверка).
// На большом мониторе подписи 10–11px превращаются в «пыль», поэтому на
// ≥1024px включается отдельная шкала типографики. Тест следит, чтобы её не
// удалили и чтобы ключевые метаданные оставались не мельче 12px.
// Run: node tests/typography.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const styles = readFileSync(join(here, '..', 'app/src/styles.css'), 'utf8')

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

// Последний блок «desktop type» — от него до конца файла.
const start = styles.indexOf('/* ============================================================ desktop type')
const block = start === -1 ? '' : styles.slice(start)

function sizeOf(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(escaped + '\\s*\\{([^}]*)\\}')
  const match = block.match(re)
  if (!match) throw new Error('нет правила ' + selector + ' в десктопной шкале')
  const size = /font-size:\s*([\d.]+)px/.exec(match[1])
  if (!size) throw new Error('нет font-size у ' + selector)
  return Number(size[1])
}

test('T-TYPE-01 десктопная шкала существует и включается с 1024px', () => {
  assert.ok(start !== -1, 'блок desktop type не найден')
  assert.ok(block.includes('@media (min-width: 1024px)'), 'нет media-запроса 1024px')
})

test('T-TYPE-02 метаданные админки не мельче 12px', () => {
  const checks = ['.dash-foot', '.admin-row__info small', '.dash-table__row', '.dash-table__meta', '.kpi span', '.dash-row']
  for (const selector of checks) {
    assert.ok(sizeOf(selector) >= 12, selector + ' = ' + sizeOf(selector) + 'px, мало')
  }
})

test('T-TYPE-03 заголовки карточек и имена игроков крупнее подписей', () => {
  assert.ok(sizeOf('.dash-card__head h3') >= 16, 'заголовок карточки мелкий')
  assert.ok(sizeOf('.admin-row__info strong') >= 15, 'ник в списке мелкий')
  assert.ok(sizeOf('.dash-status__line b') >= 18, 'цифры статусов мелкие')
})

test('T-TYPE-04 меню и шапка рабочей панели не мельче 11.5px', () => {
  for (const selector of ['.rail__label', '.rail__note', '.rail__num', '.app-main__head small', '.app-main__tip']) {
    assert.ok(sizeOf(selector) >= 11.5, selector + ' = ' + sizeOf(selector) + 'px, мало')
  }
})

test('T-TYPE-05 подписи полей и подсказки читаемы', () => {
  assert.ok(sizeOf('.label') >= 13, 'label мелкий')
  assert.ok(sizeOf('.field-hint') >= 13, 'подсказка поля мелкая')
  assert.ok(sizeOf('.field span') >= 11.5, 'подпись поля мелкая')
})

console.log(`\ntypography: ${passed}/${passed + failed}`)
if (failed) process.exit(1)
