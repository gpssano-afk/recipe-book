import type { ImageAsset } from '../domain/types'
import { ImageError, imageLimits, inspectBlob } from '../domain/images'

export const fitDimensions = (width: number, height: number, maxEdge: number) => {
  const ratio = Math.min(1, maxEdge / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) }
}
async function encode(bitmap: ImageBitmap, width: number, height: number, mime: string, quality?: number): Promise<Blob> {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
  try {
    const context = canvas.getContext('2d')
    if (!context) throw new ImageError('画像処理を開始できません。画像なしで登録するか、ブラウザを確認してください。')
    if (mime === 'image/jpeg') { context.fillStyle = '#fff'; context.fillRect(0, 0, width, height) }
    context.drawImage(bitmap, 0, 0, width, height)
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(result => result && result.type === mime ? resolve(result) : reject(new ImageError('このブラウザは必要な画像形式の圧縮に対応していません。')), mime, quality))
    return blob
  } finally { canvas.width = 0; canvas.height = 0 }
}
async function compress(bitmap: ImageBitmap, maxEdge: number, maxBytes: number, kind: ImageAsset['kind']) {
  let { width, height } = fitDimensions(bitmap.width, bitmap.height, maxEdge)
  while (true) {
    if (kind === 'screenshot') {
      const png = await encode(bitmap, width, height, 'image/png')
      if (png.size <= maxBytes) return { blob: png, mime: 'image/png' as const, width, height, byteLength: png.size }
    }
    const mime = kind === 'dish' ? 'image/jpeg' as const : 'image/webp' as const
    for (const quality of kind === 'dish' ? [0.8, 0.7, 0.6] : [0.9, 0.8, 0.7]) {
      const blob = await encode(bitmap, width, height, mime, quality)
      if (blob.size <= maxBytes) return { blob, mime, width, height, byteLength: blob.size }
    }
    const longest = Math.max(width, height)
    const minimum = maxEdge <= 320 ? 64 : 640
    if (longest <= minimum) throw new ImageError('画像を保存容量以内に圧縮できませんでした。切り抜きや小さい画像で再試行してください。')
    const next = fitDimensions(width, height, Math.max(minimum, Math.floor(longest * 0.8)))
    width = next.width; height = next.height
  }
}
export async function prepareImage(file: Blob, recipeId: string, kind: ImageAsset['kind']): Promise<ImageAsset> {
  const header = await inspectBlob(file)
  let bitmap: ImageBitmap
  try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }) }
  catch { throw new ImageError('画像を読み取れませんでした。破損していないJPEG・PNG・WebPの静止画を選んでください。') }
  try {
    const same = bitmap.width === header.width && bitmap.height === header.height
    const rotated = header.mime === 'image/jpeg' && bitmap.width === header.height && bitmap.height === header.width
    if (!same && !rotated) throw new ImageError('画像の実際の寸法がヘッダと一致しません。')
    const original = await compress(bitmap, kind === 'dish' ? 1600 : 2560, imageLimits.storedBytes, kind)
    const thumbnail = kind === 'dish' ? await compress(bitmap, 320, imageLimits.thumbnailBytes, 'dish') : null
    return { ...original, id: crypto.randomUUID(), recipeId, kind, createdAt: new Date().toISOString(),
      thumbnail: thumbnail && thumbnail.mime === 'image/jpeg' ? { ...thumbnail, mime: 'image/jpeg' } : null }
  } finally { bitmap.close() }
}
