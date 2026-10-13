import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { openDB } from 'idb'
import { byteSize, closeDatabase, DB_NAME, emptyMetadataBytes, getDatabase, initialMeta, stores } from '../../src/data/database'
import { deleteRecipe, getDeleteCounts, readRecipe, readSnapshot, saveRecipe } from '../../src/data/recipes'
import { emptyDraft, type ImageAsset, type MealDecision, type CookingLog } from '../../src/domain/types'
const draft = (title = '架空の煮物') => ({ ...emptyDraft(), title })
const create = async (title?: string) => {
  const snapshot = await readSnapshot()
  return saveRecipe(draft(title), { id: crypto.randomUUID(), expectedRevision: null, expectedDataRevision: snapshot.meta.dataRevision })
}
beforeEach(async () => { vi.restoreAllMocks(); await closeDatabase(); globalThis.indexedDB = new IDBFactory() })
describe('T01/T03/T04/T13/T19/T25 IndexedDB保存', () => {
  it('v1の5store・index・初期metaを構築し空DBを読める', async () => {
    const db = await getDatabase()
    expect(db.version).toBe(1)
    expect([...db.objectStoreNames]).toEqual([...stores].sort())
    const tx = db.transaction(stores)
    expect([...tx.objectStore('recipes').indexNames]).toEqual(['category', 'updatedAt'])
    expect(tx.objectStore('cookingLogs').index('decisionId').unique).toBe(true)
    await tx.done
    expect(await readSnapshot()).toEqual({ recipes: [], meta: initialMeta() })
  })
  it('新規保存、接続の再起動、編集、削除で一貫したデータを保持する', async () => {
    const first = await create()
    await closeDatabase()
    expect((await readRecipe(first.id)).recipe).toEqual(first)
    const updated = await saveRecipe(draft('架空の新しい煮物'), { id: first.id, expectedRevision: 1, expectedDataRevision: 1 })
    expect(updated.id).toBe(first.id); expect(updated.createdAt).toBe(first.createdAt); expect(updated.revision).toBe(2)
    const snapshot = await readSnapshot()
    expect(snapshot.meta.metadataBytes).toBe(emptyMetadataBytes() + byteSize(updated))
    await deleteRecipe(first.id, 2, 2)
    expect((await readSnapshot()).recipes).toEqual([])
    expect((await readSnapshot()).meta).toMatchObject({ dataRevision: 3, metadataBytes: emptyMetadataBytes() })
  })
  it('新規の同じ操作IDを再送しても重複しない', async () => {
    const id = crypto.randomUUID(); const options = { id, expectedRevision: null, expectedDataRevision: 0 }
    const first = await saveRecipe(draft(), options)
    expect(await saveRecipe(draft(), options)).toEqual(first)
    expect((await readSnapshot()).recipes).toHaveLength(1)
    await expect(saveRecipe(draft('別の入力'), options)).rejects.toMatchObject({ kind: 'conflict' })
  })
  it('競合と同時更新を拒否し、先行更新を上書きしない', async () => {
    const first = await create()
    const results = await Promise.allSettled(['変更A', '変更B'].map(title => saveRecipe(draft(title), { id: first.id, expectedRevision: 1, expectedDataRevision: 1 })))
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    await expect(deleteRecipe(first.id, 1, 1)).rejects.toMatchObject({ kind: 'conflict' })
    expect((await readRecipe(first.id)).recipe.revision).toBe(2)
  })
  it.each(['QuotaExceededError', 'AbortError'])('%sをmeta書込みへ注入しレシピ更新もロールバックする', async name => {
    const first = await create()
    const before = await readSnapshot()
    const original = IDBObjectStore.prototype.put
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'meta') throw new DOMException('injected', name)
      return original.apply(this, args)
    })
    await expect(saveRecipe(draft('保存しない'), { id: first.id, expectedRevision: 1, expectedDataRevision: 1 })).rejects.toMatchObject({ kind: name === 'QuotaExceededError' ? 'quota' : 'storage' })
    vi.restoreAllMocks()
    expect(await readSnapshot()).toEqual(before)
  })
  it('時計が戻ってもupdatedAtを戻さずrevisionを増やす', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-01T00:00:00.000Z'))
    const first = await create()
    vi.setSystemTime(new Date('2025-10-01T00:00:00.000Z'))
    const result = await saveRecipe(draft('変更'), { id: first.id, expectedRevision: 1, expectedDataRevision: 1 })
    vi.useRealTimers()
    expect(result.updatedAt).toBe(first.updatedAt); expect(result.revision).toBe(2)
  })
  it('未存在ID、削除後の編集、不正DBレコードでデータを作り直さない', async () => {
    await expect(readRecipe(crypto.randomUUID())).rejects.toMatchObject({ kind: 'missing' })
    const first = await create(); await deleteRecipe(first.id, 1, 1)
    await expect(saveRecipe(draft(), { id: first.id, expectedRevision: 1, expectedDataRevision: 2 })).rejects.toMatchObject({ kind: 'missing' })
    const db = await getDatabase(); await db.put('recipes', { ...first, revision: 0 })
    await expect(readSnapshot()).rejects.toMatchObject({ kind: 'invalid' })
    expect(await db.count('recipes')).toBe(1)
  })
  it('レシピ1,000件・非画像8MiBの上限を拒否しDBを保持する', async () => {
    const first = await create()
    const db = await getDatabase(); const tx = db.transaction('recipes', 'readwrite')
    for (let i = 1; i < 1000; i++) await tx.store.put({ ...first, id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}` })
    await tx.done
    await expect(create('超過')).rejects.toMatchObject({ kind: 'limit' })
    expect(await db.count('recipes')).toBe(1000)
    const meta = (await readSnapshot()).meta; await db.put('meta', { ...meta, metadataBytes: 8 * 1024 * 1024 })
    await expect(saveRecipe(draft('あ'.repeat(100)), { id: first.id, expectedRevision: 1, expectedDataRevision: 1 })).rejects.toMatchObject({ kind: 'limit' })
    expect((await db.get('recipes', first.id))?.title).toBe(first.title)
  })
  it('新しいDB版を古いアプリで開いても自動削除しない', async () => {
    const first = await create(); await closeDatabase()
    const future = await openDB(DB_NAME, 2); future.close()
    await expect(readSnapshot()).rejects.toMatchObject({ kind: 'version' })
    const inspect = await openDB(DB_NAME, 2)
    expect(await inspect.get('recipes', first.id)).toEqual(first); inspect.close()
  })
  it('画像と履歴を同時削除し、途中失敗では全件を保持する', async () => {
    const first = await create(); const db = await getDatabase()
    const image: ImageAsset = { id: crypto.randomUUID(), recipeId: first.id, kind: 'screenshot', mime: 'image/png', width: 1, height: 1, byteLength: 1, blob: new Blob(['x']), thumbnail: null, createdAt: first.createdAt }
    const decision: MealDecision = { id: crypto.randomUUID(), recipeId: first.id, recipeTitleSnapshot: first.title, categorySnapshot: first.category, decidedAt: first.createdAt }
    const log: CookingLog = { id: crypto.randomUUID(), recipeId: first.id, decisionId: decision.id, cookedOn: '2026-01-01', memo: '', createdAt: first.createdAt, updatedAt: first.updatedAt, revision: 1 }
    const imageMetadata = { id: image.id, recipeId: image.recipeId, kind: image.kind, createdAt: image.createdAt, original: { mime: image.mime, width: 1, height: 1, byteLength: 1, base64: '' }, thumbnail: null }
    const before = await readSnapshot(); const tx = db.transaction(stores, 'readwrite')
    await tx.objectStore('images').put(image); await tx.objectStore('mealDecisions').put(decision); await tx.objectStore('cookingLogs').put(log)
    await tx.objectStore('meta').put({ ...before.meta, mediaBytes: 1, metadataBytes: before.meta.metadataBytes + byteSize(imageMetadata) + byteSize(decision) + byteSize(log) }); await tx.done
    expect(await getDeleteCounts(first.id)).toEqual({ images: 1, mealDecisions: 1, cookingLogs: 1 })
    const original = IDBObjectStore.prototype.delete
    vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(function (this: IDBObjectStore, key: IDBValidKey | IDBKeyRange) {
      if (this.name === 'cookingLogs') throw new DOMException('injected', 'AbortError')
      return original.call(this, key)
    })
    await expect(deleteRecipe(first.id, 1, 1)).rejects.toMatchObject({ kind: 'storage' })
    vi.restoreAllMocks()
    expect(await getDeleteCounts(first.id)).toEqual({ images: 1, mealDecisions: 1, cookingLogs: 1 })
    expect((await readRecipe(first.id)).recipe).toEqual(first)
    await deleteRecipe(first.id, 1, 1)
    expect(await getDeleteCounts(first.id)).toEqual({ images: 0, mealDecisions: 0, cookingLogs: 0 })
    expect((await readSnapshot()).meta).toMatchObject({ metadataBytes: emptyMetadataBytes(), mediaBytes: 0 })
  })
})
