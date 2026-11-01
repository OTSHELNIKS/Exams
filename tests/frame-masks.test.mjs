// Verify the actual PNG alpha apertures, not only the CSS selectors.
// Run: node tests/frame-masks.test.mjs (requires app/node_modules)
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FRAME_IMAGES, FRAME_IMAGE_BY_MOTIF } from '../app/src/frameAssets.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sharp = (await import(join(root, 'app/node_modules/sharp/dist/index.mjs'))).default
const masks = join(root, 'app/public/mlbb-frame-masks')
const sample = async (id) => {
  const { data, info } = await sharp(join(masks, `${id}.png`)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  assert.equal(info.width, 128)
  assert.equal(info.height, 128)
  assert.equal(info.channels, 4)
  return (x, y) => data[(y * 128 + x) * 4 + 3]
}
let passed = 0
let failed = 0
async function test(name, fn) {
  try { await fn(); passed++; console.log('PASS', name) }
  catch (e) { failed++; console.log('FAIL', name, '—', e.message) }
}

await test('T-MASK-01 каждая рамка имеет свою прозрачную маску с открытым центром', async () => {
  assert.equal(new Set(Object.values(FRAME_IMAGE_BY_MOTIF)).size, FRAME_IMAGES.length)
  for (const id of FRAME_IMAGES) {
    assert.ok(existsSync(join(masks, `${id}.png`)), `нет маски ${id}`)
    const alpha = await sample(id)
    assert.ok(alpha(64, 64) > 240, `${id}: закрыт центр`)
    for (let n = 0; n < 128; n++) {
      assert.equal(alpha(n, 0), 0, `${id}: утечка сверху`)
      assert.equal(alpha(n, 127), 0, `${id}: утечка снизу`)
      assert.equal(alpha(0, n), 0, `${id}: утечка слева`)
      assert.equal(alpha(127, n), 0, `${id}: утечка справа`)
    }
  }
})
await test('T-MASK-02 круглая и квадратная рамки имеют разные формы окна', async () => {
  const square = await sample('1-03')
  const circle = await sample('2-03')
  assert.ok(square(25, 25) > 240)
  assert.equal(circle(25, 25), 0)
  assert.ok(circle(64, 64) > 240)
})
await test('T-MASK-03 полупрозрачный фон внутри рамки не скрывает фото', async () => {
  const alpha = await sample('1-22')
  assert.ok(alpha(64, 64) > 240)
  assert.ok(alpha(30, 30) > 240)
  const { data } = await sharp(join(root, 'app/public/mlbb-frames/1-22.png')).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  assert.ok(data[(64 * 128 + 64) * 4 + 3] < 128, 'подложка кадра полностью скрывает фото')
})
console.log(`\nframe-masks: ${passed}/${passed + failed}`)
if (failed) process.exit(1)
