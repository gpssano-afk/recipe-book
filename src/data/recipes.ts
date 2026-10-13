import type { Meta, Recipe, RecipeDraft } from '../domain/types'
import { isId, validateDraft, validateRecipe } from '../domain/validation'
import { byteSize, getDatabase, notifyChanged, stores, validateMeta } from './database'
import { DataError, storageError } from './errors'

export interface Snapshot { recipes: Recipe[]; meta: Meta }
export async function readSnapshot(): Promise<Snapshot> {
  try {
    const db = await getDatabase()
    const tx = db.transaction(['recipes', 'meta'], 'readonly')
    const [recipes, meta] = await Promise.all([tx.objectStore('recipes').getAll(), tx.objectStore('meta').get('state')])
    await tx.done
    try { return { recipes: recipes.map(validateRecipe), meta: validateMeta(meta) } }
    catch { throw new DataError('invalid', '保存データを読み込めません。データを保持したまま処理を停止しました。') }
  } catch (error) { throw storageError(error) }
}
export async function readRecipe(id: string): Promise<{ recipe: Recipe; meta: Meta }> {
  const snapshot = await readSnapshot()
  const recipe = snapshot.recipes.find(item => item.id === id)
  if (!recipe) throw new DataError('missing', 'レシピが見つかりません。削除されたか、URLが正しくない可能性があります。')
  return { recipe, meta: snapshot.meta }
}
function sameDraft(a: RecipeDraft, b: RecipeDraft) { return JSON.stringify(validateDraft(a)) === JSON.stringify(validateDraft(b)) }
const conflict = () => new DataError('conflict', '別の画面でデータが更新されました。入力は残っています。最新データを確認してから再編集してください。')
const ensureRevision = (meta: Meta, expected: number) => { if (meta.dataRevision !== expected) throw conflict() }
function nextMeta(meta: Meta, metadataBytes: number, now: string): Meta {
  if (metadataBytes > 8 * 1024 * 1024) throw new DataError('limit', 'テキストデータの上限（8MiB）を超えます。不要なテスト用レシピを削除してください。')
  if (!Number.isSafeInteger(meta.dataRevision + 1)) throw new DataError('limit', '更新世代の上限に達しました。')
  return { ...meta, dataRevision: meta.dataRevision + 1, metadataBytes,
    lastChangedAt: meta.lastChangedAt && meta.lastChangedAt > now ? meta.lastChangedAt : now }
}
export interface SaveOptions { id: string; expectedRevision: number | null; expectedDataRevision: number }
export async function saveRecipe(input: unknown, options: SaveOptions): Promise<Recipe> {
  const draft = validateDraft(input)
  if (!isId(options.id)) throw new DataError('invalid', 'レシピIDの形式が正しくありません。')
  const snapshot = await readSnapshot()
  const old = snapshot.recipes.find(item => item.id === options.id)
  // 同じ新規操作の再送は、世代が進んでいても追加を繰り返さない。
  if (options.expectedRevision === null && old && sameDraft(old, draft)) return old
  ensureRevision(snapshot.meta, options.expectedDataRevision)
  if (options.expectedRevision !== null && !old) throw new DataError('missing', '編集対象は削除されました。入力を控えてから一覧へ戻ってください。')
  if ((old?.revision ?? null) !== options.expectedRevision) throw conflict()
  if (!old && snapshot.recipes.length >= 1000) throw new DataError('limit', 'レシピは1,000件までです。不要なテスト用レシピを削除してください。')
  const now = new Date().toISOString()
  const recipe: Recipe = {
    ...draft, id: options.id, isFavorite: old?.isFavorite ?? false,
    imageIds: old?.imageIds ?? [], coverImageId: old?.coverImageId ?? null,
    createdAt: old?.createdAt ?? now, updatedAt: old && old.updatedAt > now ? old.updatedAt : now,
    revision: (old?.revision ?? 0) + 1,
  }
  if (!Number.isSafeInteger(recipe.revision)) throw new DataError('limit', 'レシピ更新回数の上限に達しました。')
  // 配列区切りのカンマも含め、将来の非画像バックアップ容量と同じ計数を保つ。
  const delta = byteSize(recipe) - (old ? byteSize(old) : 0) + (!old && snapshot.recipes.length ? 1 : 0)
  const meta = nextMeta(snapshot.meta, snapshot.meta.metadataBytes + delta, now)
  const db = await getDatabase()
  const tx = db.transaction(['recipes', 'meta'], 'readwrite')
  try {
    const [currentMeta, current] = await Promise.all([tx.objectStore('meta').get('state'), tx.objectStore('recipes').get(options.id)])
    ensureRevision(validateMeta(currentMeta), options.expectedDataRevision)
    if ((current?.revision ?? null) !== options.expectedRevision) throw conflict()
    await tx.objectStore('recipes').put(recipe)
    await tx.objectStore('meta').put(meta)
    await tx.done
    notifyChanged()
    return recipe
  } catch (error) {
    try { tx.abort() } catch { /* 完了済みならabortは不要 */ }
    await tx.done.catch(() => undefined)
    throw storageError(error)
  }
}

