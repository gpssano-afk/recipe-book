import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { backupLimits, backupReminderDue, isLocalDate, validateBackup, type BackupV1 } from '../../src/domain/backup'
import { emptyDraft, type Recipe } from '../../src/domain/types'
import { inspectBlob } from '../../src/domain/images'
import { binaryBlob, emptyBackup, prepareRestore, readBackupFile } from '../../src/services/backup'
import { acknowledgeLossNotice, generateBackup, readSettings, recordExportRequest, restoreBackup } from '../../src/data/backup'
import { closeDatabase, getDatabase, stores } from '../../src/data/database'
import { readSnapshot, saveRecipe } from '../../src/data/recipes'
import { tinyPng } from './media-fixtures'

const instant = '2026-01-01T00:00:00.000Z'
function fixture(): BackupV1 {
  const recipe: Recipe = { ...emptyDraft(), id: crypto.randomUUID(), title: '架空の往復料理', category: 'main', ingredients: [{ name: '架空食材', amount: '適量' }], steps: ['混ぜる'], memo: '架空のメモ', tags: ['和食'], sourceUrl: 'https://example.com/recipe', servings: 3, cookingMinutes: 20, isFavorite: true, imageIds: [], coverImageId: null, createdAt: instant, updatedAt: instant, revision: 3 }
  const backup = { ...emptyBackup(instant), recipes: [recipe] }
  const image = { id: crypto.randomUUID(), recipeId: recipe.id, kind: 'screenshot' as const, createdAt: instant, original: { mime: 'image/png' as const, width: 1, height: 1, byteLength: tinyPng.length, base64: Buffer.from(tinyPng).toString('base64') }, thumbnail: null }
  recipe.imageIds = [image.id]; backup.images = [image]
  const decision = { id: crypto.randomUUID(), recipeId: recipe.id, recipeTitleSnapshot: '当時の料理名', categorySnapshot: 'side' as const, decidedAt: instant }
  backup.mealDecisions = [decision]
  backup.cookingLogs = [{ id: crypto.randomUUID(), recipeId: recipe.id, decisionId: decision.id, cookedOn: '2024-02-29', memo: '架空の調理記録', createdAt: instant, updatedAt: instant, revision: 2 }]
  return backup
}
beforeEach(async () => {
  vi.restoreAllMocks(); await closeDatabase(); globalThis.indexedDB = new IDBFactory()
  // 単体試験ではヘッダfixtureを使う。実際の画像復号はブラウザE2Eで検証する。
  vi.stubGlobal('createImageBitmap', vi.fn(async (blob: Blob) => { const header = await inspectBlob(blob); return { width: header.width, height: header.height, close: vi.fn() } }))
})
afterEach(() => vi.unstubAllGlobals())

