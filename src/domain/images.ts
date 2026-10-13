import type { ImageAsset } from './types'
import { isId, isInstant } from './validation'

export const MiB = 1024 * 1024
export const imageLimits = { inputBytes: 20 * MiB, pixels: 40_000_000, edge: 16384, storedBytes: MiB, thumbnailBytes: 100 * 1024, mediaBytes: 40 * MiB }
export interface ImageHeader { mime: ImageAsset['mime']; width: number; height: number }
export interface RecipeMedia { images: ImageAsset[]; coverImageId: string | null }
export const mediaSignature = (media: RecipeMedia) => JSON.stringify({ ids: media.images.map(image => image.id), cover: media.coverImageId })
export class ImageError extends Error {}
const invalid = () => new ImageError('画像の形式が不正、または破損しています。JPEG・PNG・WebPの静止画を選んでください。')
function dimensions(mime: ImageHeader['mime'], width: number, height: number): ImageHeader {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw invalid()
  if (width > imageLimits.edge || height > imageLimits.edge || width * height > imageLimits.pixels) throw new ImageError('画像は40メガピクセル・各辺16,384px以内にしてください。')
  return { mime, width, height }
}
export function inspectImage(bytes: Uint8Array): ImageHeader {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const ascii = (offset: number, length: number) => String.fromCharCode(...bytes.subarray(offset, offset + length))
  if (bytes.length >= 33 && bytes.slice(0, 8).every((b, i) => b === [137, 80, 78, 71, 13, 10, 26, 10][i])) {
    if (view.getUint32(8) !== 13 || ascii(12, 4) !== 'IHDR') throw invalid()
    const header = dimensions('image/png', view.getUint32(16), view.getUint32(20))
    let offset = 8
    while (offset + 12 <= bytes.length) {
      const length = view.getUint32(offset); const kind = ascii(offset + 4, 4)
      if (offset + length + 12 > bytes.length) throw invalid()
      if (['acTL', 'fcTL', 'fdAT'].includes(kind)) throw new ImageError('アニメーションPNGは保存できません。静止画を選んでください。')
      offset += length + 12
      if (kind === 'IEND') { if (length !== 0 || offset !== bytes.length) throw invalid(); return header }
    }
    throw invalid()
  }
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216) {
    if (bytes[bytes.length - 2] !== 255 || bytes[bytes.length - 1] !== 217) throw invalid()
    let offset = 2
    while (offset + 3 < bytes.length) {
      if (bytes[offset++] !== 255) throw invalid()
      while (bytes[offset] === 255) offset++
      const marker = bytes[offset++]
      if (marker === undefined || marker === 217 || marker === 218) break
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue
      if (offset + 2 > bytes.length) throw invalid()
      const length = view.getUint16(offset)
      if (length < 2 || offset + length > bytes.length) throw invalid()
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
        if (length < 8) throw invalid()
        return dimensions('image/jpeg', view.getUint16(offset + 5), view.getUint16(offset + 3))
      }
      offset += length
    }
    throw invalid()
  }
  if (bytes.length >= 20 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    if (view.getUint32(4, true) + 8 !== bytes.length) throw invalid()
    let offset = 12; let header: ImageHeader | undefined
    while (offset + 8 <= bytes.length) {
      const kind = ascii(offset, 4); const size = view.getUint32(offset + 4, true); const start = offset + 8
      if (start + size > bytes.length) throw invalid()
      if (['ANIM', 'ANMF'].includes(kind) || (kind === 'VP8X' && ((bytes[start] ?? 0) & 2))) throw new ImageError('アニメーションWebPは保存できません。静止画を選んでください。')
      if (kind === 'VP8X') {
        if (size !== 10) throw invalid()
        const u24 = (pos: number) => view.getUint8(pos) + (view.getUint8(pos + 1) << 8) + (view.getUint8(pos + 2) << 16)
        header = dimensions('image/webp', u24(start + 4) + 1, u24(start + 7) + 1)
      } else if (kind === 'VP8 ') {
        if (size < 10 || ascii(start + 3, 3) !== '\u009d\u0001\u002a') throw invalid()
        header ??= dimensions('image/webp', view.getUint16(start + 6, true) & 0x3fff, view.getUint16(start + 8, true) & 0x3fff)
      } else if (kind === 'VP8L') {
        if (size < 5 || bytes[start] !== 47) throw invalid()
        const bits = view.getUint32(start + 1, true)
        header ??= dimensions('image/webp', (bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1)
      }
      offset = start + size + (size % 2)
    }
    if (header && offset === bytes.length) return header
  }
  throw invalid()
}
export async function inspectBlob(blob: Blob, maxBytes = imageLimits.inputBytes): Promise<ImageHeader> {
  if (!(blob instanceof Blob) || blob.size === 0) throw invalid()
  if (blob.size > maxBytes) throw new ImageError(`画像は${maxBytes === imageLimits.inputBytes ? '20MiB' : '保存容量の上限'}以内にしてください。`)
  const header = inspectImage(new Uint8Array(await blob.arrayBuffer()))
  if (blob.type && blob.type !== header.mime) throw new ImageError('画像の内容とファイル形式が一致しません。別の画像を選んでください。')
  return header
}
export function imageMetadata(image: ImageAsset) {
  const binary = (item: { mime: string; width: number; height: number; byteLength: number }) => ({ mime: item.mime, width: item.width, height: item.height, byteLength: item.byteLength, base64: '' })
  return { id: image.id, recipeId: image.recipeId, kind: image.kind, createdAt: image.createdAt, original: binary(image), thumbnail: image.thumbnail ? binary(image.thumbnail) : null }
}
export const mediaSize = (image: ImageAsset) => image.byteLength + (image.thumbnail?.byteLength ?? 0)
export async function validateImageAsset(value: unknown): Promise<ImageAsset> {
  if (!value || typeof value !== 'object') throw invalid()
  const image = value as ImageAsset
  if (!isId(image.id) || !isId(image.recipeId) || !isInstant(image.createdAt) || !['dish', 'screenshot'].includes(image.kind)) throw invalid()
  const verify = async (binary: ImageAsset | NonNullable<ImageAsset['thumbnail']>, edge: number, max: number) => {
    const header = await inspectBlob(binary.blob, max)
    if (header.mime !== binary.mime || header.width !== binary.width || header.height !== binary.height || binary.blob.size !== binary.byteLength || Math.max(header.width, header.height) > edge) throw invalid()
  }
  await verify(image, image.kind === 'dish' ? 1600 : 2560, imageLimits.storedBytes)
  if (image.kind === 'dish') {
    if (image.mime !== 'image/jpeg' || !image.thumbnail || image.thumbnail.mime !== 'image/jpeg') throw invalid()
    await verify(image.thumbnail, 320, imageLimits.thumbnailBytes)
  } else if (image.thumbnail !== null || !['image/png', 'image/webp'].includes(image.mime)) throw invalid()
  return image
}
