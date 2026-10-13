import { BackupError, backupLimits, validateBackup, countsOf, type Counts } from '../domain/backup'
import { imageMetadata, validateImageAsset } from '../domain/images'
import type { Meta } from '../domain/types'
import { backupFilename, emptyBackup, encodeBinary, type PreparedRestore } from '../services/backup'
import { getDatabase, notifyChanged, stores, validateMeta } from './database'
import { DataError, storageError } from './errors'

export interface SettingsSnapshot { counts: Counts; meta: Meta }
export async function readSettings(): Promise<SettingsSnapshot> {
  try {
    const db = await getDatabase(); const tx = db.transaction(stores, 'readonly')
    const [recipes, images, mealDecisions, cookingLogs, meta] = await Promise.all([
      tx.objectStore('recipes').count(), tx.objectStore('images').count(), tx.objectStore('mealDecisions').count(), tx.objectStore('cookingLogs').count(), tx.objectStore('meta').get('state'),
    ])
    await tx.done
    return { counts: { recipes, images, mealDecisions, cookingLogs }, meta: validateMeta(meta) }
  } catch (error) { throw storageError(error) }
}
export async function generateBackup(progress?: (done: number, total: number) => void) {
  try {
    const db = await getDatabase(); const tx = db.transaction(stores, 'readonly')
    const [recipes, images, mealDecisions, cookingLogs, state] = await Promise.all([
      tx.objectStore('recipes').getAll(), tx.objectStore('images').getAll(), tx.objectStore('mealDecisions').getAll(), tx.objectStore('cookingLogs').getAll(), tx.objectStore('meta').get('state'),
    ])
    await tx.done
    if (recipes.length > backupLimits.recipes || images.length > backupLimits.images || mealDecisions.length > backupLimits.histories || cookingLogs.length > backupLimits.histories || images.reduce((sum, image) => sum + image.byteLength + (image.thumbnail?.byteLength ?? 0), 0) > backupLimits.mediaBytes) throw new BackupError('保存データ', '件数・画像容量の上限を超えています。')
    const meta = validateMeta(state); const exportedAt = new Date().toISOString()
    // スナップショット取得後に変換する。DBのトランザクション中で画像を待たない。
    const backup = { ...emptyBackup(exportedAt), recipes, images: images.map(imageMetadata), mealDecisions, cookingLogs }
    for (const [index, image] of images.entries()) {
      await validateImageAsset(image)
      backup.images[index]!.original = await encodeBinary(image.blob, image.width, image.height)
      if (image.thumbnail) backup.images[index]!.thumbnail = await encodeBinary(image.thumbnail.blob, image.thumbnail.width, image.thumbnail.height)
      progress?.(index + 1, images.length)
    }
    const validated = validateBackup(backup).backup
    return { blob: new Blob([JSON.stringify(validated)], { type: 'application/json' }), name: backupFilename(exportedAt), revision: meta.dataRevision, exportedAt }
  } catch (error) { throw storageError(error) }
}
export async function recordExportRequest(revision: number, requestedAt: string) {
  const db = await getDatabase(); const tx = db.transaction('meta', 'readwrite')
  try {
    const meta = validateMeta(await tx.store.get('state'))
    await tx.store.put({ ...meta, lastExportRequestedAt: requestedAt, lastExportRevision: revision })
    await tx.done
  } catch (error) { try { tx.abort() } catch { /* already completed */ } await tx.done.catch(() => undefined); throw storageError(error) }
  notifyChanged()
}
export async function acknowledgeLossNotice() {
  const db = await getDatabase(); const tx = db.transaction('meta', 'readwrite')
  try {
    const meta = validateMeta(await tx.store.get('state'))
    await tx.store.put({ ...meta, lossNoticeAcknowledged: true })
    await tx.done
  } catch (error) { try { tx.abort() } catch { /* already completed */ } await tx.done.catch(() => undefined); throw storageError(error) }
  notifyChanged()
}
export async function restoreBackup(prepared: PreparedRestore, expectedDataRevision: number) {
  const db = await getDatabase(); const tx = db.transaction(stores, 'readwrite')
  try {
    const meta = validateMeta(await tx.objectStore('meta').get('state'))
    if (meta.dataRevision !== expectedDataRevision) throw new DataError('conflict', '別の画面で更新されました。現在の件数を再確認して、もう一度置換を確認してください。')
    if (!Number.isSafeInteger(meta.dataRevision + 1)) throw new DataError('limit', '更新世代の上限に達しました。')
    // ここからはIDBの処理のみ。clearと全putを5storeの同じ取引に含める。
    for (const store of ['recipes', 'images', 'mealDecisions', 'cookingLogs'] as const) await tx.objectStore(store).clear()
    for (const recipe of prepared.recipes) await tx.objectStore('recipes').put(recipe)
    for (const image of prepared.images) await tx.objectStore('images').put(image)
    for (const decision of prepared.mealDecisions) await tx.objectStore('mealDecisions').put(decision)
    for (const log of prepared.cookingLogs) await tx.objectStore('cookingLogs').put(log)
    const now = new Date().toISOString()
    await tx.objectStore('meta').put({ ...meta, dataRevision: meta.dataRevision + 1,
      lastChangedAt: meta.lastChangedAt && meta.lastChangedAt > now ? meta.lastChangedAt : now,
      lastExportRequestedAt: null, lastExportRevision: null, mediaBytes: prepared.mediaBytes, metadataBytes: prepared.metadataBytes })
    await tx.done
  } catch (error) { try { tx.abort() } catch { /* already aborted */ } await tx.done.catch(() => undefined); throw storageError(error) }
  notifyChanged()
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('recipe-data-restored'))
}
export function restoreCounts(prepared: PreparedRestore): Counts { return countsOf(prepared) }
