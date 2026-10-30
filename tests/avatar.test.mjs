// NAME MLBB — геометрия обрезки аватарки (чистые функции, без DOM).
// Run: node tests/avatar.test.mjs
import assert from 'node:assert/strict'
import {
  CROP_OUTPUT_SIZE, MAX_ZOOM, MIN_ZOOM, clampOffset, cropRect, offsetBounds,
} from '../app/src/cropMath.js'

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

const box = 300
const near = (a, b, eps = 0.001) => Math.abs(a - b) <= eps

test('T-CROP-01 квадратное фото вписывается целиком при зуме 1', () => {
  const r = cropRect({ nat: { w: 800, h: 800 }, box, zoom: 1, offset: { x: 0, y: 0 } })
  assert.ok(near(r.side, 800))
  assert.ok(near(r.sx, 0) && near(r.sy, 0))
})

test('T-CROP-02 вертикальное фото режется по короткой стороне и центрируется', () => {
  const r = cropRect({ nat: { w: 1000, h: 3000 }, box, zoom: 1, offset: { x: 0, y: 0 } })
  assert.ok(near(r.side, 1000), `side=${r.side}`)
  assert.ok(near(r.sx, 0), `sx=${r.sx}`)
  assert.ok(near(r.sy, 1000), `sy=${r.sy}`) // (3000 - 1000) / 2
})

test('T-CROP-03 сдвиг фото влево показывает правый край, вправо — левый', () => {
  const nat = { w: 3000, h: 1000 } // кадр 1000×1000, есть куда двигать по горизонтали
  const bounds = offsetBounds(nat, box, 1)
  assert.ok(near(bounds.maxX, 300), `maxX=${bounds.maxX}`)
  const left = cropRect({ nat, box, zoom: 1, offset: { x: -bounds.maxX, y: 0 } })
  assert.ok(near(left.sx, 2000), `sx=${left.sx}`)
  const right = cropRect({ nat, box, zoom: 1, offset: { x: bounds.maxX, y: 0 } })
  assert.ok(near(right.sx, 0), `sx=${right.sx}`)
  // по вертикали фото ровно по кадру — сдвига нет
  assert.ok(near(bounds.maxY, 0))
})

test('T-CROP-04 сдвиг за пределы обрезается границами', () => {
  const nat = { w: 3000, h: 1000 }
  const b = offsetBounds(nat, box, 1)
  const o = clampOffset({ x: 99999, y: -99999 }, nat, box, 1)
  assert.equal(o.x, b.maxX)
  assert.equal(o.y, -b.maxY)
})

test('T-CROP-05 зум 2 уменьшает кадр вдвое и держит центр', () => {
  const r = cropRect({ nat: { w: 800, h: 800 }, box, zoom: 2, offset: { x: 0, y: 0 } })
  assert.ok(near(r.side, 400), `side=${r.side}`)
  assert.ok(near(r.sx, 200) && near(r.sy, 200), `sx=${r.sx} sy=${r.sy}`)
})

test('T-CROP-06 кадр никогда не выходит за пределы исходника', () => {
  const nat = { w: 1234, h: 987 }
  for (const zoom of [MIN_ZOOM, 1.37, 2, MAX_ZOOM]) {
    const b = offsetBounds(nat, box, zoom)
    for (const x of [-b.maxX, 0, b.maxX]) {
      for (const y of [-b.maxY, 0, b.maxY]) {
        const r = cropRect({ nat, box, zoom, offset: { x, y } })
        assert.ok(r.sx >= -1e-9 && r.sy >= -1e-9, 'sx/sy >= 0')
        assert.ok(r.sx + r.side <= nat.w + 1e-6, 'по ширине')
        assert.ok(r.sy + r.side <= nat.h + 1e-6, 'по высоте')
        assert.ok(near(r.side, Math.min(nat.w, nat.h) / zoom), 'сторона = короткая сторона / зум')
      }
    }
  }
})

test('T-CROP-07 выход всегда 512×512', () => {
  assert.equal(CROP_OUTPUT_SIZE, 512)
})

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`)
if (failed > 0) process.exit(1)
