import { describe, expect, it } from 'vitest'
import { imageLimits, inspectBlob, inspectImage, validateImageAsset } from '../../src/domain/images'
import { fitDimensions } from '../../src/services/images'
import { tinyPng, screenshot } from './media-fixtures'
function png(width: number, height: number, animated = false) {
  const bytes = new Uint8Array(animated ? 65 : 45); bytes.set([137, 80, 78, 71, 13, 10, 26, 10])
  const view = new DataView(bytes.buffer);view.setUint32(8, 13);bytes.set(Buffer.from('IHDR'), 12);view.setUint32(16, width);view.setUint32(20, height)
  let offset = 33
  if (animated) {view.setUint32(offset, 8);bytes.set(Buffer.from('acTL'), offset + 4);offset += 20}
  bytes.set(Buffer.from('IEND'), offset + 4);return bytes
}
function webp(kind: 'VP8X' | 'VP8L' | 'VP8 ', animated = false) {
  const size = kind === 'VP8L' ? 5 : 10;const bytes = new Uint8Array(20 + size + size % 2);const view = new DataView(bytes.buffer)
  bytes.set(Buffer.from('RIFF'));view.setUint32(4, bytes.length - 8, true);bytes.set(Buffer.from('WEBP'), 8);bytes.set(Buffer.from(kind), 12);view.setUint32(16, size, true)
  if (kind === 'VP8X') bytes[20] = animated ? 2 : 0
  if (kind === 'VP8L') bytes[20] = 47
  if (kind === 'VP8 ') {bytes.set([157, 1, 42], 23);view.setUint16(26, 1, true);view.setUint16(28, 1, true)}
  return bytes
}
describe('T07/T08 画像境界', () => {
  it('PNG/JPEG/3種類のWebPヘッダを判定する', () => {
    expect(inspectImage(tinyPng)).toEqual({ mime: 'image/png', width: 1, height: 1 })
    const jpeg = new Uint8Array([255, 216, 255, 192, 0, 8, 8, 0, 2, 0, 3, 0, 255, 217])
    expect(inspectImage(jpeg)).toEqual({ mime: 'image/jpeg', width: 3, height: 2 })
    expect(() => inspectImage(jpeg.subarray(0, jpeg.length - 2))).toThrow()
    for (const kind of ['VP8X', 'VP8L', 'VP8 '] as const) expect(inspectImage(webp(kind))).toEqual({ mime: 'image/webp', width: 1, height: 1 })
  })
  it('復号前に画素数・辺・アニメーション・破損を拒否する', () => {
    expect(inspectImage(png(8000, 5000)).width).toBe(8000)
    expect(inspectImage(png(16384, 1)).width).toBe(16384)
    for (const bytes of [png(8001, 5000), png(16385, 1), png(0, 1), tinyPng.slice(0, 30), png(1, 1, true), webp('VP8X', true), new Uint8Array(Buffer.from('<svg/>')), new Uint8Array(Buffer.from('GIF89a')), new Uint8Array(Buffer.from('ftypheic'))]) expect(() => inspectImage(bytes)).toThrow()
  })
  it('偽MIME・20MiB超・空ファイルを拒否する', async () => {
    await expect(inspectBlob(new Blob([tinyPng], { type: 'image/jpeg' }))).rejects.toThrow('一致')
    await expect(inspectBlob(new Blob([new Uint8Array(imageLimits.inputBytes + 1)], { type: 'image/png' }))).rejects.toThrow('20MiB')
    await expect(inspectBlob(new Blob())).rejects.toThrow()
  })
  it('20MiBちょうどのPNG fixtureはヘッダ検査を通す', async () => {
    const bytes = new Uint8Array(imageLimits.inputBytes);const offset = tinyPng.length - 12
    bytes.set(tinyPng.subarray(0, offset));const view = new DataView(bytes.buffer)
    view.setUint32(offset, bytes.length - tinyPng.length - 12);bytes.set(Buffer.from('tEXt'), offset + 4);bytes.set(tinyPng.subarray(offset), bytes.length - 12)
    expect(await inspectBlob(new Blob([bytes], { type: 'image/png' }))).toEqual({ mime: 'image/png', width: 1, height: 1 })
  })
  it('拡大せず比率を保ち、料理写真/画面画像/サムネイルの辺を抑える', () => {
    expect(fitDimensions(4000, 2000, 1600)).toEqual({ width: 1600, height: 800 })
    expect(fitDimensions(100, 50, 320)).toEqual({ width: 100, height: 50 })
    expect(fitDimensions(1000, 10000, 2560)).toEqual({ width: 256, height: 2560 })
  })
  it('保存画像の寸法・byteLength・参照型・サムネイル種別を検査する', async () => {
    const image = screenshot(crypto.randomUUID())
    expect(await validateImageAsset(image)).toEqual(image)
    for (const extra of [{ recipeId: 'bad' }, { byteLength: 1 }, { width: 2 }, { mime: 'image/jpeg' }, { kind: 'dish' }, { thumbnail: { ...image } }]) await expect(validateImageAsset({ ...image, ...extra })).rejects.toThrow()
  })
})
