import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { byteSize, closeDatabase, emptyMetadataBytes, getDatabase } from '../../src/data/database'
import { deleteRecipe, readSnapshot, saveRecipe, setRecipeFavorite } from '../../src/data/recipes'
import { readImage, readRecipeImages } from '../../src/data/images'
import { emptyDraft } from '../../src/domain/types'
import { imageLimits, imageMetadata, mediaSize } from '../../src/domain/images'
import { screenshot } from './media-fixtures'

beforeEach(async () => { vi.restoreAllMocks(); await closeDatabase(); globalThis.indexedDB = new IDBFactory() })
describe('T01/T03/T04/T05/T13 写真と定番の原子的保存', () => {
  it('写真付き新規操作の再送は同じBlobだけ成功として返す', async () => {
    const id = crypto.randomUUID();const image = screenshot(id);const input = { ...emptyDraft(), title: '再送テスト' }
    const options = { id, expectedRevision: null, expectedDataRevision: 0, media: { images: [image], coverImageId: null } }
    const first = await saveRecipe(input, options)
    expect(await saveRecipe(input, options)).toEqual(first)
    const changedBytes = new Uint8Array(await image.blob.arrayBuffer());changedBytes[44] = (changedBytes[44] ?? 0) ^ 1
    await expect(saveRecipe(input, { ...options, media: { images: [{ ...image, blob: new Blob([changedBytes], { type: 'image/png' }) }], coverImageId: null } })).rejects.toMatchObject({ kind: 'conflict' })
    await expect(saveRecipe(input, { ...options, media: { images: [{ ...image, createdAt: '2026-02-01T00:00:00.000Z' }], coverImageId: null } })).rejects.toMatchObject({ kind: 'conflict' })
    expect((await readSnapshot()).meta.dataRevision).toBe(1)
  })
  it('Phase1Aデータを保持し写真を追加・編集・削除する。計数はファイル形式と一致', async () => {
    const id = crypto.randomUUID();const original = await saveRecipe({ ...emptyDraft(), title: '架空料理' }, { id, expectedRevision: null, expectedDataRevision: 0 })
    const images = [screenshot(id), screenshot(id)]
    const saved = await saveRecipe(original, { id, expectedRevision: 1, expectedDataRevision: 1, media: { images, coverImageId: null }, isFavorite: true })
    expect(saved.createdAt).toBe(original.createdAt);expect(saved.isFavorite).toBe(true);expect(saved.coverImageId).toBe(null)
    await closeDatabase()
    expect((await readRecipeImages(saved)).map(image => image.id)).toEqual(images.map(image => image.id))
    expect((await readImage(images[0]!.id, id, false)).blob.size).toBe(images[0]!.blob.size)
    const expectedBytes = byteSize({ format: 'sano-gohan-backup', formatVersion: 1, exportedAt: '2000-01-01T00:00:00.000Z', recipes: [saved], images: images.map(imageMetadata), mealDecisions: [], cookingLogs: [] })
    expect((await readSnapshot()).meta).toMatchObject({ metadataBytes: expectedBytes, mediaBytes: images.reduce((sum, image) => sum + mediaSize(image), 0) })
    const changed = await saveRecipe(saved, { id, expectedRevision: 2, expectedDataRevision: 2, media: { images: [images[1]!], coverImageId: null } })
    expect(changed.imageIds).toEqual([images[1]!.id]);expect(await (await getDatabase()).get('images', images[0]!.id)).toBeUndefined()
    await deleteRecipe(id, 3, 3)
    expect((await readSnapshot()).meta).toMatchObject({ mediaBytes: 0, metadataBytes: emptyMetadataBytes() })
  })
  it.each(['QuotaExceededError', 'AbortError'])('%s時に新写真・旧写真・本文・metaをすべて保全', async name => {
    const id = crypto.randomUUID();const image = screenshot(id)
    const first = await saveRecipe({ ...emptyDraft(), title: '架空料理' }, { id, expectedRevision: null, expectedDataRevision: 0, media: { images: [image], coverImageId: null } })
    const before = await readSnapshot();const replacement = screenshot(id);const put = IDBObjectStore.prototype.put
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) { if (this.name === 'meta') throw new DOMException('injected', name);return put.apply(this, args) })
    await expect(saveRecipe({ ...first, title: '変更しない' }, { id, expectedRevision: 1, expectedDataRevision: 1, media: { images: [replacement], coverImageId: null } })).rejects.toThrow()
    vi.restoreAllMocks()
    expect(await readSnapshot()).toEqual(before);expect((await readRecipeImages(first))[0]?.id).toBe(image.id)
    expect(await (await getDatabase()).get('images', replacement.id)).toBeUndefined()
  })
  it('表紙が画面画像・重複・他レシピ参照・7枚を拒否', async () => {
    const id = crypto.randomUUID();const image = screenshot(id);const options = { id, expectedRevision: null, expectedDataRevision: 0 }
    for (const media of [{ images: [image], coverImageId: image.id }, { images: [image, image], coverImageId: null }, { images: [screenshot(crypto.randomUUID())], coverImageId: null }, { images: Array.from({ length: 7 }, () => screenshot(id)), coverImageId: null }]) await expect(saveRecipe({ ...emptyDraft(), title: '架空' }, { ...options, media })).rejects.toThrow()
    expect((await readSnapshot()).recipes).toHaveLength(0)
  })
  it('40MiB境界と超過、上限付近でも写真削減を許可', async () => {
    const id = crypto.randomUUID();const image = screenshot(id)
    const first = await saveRecipe({ ...emptyDraft(), title: '架空' }, { id, expectedRevision: null, expectedDataRevision: 0 })
    const db = await getDatabase();const meta = (await readSnapshot()).meta
    await db.put('meta', { ...meta, mediaBytes: imageLimits.mediaBytes - image.byteLength })
    const saved = await saveRecipe(first, { id, expectedRevision: 1, expectedDataRevision: 1, media: { images: [image], coverImageId: null } })
    expect((await readSnapshot()).meta.mediaBytes).toBe(imageLimits.mediaBytes)
    await expect(saveRecipe(saved, { id, expectedRevision: 2, expectedDataRevision: 2, media: { images: [image, screenshot(id)], coverImageId: null } })).rejects.toMatchObject({ kind: 'limit' })
    await saveRecipe(saved, { id, expectedRevision: 2, expectedDataRevision: 2, media: { images: [], coverImageId: null } })
    expect((await readSnapshot()).meta.mediaBytes).toBe(imageLimits.mediaBytes - image.byteLength)
  })
  it('定番切替はrevisionを照合し画像を変更しない。失敗は旧状態', async () => {
    const id = crypto.randomUUID();const image = screenshot(id)
    const first = await saveRecipe({ ...emptyDraft(), title: '架空' }, { id, expectedRevision: null, expectedDataRevision: 0, media: { images: [image], coverImageId: null } })
    const updated = await setRecipeFavorite(first, true, 1)
    expect(updated.isFavorite).toBe(true);expect(updated.imageIds).toEqual(first.imageIds)
    await expect(setRecipeFavorite(first, false, 1)).rejects.toMatchObject({ kind: 'conflict' })
    expect((await readSnapshot()).recipes[0]?.isFavorite).toBe(true)
  })
})