export async function getDeleteCounts(id: string): Promise<{ images: number; mealDecisions: number; cookingLogs: number }> {
  try {
    const db = await getDatabase()
    const tx = db.transaction(['images', 'mealDecisions', 'cookingLogs'], 'readonly')
    const [images, mealDecisions, cookingLogs] = await Promise.all([
      tx.objectStore('images').index('recipeId').count(id), tx.objectStore('mealDecisions').index('recipeId').count(id),
      tx.objectStore('cookingLogs').index('recipeId').count(id),
    ])
    await tx.done
    return { images, mealDecisions, cookingLogs }
  } catch (error) { throw storageError(error) }
}

export async function deleteRecipe(id: string, expectedRevision: number, expectedDataRevision: number): Promise<void> {
  const db = await getDatabase()
  const tx = db.transaction(stores, 'readwrite')
  try {
    const [rawMeta, recipe, recipeCount, images, decisions, logs, imageCount, decisionCount, logCount] = await Promise.all([
      tx.objectStore('meta').get('state'), tx.objectStore('recipes').get(id), tx.objectStore('recipes').count(),
      tx.objectStore('images').index('recipeId').getAll(id), tx.objectStore('mealDecisions').index('recipeId').getAll(id),
      tx.objectStore('cookingLogs').index('recipeId').getAll(id),
      tx.objectStore('images').count(), tx.objectStore('mealDecisions').count(), tx.objectStore('cookingLogs').count(),
    ])
    const meta = validateMeta(rawMeta)
    ensureRevision(meta, expectedDataRevision)
    if (!recipe) throw new DataError('missing', 'レシピはすでに削除されています。')
    if (validateRecipe(recipe).revision !== expectedRevision) throw conflict()
    const removedArrayBytes = (values: unknown[], total: number) => values.reduce<number>((sum, value) => sum + byteSize(value), 0) + Math.min(values.length, Math.max(0, total - 1))
    const imageMetadata = images.map(image => ({
      id: image.id, recipeId: image.recipeId, kind: image.kind, createdAt: image.createdAt,
      original: { mime: image.mime, width: image.width, height: image.height, byteLength: image.byteLength, base64: '' },
      thumbnail: image.thumbnail ? { mime: image.thumbnail.mime, width: image.thumbnail.width,
        height: image.thumbnail.height, byteLength: image.thumbnail.byteLength, base64: '' } : null,
    }))
    const metadataBytes = meta.metadataBytes - removedArrayBytes([recipe], recipeCount) - removedArrayBytes(imageMetadata, imageCount) -
      removedArrayBytes(decisions, decisionCount) - removedArrayBytes(logs, logCount)
    const updatedMeta = nextMeta(meta, metadataBytes, new Date().toISOString())
    updatedMeta.mediaBytes -= images.reduce((sum, image) => sum + image.byteLength + (image.thumbnail?.byteLength ?? 0), 0)
    if (updatedMeta.mediaBytes < 0 || updatedMeta.metadataBytes < 0) throw new DataError('invalid', '保存容量の計数が一致しません。データを保持したまま削除を停止しました。')
    await tx.objectStore('recipes').delete(id)
    for (const image of images) await tx.objectStore('images').delete(image.id)
    for (const decision of decisions) await tx.objectStore('mealDecisions').delete(decision.id)
    for (const log of logs) await tx.objectStore('cookingLogs').delete(log.id)
    await tx.objectStore('meta').put(updatedMeta)
    await tx.done
    notifyChanged()
  } catch (error) {
    try { tx.abort() } catch { /* 完了済みならabortは不要 */ }
    await tx.done.catch(() => undefined)
    throw storageError(error)
  }
}
