import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { CookingLog, ImageAsset, MealDecision, Meta, Recipe } from '../domain/types'
import { isInstant } from '../domain/validation'
import { DataError, storageError } from './errors'

export const DB_NAME = 'sano-recipe-book'
export const DB_VERSION = 1
export const stores = ['recipes', 'images', 'mealDecisions', 'cookingLogs', 'meta'] as const
export interface RecipeDatabase extends DBSchema {
  recipes: { key: string; value: Recipe; indexes: { category: string; updatedAt: string } }
  images: { key: string; value: ImageAsset; indexes: { recipeId: string } }
  mealDecisions: { key: string; value: MealDecision; indexes: { recipeId: string; decidedAt: string } }
  cookingLogs: { key: string; value: CookingLog; indexes: { recipeId: string; cookedOn: string; decisionId: string } }
  meta: { key: string; value: Meta }
}
export const byteSize = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length
export const emptyMetadataBytes = () => byteSize({
  format: 'sano-gohan-backup', formatVersion: 1, exportedAt: '2000-01-01T00:00:00.000Z',
  recipes: [], images: [], mealDecisions: [], cookingLogs: [],
})
export const initialMeta = (): Meta => ({ key: 'state', dataRevision: 0, lastChangedAt: null,
  lastExportRequestedAt: null, lastExportRevision: null, lossNoticeAcknowledged: false,
  mediaBytes: 0, metadataBytes: emptyMetadataBytes() })

export function validateMeta(value: unknown): Meta {
  if (!value || typeof value !== 'object') throw new DataError('invalid', '保存状態を読み込めません。データを保持したまま処理を停止しました。')
  const meta = value as Meta
  const integer = (n: unknown) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0
  if (meta.key !== 'state' || !integer(meta.dataRevision) || !integer(meta.mediaBytes) || !integer(meta.metadataBytes) ||
    typeof meta.lossNoticeAcknowledged !== 'boolean' || !(meta.lastChangedAt === null || isInstant(meta.lastChangedAt)) ||
    !(meta.lastExportRequestedAt === null || isInstant(meta.lastExportRequestedAt)) || !(meta.lastExportRevision === null || integer(meta.lastExportRevision))) {
    throw new DataError('invalid', '保存状態の形式が正しくありません。データを保持したまま処理を停止しました。')
  }
  return meta
}

let connection: Promise<IDBPDatabase<RecipeDatabase>> | undefined
let mustReload = false
function announceUnavailable() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('recipe-db-unavailable'))
}
export function getDatabase(): Promise<IDBPDatabase<RecipeDatabase>> {
  if (mustReload) return Promise.reject(new DataError('version', 'データベース接続が更新されました。入力を控えてからページを再読み込みしてください。'))
  if (!connection) {
    connection = new Promise<IDBPDatabase<RecipeDatabase>>((resolve, reject) => {
      let rejected = false
      const opening = openDB<RecipeDatabase>(DB_NAME, DB_VERSION, {
        upgrade(db, oldVersion, _newVersion, transaction) {
          // 既存DBを消去する経路を作らず、新規DBのv1だけを構築する。
          if (oldVersion !== 0) return
          const recipes = db.createObjectStore('recipes', { keyPath: 'id' })
          recipes.createIndex('category', 'category'); recipes.createIndex('updatedAt', 'updatedAt')
          db.createObjectStore('images', { keyPath: 'id' }).createIndex('recipeId', 'recipeId')
          const decisions = db.createObjectStore('mealDecisions', { keyPath: 'id' })
          decisions.createIndex('recipeId', 'recipeId'); decisions.createIndex('decidedAt', 'decidedAt')
          const logs = db.createObjectStore('cookingLogs', { keyPath: 'id' })
          logs.createIndex('recipeId', 'recipeId'); logs.createIndex('cookedOn', 'cookedOn')
          logs.createIndex('decisionId', 'decisionId', { unique: true })
          db.createObjectStore('meta', { keyPath: 'key' })
          // upgrade失敗はopenDB側で返す。個別requestのrejectを未処理にしない。
          void transaction.objectStore('meta').add(initialMeta()).catch(() => undefined)
        },
        blocked() {
          rejected = true
          reject(new DataError('blocked', 'データベースの準備が別タブに阻まれています。他のタブを閉じて再試行してください。'))
        },
        blocking() {
          mustReload = true
          void opening.then(db => db.close())
          announceUnavailable()
        },
        terminated() { mustReload = true; announceUnavailable() },
      })
      void opening.then(db => { if (rejected) db.close(); else resolve(db) }, reject)
    }).catch(error => { connection = undefined; throw storageError(error) })
  }
  return connection
}

// 接続の終了だけを行う。データのリセットはしない。
export async function closeDatabase(): Promise<void> {
  if (connection) (await connection).close()
  connection = undefined
  mustReload = false
}

let channel: BroadcastChannel | undefined
let channelUnavailable = false
function getChannel() {
  if (!channelUnavailable && typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined') {
    try { channel ??= new BroadcastChannel(DB_NAME) }
    catch { channelUnavailable = true }
  }
  return channel
}
export function notifyChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('recipe-data-changed'))
  // 通知の失敗でcommit済み保存を失敗扱いにしない。focus復帰で再照合できる。
  try { getChannel()?.postMessage('changed') } catch { channelUnavailable = true }
}
export function subscribeChanges(callback: () => void): () => void {
  const broadcast = getChannel()
  window.addEventListener('recipe-data-changed', callback)
  window.addEventListener('recipe-db-unavailable', callback)
  window.addEventListener('focus', callback)
  const visible = () => { if (document.visibilityState === 'visible') callback() }
  document.addEventListener('visibilitychange', visible)
  broadcast?.addEventListener('message', callback)
  return () => {
    window.removeEventListener('recipe-data-changed', callback)
    window.removeEventListener('recipe-db-unavailable', callback)
    window.removeEventListener('focus', callback)
    document.removeEventListener('visibilitychange', visible)
    broadcast?.removeEventListener('message', callback)
  }
}