describe('T14/T15/T16 全件置換と原子性', () => {
  it('全種・写真のバイト・お気に入り・ID・順序・日時を空DBと既存DBで往復する', async () => {
    const input = fixture(); const prepared = await prepareRestore(input)
    await restoreBackup(prepared, 0)
    expect((await readSnapshot()).recipes).toEqual(input.recipes)
    expect((await readSettings()).meta).toMatchObject({ dataRevision: 1, mediaBytes: tinyPng.length, metadataBytes: validateBackup(input).metadataBytes, lastExportRevision: null })
    const generated = await generateBackup()
    const exported = JSON.parse(await generated.blob.text()) as BackupV1
    expect({ ...exported, exportedAt: input.exportedAt }).toEqual(input)
    const db = await getDatabase(); const image = await db.get('images', input.images[0]!.id)
    expect(new Uint8Array(await image!.blob.arrayBuffer())).toEqual(tinyPng)
    const second = fixture(); await restoreBackup(await prepareRestore(second), 1)
    expect(await db.get('recipes', input.recipes[0]!.id)).toBeUndefined()
    expect((await readSettings()).counts).toEqual({ recipes: 1, images: 1, mealDecisions: 1, cookingLogs: 1 })
    await closeDatabase(); expect((await readSnapshot()).recipes).toEqual(second.recipes)
  })
  it('空バックアップの往復と既存データの全置換を許可する', async () => {
    const backup = await generateBackup(); expect(JSON.parse(await backup.blob.text()).recipes).toEqual([])
    await restoreBackup(await prepareRestore(fixture()), 0)
    await restoreBackup(await readBackupFile(backup.blob), 1)
    expect((await readSettings()).counts).toEqual({ recipes: 0, images: 0, mealDecisions: 0, cookingLogs: 0 })
    expect((await readSettings()).meta.mediaBytes).toBe(0)
  })
  it.each(['recipes', 'images', 'mealDecisions', 'cookingLogs', 'meta'])('%sのput失敗でclear・途中put・画像・全metaをrollbackする', async store => {
    const original = fixture(); await restoreBackup(await prepareRestore(original), 0)
    const before = await readSnapshot(); const db = await getDatabase()
    const replacement = await prepareRestore(fixture()); const put = IDBObjectStore.prototype.put
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) { if (this.name === store) throw new DOMException('injected', 'QuotaExceededError'); return put.apply(this, args) })
    await expect(restoreBackup(replacement, 1)).rejects.toMatchObject({ kind: 'quota' })
    vi.restoreAllMocks(); expect(await readSnapshot()).toEqual(before)
    expect(await db.getAll('mealDecisions')).toEqual(original.mealDecisions); expect(await db.getAll('cookingLogs')).toEqual(original.cookingLogs)
    expect(new Uint8Array(await (await db.getAll('images'))[0]!.blob.arrayBuffer())).toEqual(tinyPng)
    for (const name of stores.filter(name => name !== 'meta')) expect(await db.count(name)).toBe(1)
  })
  it('明示abortでも旧全件を保全する', async () => {
    await restoreBackup(await prepareRestore(fixture()), 0); const before = await generateBackup()
    const prepared = await prepareRestore(fixture()); const put = IDBObjectStore.prototype.put
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) { if (this.name === 'images') this.transaction.abort(); return put.apply(this, args) })
    await expect(restoreBackup(prepared, 1)).rejects.toThrow(); vi.restoreAllMocks()
    const after = await generateBackup()
    const comparable = async (blob: Blob) => { const value = JSON.parse(await blob.text()); delete value.exportedAt; return value }
    expect(await comparable(after.blob)).toEqual(await comparable(before.blob))
  })
  it('確認中の世代変更では一切置換しない', async () => {
    const prepared = await prepareRestore(fixture())
    await saveRecipe({ ...emptyDraft(), title: '別画面からの変更' }, { id: crypto.randomUUID(), expectedRevision: null, expectedDataRevision: 0 })
    const before = await readSnapshot(); await expect(restoreBackup(prepared, 0)).rejects.toMatchObject({ kind: 'conflict' }); expect(await readSnapshot()).toEqual(before)
  })
  it('書き出し要求の記録前の変更を出力済み世代と誤認しない', async () => {
    await restoreBackup(await prepareRestore(fixture()), 0)
    const output = await generateBackup()
    const before = await readSnapshot(); const recipe = before.recipes[0]!
    await saveRecipe({ ...recipe, title: '書き出し後の変更' }, { id: recipe.id, expectedRevision: recipe.revision, expectedDataRevision: 1 })
    await recordExportRequest(output.revision, instant)
    expect((await readSettings()).meta).toMatchObject({ dataRevision: 2, lastExportRevision: 1, lastExportRequestedAt: instant })
    expect(JSON.parse(await output.blob.text()).recipes[0].title).toBe('架空の往復料理')
  })
  it('検証キャンセルでDB不変、初回消失案内の確認はデータ世代を変えない', async () => {
    const controller = new AbortController();controller.abort()
    await expect(readBackupFile(new Blob([JSON.stringify(fixture())]), controller.signal)).rejects.toThrow()
    expect((await readSettings()).counts.recipes).toBe(0)
    await acknowledgeLossNotice(); expect((await readSettings()).meta).toMatchObject({ lossNoticeAcknowledged: true, dataRevision: 0 })
  })
})

