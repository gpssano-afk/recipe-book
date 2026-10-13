import type { ImageAsset, Meta, Recipe, RecipeDraft } from '../domain/types'
import { isId, validateDraft, validateRecipe } from '../domain/validation'
import { imageLimits, imageMetadata, mediaSize, validateImageAsset } from '../domain/images'
import { byteSize, getDatabase, notifyChanged, stores, validateMeta } from './database'
import { DataError, storageError } from './errors'
import { readRecipeImages } from './images'

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
async function sameImages(recipe: Recipe, images: ImageAsset[]): Promise<boolean> {
  const stored = await readRecipeImages(recipe)
  const sameBlob = async (a: Blob, b: Blob) => {
    if (a.size !== b.size || a.type !== b.type) return false
    const first = new Uint8Array(await a.arrayBuffer()); const second = new Uint8Array(await b.arrayBuffer())
    return first.every((value, index) => value === second[index])
  }
  for (const [index, image] of images.entries()) {
    const old = stored[index]
    if (!old || JSON.stringify(imageMetadata(old)) !== JSON.stringify(imageMetadata(image)) || !(await sameBlob(old.blob, image.blob))) return false
    if (old.thumbnail && image.thumbnail && !(await sameBlob(old.thumbnail.blob, image.thumbnail.blob))) return false
  }
  return stored.length === images.length
}
function nextMeta(meta: Meta, metadataBytes: number, now: string): Meta {
  if (metadataBytes > 8 * 1024 * 1024) throw new DataError('limit', 'テキストデータの上限（8MiB）を超えます。不要なテスト用レシピを削除してください。')
  if (!Number.isSafeInteger(meta.dataRevision + 1)) throw new DataError('limit', '更新世代の上限に達しました。')
  return { ...meta, dataRevision: meta.dataRevision + 1, metadataBytes,
    lastChangedAt: meta.lastChangedAt && meta.lastChangedAt > now ? meta.lastChangedAt : now }
}
export interface SaveOptions { id: string; expectedRevision: number | null; expectedDataRevision: number; isFavorite?: boolean; media?: { images: ImageAsset[]; coverImageId: string | null } }
export async function saveRecipe(input: unknown, options: SaveOptions): Promise<Recipe> {
  const draft = validateDraft(input)
  if (!isId(options.id)) throw new DataError('invalid', 'レシピIDの形式が正しくありません。')
  const snapshot = await readSnapshot()
  const old = snapshot.recipes.find(item => item.id === options.id)
  if (options.isFavorite !== undefined && typeof options.isFavorite !== 'boolean') throw new DataError('invalid', 'お気に入りの形式が正しくありません。')
  if (options.media && (!Array.isArray(options.media.images) || options.media.images.length > 6 || !(options.media.coverImageId === null || isId(options.media.coverImageId)))) throw new DataError('invalid', '写真は6枚までです。表紙の指定を確認してください。')
  const images = options.media ? await Promise.all(options.media.images.map(validateImageAsset)) : undefined
  if (images && (images.length > 6 || new Set(images.map(image => image.id)).size !== images.length || images.some(image => image.recipeId !== options.id))) throw new DataError('invalid', '写真は同じレシピの6枚までです。重複・他のレシピの写真は保存できません。')
  const dishes = images?.filter(image => image.kind === 'dish')
  const coverImageId = images ? options.media!.coverImageId ?? dishes?.[0]?.id ?? null : options.expectedRevision === null ? null : old?.coverImageId ?? null
  if (images && coverImageId !== null && !dishes?.some(image => image.id === coverImageId)) throw new DataError('invalid', '表紙にはこのレシピの料理写真を選んでください。')
  const isFavorite = options.isFavorite ?? (options.expectedRevision === null ? false : old?.isFavorite ?? false)
  // 同じ新規操作の再送は、世代が進んでいても追加を繰り返さない。
  if (options.expectedRevision === null && old && sameDraft(old, draft) && old.isFavorite === isFavorite && old.coverImageId === coverImageId && (images ? JSON.stringify(old.imageIds) === JSON.stringify(images.map(image => image.id)) && await sameImages(old, images) : old.imageIds.length === 0)) return old
  ensureRevision(snapshot.meta, options.expectedDataRevision)
  if (options.expectedRevision !== null && !old) throw new DataError('missing', '編集対象は削除されました。入力を控えてから一覧へ戻ってください。')
  if ((old?.revision ?? null) !== options.expectedRevision) throw conflict()
  if (!old && snapshot.recipes.length >= 1000) throw new DataError('limit', 'レシピは1,000件までです。不要なテスト用レシピを削除してください。')
  const now = new Date().toISOString()
  const recipe: Recipe = {
    ...draft, id: options.id, isFavorite,
    imageIds: images?.map(image => image.id) ?? old?.imageIds ?? [], coverImageId,
    createdAt: old?.createdAt ?? now, updatedAt: old && old.updatedAt > now ? old.updatedAt : now,
    revision: (old?.revision ?? 0) + 1,
  }
  if (!Number.isSafeInteger(recipe.revision)) throw new DataError('limit', 'レシピ更新回数の上限に達しました。')
  // 配列区切りのカンマも含め、将来の非画像バックアップ容量と同じ計数を保つ。
  let delta = byteSize(recipe) - (old ? byteSize(old) : 0) + (!old && snapshot.recipes.length ? 1 : 0)
  const db = await getDatabase()
  let oldImages: ImageAsset[] = []
  let mediaBytes = snapshot.meta.mediaBytes
  if (images) {
    const read = db.transaction(['images', 'meta'])
    const [records, count, currentMeta] = await Promise.all([read.objectStore('images').index('recipeId').getAll(options.id), read.objectStore('images').count(), read.objectStore('meta').get('state')]); await read.done
    ensureRevision(validateMeta(currentMeta), options.expectedDataRevision)
    oldImages = records
    if ((!old && oldImages.length) || (old && (oldImages.length !== old.imageIds.length || oldImages.some(image => !old.imageIds.includes(image.id))))) throw new DataError('invalid', '写真の参照が一致しません。元データを保持したまま保存を停止しました。')
    const sumBytes = (items: ImageAsset[]) => items.reduce((sum, image) => sum + byteSize(imageMetadata(image)), 0)
    delta += sumBytes(images) - sumBytes(oldImages) + Math.max(0, count - oldImages.length + images.length - 1) - Math.max(0, count - 1)
    mediaBytes += images.reduce((sum, image) => sum + mediaSize(image), 0) - oldImages.reduce((sum, image) => sum + mediaSize(image), 0)
    if (count - oldImages.length + images.length > 6000 || mediaBytes > imageLimits.mediaBytes) throw new DataError('limit', '写真の保存上限（6,000枚・40MiB）を超えます。不要なテスト用写真を削除してください。')
    if (mediaBytes < 0) throw new DataError('invalid', '写真容量の計数が一致しません。保存を停止しました。')
  }
  const meta = { ...nextMeta(snapshot.meta, snapshot.meta.metadataBytes + delta, now), mediaBytes }
  const tx = db.transaction(['recipes', 'images', 'meta'], 'readwrite')
  try {
    const [currentMeta, current] = await Promise.all([tx.objectStore('meta').get('state'), tx.objectStore('recipes').get(options.id)])
    ensureRevision(validateMeta(currentMeta), options.expectedDataRevision)
    if ((current?.revision ?? null) !== options.expectedRevision) throw conflict()
    if (images) {
      for (const image of images) {
        const existing = await tx.objectStore('images').get(image.id)
        if (existing && existing.recipeId !== options.id) throw conflict()
        await tx.objectStore('images').put(image)
      }
      for (const image of oldImages) if (!images.some(item => item.id === image.id)) await tx.objectStore('images').delete(image.id)
    }
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

export async function setRecipeFavorite(recipe: Recipe, isFavorite: boolean, expectedDataRevision: number): Promise<Recipe> {
  return saveRecipe(recipe, { id: recipe.id, expectedRevision: recipe.revision, expectedDataRevision, isFavorite })
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
    const metadataBytes = meta.metadataBytes - removedArrayBytes([recipe], recipeCount) - removedArrayBytes(images.map(imageMetadata), imageCount) -
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
