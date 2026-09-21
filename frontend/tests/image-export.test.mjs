import test from 'node:test'
import assert from 'node:assert/strict'
import { imageMime, convertImage } from '../js/image-export.js'

const png = new Blob([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'application/octet-stream' })
const jpeg = new Blob([Uint8Array.from([255, 216, 255, 224])], { type: 'image/jpeg' })
const webp = new Blob(['RIFF0000WEBP'], { type: 'image/webp' })

test('根据文件内容识别格式，原格式无需重新压缩', async () => {
  assert.equal(await imageMime(png), 'image/png')
  assert.equal(await imageMime(jpeg), 'image/jpeg')
  assert.equal(await imageMime(webp), 'image/webp')
  const result = await convertImage(png, 'PNG')
  assert.equal(result.blob, png)
  assert.equal(result.extension, 'png')
  assert.equal(result.converted, false)
})

for (const format of ['JPEG', 'WebP']) {
  test(`PNG 转 ${format} 使用原像素尺寸，JPEG 透明背景填白`, async (t) => {
    const events = []
    const img = { width: 2160, height: 3840, close() { events.push('close') } }
    const canvas = { width: 0, height: 0, getContext() { return {
      set fillStyle(value) { assert.equal(value, '#ffffff') },
      fillRect(x, y, width, height) { events.push('fill'); assert.deepEqual([x, y, width, height], [0, 0, 2160, 3840]) },
      drawImage(image, x, y) { events.push('draw'); assert.equal(image, img); assert.deepEqual([x, y], [0, 0]) },
    } }, toBlob(callback, mime, quality) {
      assert.equal(mime, format === 'JPEG' ? 'image/jpeg' : 'image/webp')
      assert.equal(quality, 0.95)
      callback(format === 'JPEG' ? jpeg : webp)
    } }
    const previous = { document: globalThis.document, createImageBitmap: globalThis.createImageBitmap }
    globalThis.createImageBitmap = async (blob) => { assert.equal(blob, png); return img }
    globalThis.document = { createElement(name) { assert.equal(name, 'canvas'); return canvas } }
    t.after(() => Object.assign(globalThis, previous))
    const result = await convertImage(png, format)
    assert.equal(result.extension, format === 'JPEG' ? 'jpg' : 'webp')
    assert.equal(await imageMime(result.blob), format === 'JPEG' ? 'image/jpeg' : 'image/webp')
    assert.equal(canvas.width, 2160)
    assert.equal(canvas.height, 3840)
    assert.deepEqual(events, format === 'JPEG' ? ['fill', 'draw', 'close'] : ['draw', 'close'])
  })
}

test('浏览器不支持目标编码时明确失败，不能把 PNG 改后缀伪装为其他格式', async (t) => {
  let closed = false
  const previous = { document: globalThis.document, createImageBitmap: globalThis.createImageBitmap }
  globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() { closed = true } })
  globalThis.document = { createElement: () => ({ getContext: () => ({ drawImage() {} }), toBlob(callback) { callback(png) } }) }
  t.after(() => Object.assign(globalThis, previous))
  await assert.rejects(convertImage(png, 'WebP'), /不支持导出/)
  assert.equal(closed, true)
  await assert.rejects(convertImage(png, 'gif'), /请选择/)
})