describe('T17 不正ファイルは全件拒否', () => {
  const invalids: [string, (b: BackupV1) => void][] = [
    ['不正format', b => { b.format = 'unknown' as BackupV1['format'] }], ['未来版', b => { b.formatVersion = 2 as 1 }],
    ['必須欠落', b => { Reflect.deleteProperty(b, 'exportedAt') }], ['未知キー', b => { Object.assign(b, { extra: true }) }],
    ['未知ネストキー', b => { Object.assign(b.recipes[0]!.ingredients[0]!, { extra: true }) }],
    ['不正日時', b => { b.exportedAt = '2026-02-30T00:00:00.000Z' }], ['前後日時', b => { b.recipes[0]!.updatedAt = '2020-01-01T00:00:00.000Z' }],
    ['不正UUID', b => { b.recipes[0]!.id = '123' }], ['重複ID', b => { b.recipes.push({ ...b.recipes[0]! }) }], ['大文字重複ID', b => { b.recipes.push({ ...b.recipes[0]!, id: b.recipes[0]!.id.toUpperCase() }) }],
    ['負revision', b => { b.recipes[0]!.revision = -1 }], ['小数', b => { b.recipes[0]!.servings = 1.1 }], ['不正enum', b => { b.recipes[0]!.category = 'invalid' as Recipe['category'] }],
    ['100文字超', b => { b.recipes[0]!.title = '😀'.repeat(101) }], ['正規化されていない', b => { b.recipes[0]!.title = ' 料理 ' }], ['空材料行', b => { b.recipes[0]!.ingredients.push({ name: '', amount: '' }) }],
    ['不正URL', b => { b.recipes[0]!.sourceUrl = 'javascript:alert(1)' }], ['認証URL', b => { b.recipes[0]!.sourceUrl = 'https://user:pass@example.com' }], ['重複タグ', b => { b.recipes[0]!.tags = ['A', 'Ａ'] }],
    ['未知写真', b => { b.recipes[0]!.imageIds = [crypto.randomUUID()] }], ['画面画像表紙', b => { b.recipes[0]!.coverImageId = b.images[0]!.id }], ['孤児画像', b => { b.recipes[0]!.imageIds = [] }],
    ['未知履歴レシピ', b => { b.mealDecisions[0]!.recipeId = crypto.randomUUID() }], ['未知決定', b => { b.cookingLogs[0]!.decisionId = crypto.randomUUID() }],
    ['別料理決定', b => { const r = { ...b.recipes[0]!, id: crypto.randomUUID(), imageIds: [], coverImageId: null }; b.recipes.push(r); b.cookingLogs[0]!.recipeId = r.id }],
    ['重複紐付け', b => { b.cookingLogs.push({ ...b.cookingLogs[0]!, id: crypto.randomUUID() }) }], ['未来調理日', b => { b.cookingLogs[0]!.cookedOn = '9999-01-01' }], ['不正閏日', b => { b.cookingLogs[0]!.cookedOn = '2023-02-29' }],
    ['負容量', b => { b.images[0]!.original.byteLength = -1 }], ['宣言byteLength不一致', b => { b.images[0]!.original.byteLength++ }], ['不正base64', b => { b.images[0]!.original.base64 += '\n' }],
    ['dataURL', b => { b.images[0]!.original.base64 = 'data:image/png;base64,' + b.images[0]!.original.base64 }], ['宣言MIME詐称', b => { b.images[0]!.original.mime = 'image/webp' }], ['寸法詐称', b => { b.images[0]!.original.width = 2 }],
    ['dishサムネイルなし', b => { b.images[0]!.kind = 'dish' }], ['保存辺超過', b => { b.images[0]!.original.width = 2561 }], ['巨大配列', b => { b.recipes = Array.from({ length: 1001 }, () => b.recipes[0]!) }],
  ]
  it.each(invalids)('%sで拒否し旧DBを保持', async (_name, mutate) => {
    const original = fixture(); await restoreBackup(await prepareRestore(original), 0)
    const before = await readSnapshot(); const input = fixture(); mutate(input)
    await expect(readBackupFile(new Blob([JSON.stringify(input)]))).rejects.toThrow(); expect(await readSnapshot()).toEqual(before)
  })
  it('UTF-8不正・JSON破損・危険キー・深い構造を拒否', async () => {
    const deep = { ...fixture(), unknown: JSON.parse('['.repeat(21) + '0' + ']'.repeat(21)) }
    for (const file of [new Blob([new Uint8Array([255, 255])]), new Blob(['{broken']), new Blob(['{"__proto__":{}}']), new Blob(['{"constructor":{}}']), new Blob(['{"prototype":{}}']), new Blob([JSON.stringify(deep)])]) await expect(readBackupFile(file)).rejects.toThrow()
  })
  it('64MiB超のファイルはarrayBufferを呼ぶ前に拒否する', async () => {
    const file = new Blob([new Uint8Array(backupLimits.fileBytes + 1)]); const read = vi.spyOn(file, 'arrayBuffer')
    await expect(readBackupFile(file)).rejects.toThrow('64MiB'); expect(read).not.toHaveBeenCalled()
  })
  it('base64の非canonical paddingを拒否、空履歴と調理日の境界を受け入れる', () => {
    const input = fixture();const base64 = input.images[0]!.original.base64; input.images[0]!.original.base64 = base64.slice(0, -3) + 'B=='
    expect(() => validateBackup(input)).toThrow(); expect(validateBackup(emptyBackup(instant)).mediaBytes).toBe(0)
    expect(isLocalDate('1900-01-01', '2026-10-13')).toBe(true);expect(isLocalDate('1899-12-31')).toBe(false);expect(isLocalDate('2024-02-29')).toBe(true)
  })
  it('ヘッダのみ正しくてもブラウザ復号不能なら拒否しBitmapを解放する', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('decode failed')))
    await expect(prepareRestore(fixture())).rejects.toThrow('images[0]')
    const close = vi.fn(); vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 2, height: 1, close }))
    await expect(prepareRestore(fixture())).rejects.toThrow('images[0]');expect(close).toHaveBeenCalledOnce()
  })
  it('復元バイナリを再圧縮しない', async () => {
    expect(new Uint8Array(await binaryBlob(fixture().images[0]!.original).arrayBuffer())).toEqual(tinyPng)
  })
})
it('T18 空DBと未出力・7日＋変更の案内境界', async () => {
  const meta = (await readSettings()).meta; const now = Date.parse('2026-01-08T00:00:00.000Z')
  expect(backupReminderDue(meta, 0, now)).toBe(false);expect(backupReminderDue(meta, 1, now)).toBe(true)
  const exported = { ...meta, dataRevision: 2, lastExportRevision: 1, lastExportRequestedAt: instant }
  expect(backupReminderDue(exported, 1, now - 1)).toBe(false);expect(backupReminderDue(exported, 1, now)).toBe(true)
  expect(backupReminderDue({ ...exported, lastExportRevision: 2 }, 1, now)).toBe(false)
})

