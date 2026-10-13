import { BackupError, backupLimits, validateBackup, type BackupBinary, type BackupV1 } from '../domain/backup'
import type { CookingLog, ImageAsset, MealDecision, Recipe } from '../domain/types'
import { inspectBlob, validateImageAsset } from '../domain/images'

export interface PreparedRestore {
  exportedAt: string; recipes: Recipe[]; images: ImageAsset[]; mealDecisions: MealDecision[]; cookingLogs: CookingLog[]
  mediaBytes: number; metadataBytes: number
}
export function checkCancelled(signal?: AbortSignal) { signal?.throwIfAborted() }
export async function verifyDecodedImage(blob: Blob, width: number, height: number) {
  let bitmap: ImageBitmap | undefined
  try {
    bitmap = await createImageBitmap(blob, { imageOrientation: 'none' })
    if (bitmap.width !== width || bitmap.height !== height) throw new Error()
  } finally { bitmap?.close() }
}
export function binaryBlob(binary: BackupBinary): Blob {
  const raw = atob(binary.base64)
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return new Blob([bytes], { type: binary.mime })
}
export async function prepareRestore(value: unknown, signal?: AbortSignal, progress?: (done: number, total: number) => void): Promise<PreparedRestore> {
  checkCancelled(signal)
  const { backup, mediaBytes, metadataBytes } = validateBackup(value)
  const images: ImageAsset[] = []
  for (const [index, image] of backup.images.entries()) {
    checkCancelled(signal)
    try {
      const blob = binaryBlob(image.original)
      const thumbnail = image.thumbnail ? { mime: 'image/jpeg' as const, width: image.thumbnail.width, height: image.thumbnail.height, byteLength: image.thumbnail.byteLength, blob: binaryBlob(image.thumbnail) } : null
      const asset = { id: image.id, recipeId: image.recipeId, kind: image.kind, createdAt: image.createdAt, mime: image.original.mime, width: image.original.width, height: image.original.height, byteLength: image.original.byteLength, blob, thumbnail }
      await validateImageAsset(asset)
      await verifyDecodedImage(blob, asset.width, asset.height)
      if (thumbnail) await verifyDecodedImage(thumbnail.blob, thumbnail.width, thumbnail.height)
      checkCancelled(signal)
      images.push(asset); progress?.(index + 1, backup.images.length)
    } catch (error) {
      checkCancelled(signal)
      if (error instanceof BackupError) throw error
      throw new BackupError(`images[${index}]`, '画像を復号できないか、形式・寸法・容量が一致しません。')
    }
  }
  return { exportedAt: backup.exportedAt, recipes: backup.recipes, images, mealDecisions: backup.mealDecisions, cookingLogs: backup.cookingLogs, mediaBytes, metadataBytes }
}
export async function readBackupFile(file: Blob, signal?: AbortSignal, progress?: (done: number, total: number) => void): Promise<PreparedRestore> {
  if (file.size > backupLimits.fileBytes) throw new BackupError('ファイル', '64MiBを超えています。読み込みませんでした。')
  const bytes = await file.arrayBuffer()
  checkCancelled(signal)
  let value: unknown
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }
  catch { throw new BackupError('ファイル', 'UTF-8のJSONとして読み込めません。') }
  return prepareRestore(value, signal, progress)
}
export async function encodeBinary(blob: Blob, width: number, height: number): Promise<BackupBinary> {
  await inspectBlob(blob, backupLimits.mediaBytes)
  await verifyDecodedImage(blob, width, height)
  const bytes = new Uint8Array(await blob.arrayBuffer())
  // spreadで1MiBを関数の引数へ渡すとスタック上限を超えるため、小分けにする。
  const parts: string[] = []
  for (let offset = 0; offset < bytes.length; offset += 8192) parts.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)))
  return { mime: blob.type as BackupBinary['mime'], width, height, byteLength: blob.size, base64: btoa(parts.join('')) }
}
export const backupFilename = (instant: string) => `sano-gohan-backup-${instant.slice(0, 10).replaceAll('-', '')}-${instant.slice(11, 19).replaceAll(':', '')}.json`
export const emptyBackup = (exportedAt: string): BackupV1 => ({ format: 'sano-gohan-backup', formatVersion: 1, exportedAt, recipes: [], images: [], mealDecisions: [], cookingLogs: [] })