describe('T17/T18 アプリ上限の境界', () => {
  it('画像40MiBちょうどは受理、1MiB追加を拒否する（ヘッダfixture、実機性能の代替ではない）', () => {
    const size = 1024 ** 2;const bytes = new Uint8Array(size);const offset = tinyPng.length - 12
    bytes.set(tinyPng.subarray(0, offset));const view = new DataView(bytes.buffer)
    view.setUint32(offset, size - tinyPng.length - 12);bytes.set(Buffer.from('tEXt'), offset + 4);bytes.set(tinyPng.subarray(offset), size - 12)
    const binary = { mime: 'image/png' as const, width: 1, height: 1, byteLength: size, base64: Buffer.from(bytes).toString('base64') }
    const backup = emptyBackup(instant)
    for (let i = 0; i < 7; i++) backup.recipes.push({ ...fixture().recipes[0]!, id: crypto.randomUUID(), imageIds: [] })
    for (let i = 0; i < 40; i++) { const recipe = backup.recipes[Math.floor(i / 6)]!;const id = crypto.randomUUID();recipe.imageIds.push(id);backup.images.push({ id, recipeId: recipe.id, kind: 'screenshot', createdAt: instant, original: binary, thumbnail: null }) }
    expect(validateBackup(backup).mediaBytes).toBe(backupLimits.mediaBytes)
    const recipe = backup.recipes[6]!;const id = crypto.randomUUID();recipe.imageIds.push(id);backup.images.push({ id, recipeId: recipe.id, kind: 'screenshot', createdAt: instant, original: binary, thumbnail: null })
    expect(() => validateBackup(backup)).toThrow('40MiB')
  })
  it('非画像8MiBちょうどは受理、1バイト追加を拒否する', () => {
    const backup = emptyBackup(instant)
    for (let i = 0; i < 400; i++) backup.recipes.push({ ...fixture().recipes[0]!, id: crypto.randomUUID(), memo: '', steps: Array.from({ length: 8 }, () => 'a'), imageIds: [] })
    let remaining = backupLimits.metadataBytes - new TextEncoder().encode(JSON.stringify(backup)).length
    for (const recipe of backup.recipes) {
      const memoLength = Math.min(remaining, 5000);recipe.memo = 'a'.repeat(memoLength);remaining -= memoLength
      for (let index = 0; index < recipe.steps.length; index++) { const extra = Math.min(remaining, 1999);recipe.steps[index] += 'a'.repeat(extra);remaining -= extra }
    }
    expect(remaining).toBe(0);expect(validateBackup(backup).metadataBytes).toBe(backupLimits.metadataBytes)
    backup.recipes[399]!.memo += 'a';expect(() => validateBackup(backup)).toThrow('8MiB')
  })
  it('件数1,000/20,000と1,001/20,001の境界を区別する', () => {
    const backup = emptyBackup(instant)
    for (let i = 0; i < 1000; i++) backup.recipes.push({ ...fixture().recipes[0]!, id: crypto.randomUUID(), imageIds: [] })
    expect(validateBackup(backup).backup.recipes).toHaveLength(1000)
    backup.recipes.push({ ...backup.recipes[0]!, id: crypto.randomUUID() });expect(() => validateBackup(backup)).toThrow('1000')
    backup.recipes.pop()
    for (let i = 0; i < 20000; i++) backup.mealDecisions.push({ id: crypto.randomUUID(), recipeId: backup.recipes[0]!.id, recipeTitleSnapshot: '架空', categorySnapshot: 'main', decidedAt: instant })
    expect(validateBackup(backup).backup.mealDecisions).toHaveLength(20000)
    backup.mealDecisions.push({ ...backup.mealDecisions[0]!, id: crypto.randomUUID() });expect(() => validateBackup(backup)).toThrow()
  })
})
it('T17 JSONファイル64MiBちょうどを受理する（空JSONと末尾空白）', async () => {
  const source = JSON.stringify(emptyBackup(instant));const file = new Blob([source, ' '.repeat(backupLimits.fileBytes - source.length)])
  expect(file.size).toBe(backupLimits.fileBytes);expect((await readBackupFile(file)).recipes).toEqual([])
})
it('復元可能な最大revisionを編集してもunsafe整数を保存しない', async () => {
  const backup = fixture();backup.recipes[0]!.revision = Number.MAX_SAFE_INTEGER
  await restoreBackup(await prepareRestore(backup), 0);const before = await readSnapshot();const recipe = before.recipes[0]!
  await expect(saveRecipe({ ...recipe, title: '保存しない' }, { id: recipe.id, expectedRevision: recipe.revision, expectedDataRevision: before.meta.dataRevision })).rejects.toMatchObject({ kind: 'limit' })
  expect(await readSnapshot()).toEqual(before)
})
