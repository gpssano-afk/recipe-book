import { categories, type CookingLog, type ImageAsset, type MealDecision, type Meta, type Recipe } from './types'
import { codePoints, isId, isInstant, normalizeText, validateRecipe } from './validation'

export const backupLimits = { recipes: 1000, images: 6000, histories: 20000, mediaBytes: 40 * 1024 ** 2, metadataBytes: 8 * 1024 ** 2, fileBytes: 64 * 1024 ** 2 }
export interface BackupBinary { mime: ImageAsset['mime']; width: number; height: number; byteLength: number; base64: string }
export interface BackupImage { id: string; recipeId: string; kind: ImageAsset['kind']; createdAt: string; original: BackupBinary; thumbnail: BackupBinary | null }
export interface BackupV1 {
  format: 'sano-gohan-backup'; formatVersion: 1; exportedAt: string
  recipes: Recipe[]; images: BackupImage[]; mealDecisions: MealDecision[]; cookingLogs: CookingLog[]
}
export interface Counts { recipes: number; images: number; mealDecisions: number; cookingLogs: number }
export const countsOf = (data: Record<keyof Counts, readonly unknown[]>): Counts => ({ recipes: data.recipes.length, images: data.images.length, mealDecisions: data.mealDecisions.length, cookingLogs: data.cookingLogs.length })
export class BackupError extends Error {
  constructor(path: string, reason: string) { super(`${path}：${reason}`) }
}
const fail = (path: string, reason = '形式・値が正しくありません。'): never => { throw new BackupError(path, reason) }
function exact(value: unknown, keys: string[], path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(path)
  const result = value as Record<string, unknown>
  if (Object.keys(result).length !== keys.length || keys.some(key => !Object.hasOwn(result, key))) return fail(path, '必須項目の欠落、または未知の項目があります。')
  return result
}
// 標準JSON.parse後の反復走査。入力をmergeせず、許可した項目から作り直す。
export function inspectStructure(value: unknown) {
  const frames: { iterator: Iterator<[string, unknown]>; depth: number }[] = []
  const visit = (item: unknown, depth: number) => {
    if (depth > 20) fail('ファイル', 'JSONの深さは20までです。')
    if (!item || typeof item !== 'object') return
    if (Array.isArray(item) && item.length > backupLimits.histories) fail('ファイル', '配列件数の上限を超えます。')
    const iterator = Array.isArray(item)
      ? item.entries() as IterableIterator<[number, unknown]>
      : (function* () { for (const key of Object.keys(item)) yield [key, (item as Record<string, unknown>)[key]] as [string, unknown] })()
    frames.push({ iterator: iterator as Iterator<[string, unknown]>, depth })
  }
  visit(value, 0)
  while (frames.length) {
    const frame = frames[frames.length - 1]!
    const next = frame.iterator.next()
    if (next.done) { frames.pop(); continue }
    const [key, child] = next.value
    if (['__proto__', 'prototype', 'constructor'].includes(key)) fail('ファイル', '危険な項目名は使用できません。')
    visit(child, frame.depth + 1)
  }
}
function array(value: unknown, max: number, path: string): unknown[] {
  if (!Array.isArray(value) || value.length > max) return fail(path, `${max}件までの配列が必要です。`)
  return value
}
function unique<T extends { id: string }>(values: T[], path: string): Map<string, T> {
  const map = new Map<string, T>()
  for (const value of values) {
    // UUIDは大小文字が異なっても同じ識別子。曖昧な参照を受け入れない。
    const key = value.id.toLowerCase()
    if (map.has(key)) fail(path, 'IDが重複しています。')
    map.set(key, value)
  }
  return new Map(values.map(value => [value.id, value]))
}
const integer = (value: unknown, max = Number.MAX_SAFE_INTEGER) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= max
const text = (value: unknown, max: number, required = false) => typeof value === 'string' && value.length <= max * 2 && value === normalizeText(value) && codePoints(value) <= max && (!required || value.length > 0)
export function localToday(date = new Date()) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` }
export function isLocalDate(value: unknown, today = localToday()): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01' || value > today) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}
export function validateBinary(value: unknown, path: string, maxBytes: number, maxEdge: number): BackupBinary {
  const v = exact(value, ['mime', 'width', 'height', 'byteLength', 'base64'], path)
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(v.mime as string) || !integer(v.width, maxEdge) || !integer(v.height, maxEdge) || !integer(v.byteLength, maxBytes) || typeof v.base64 !== 'string') return fail(path)
  const encoded = v.base64
  if (encoded.length !== 4 * Math.ceil((v.byteLength as number) / 3) || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return fail(path, 'base64の文字・長さ・paddingが不正です。')
  const decoded = atob(encoded)
  if (decoded.length !== v.byteLength || btoa(decoded) !== encoded) return fail(path, 'base64と宣言バイト数が一致しません。')
  return { mime: v.mime as BackupBinary['mime'], width: v.width as number, height: v.height as number, byteLength: v.byteLength as number, base64: encoded }
}
export function metadataOf(backup: BackupV1): BackupV1 {
  return { ...backup, images: backup.images.map(image => ({ ...image, original: { ...image.original, base64: '' }, thumbnail: image.thumbnail ? { ...image.thumbnail, base64: '' } : null })) }
}
export function validateBackup(value: unknown, today = localToday()): { backup: BackupV1; mediaBytes: number; metadataBytes: number } {
  inspectStructure(value)
  const v = exact(value, ['format', 'formatVersion', 'exportedAt', 'recipes', 'images', 'mealDecisions', 'cookingLogs'], 'ファイル')
  if (v.format !== 'sano-gohan-backup') fail('format', '佐野家のごはんのバックアップではありません。')
  if (typeof v.formatVersion === 'number' && v.formatVersion > 1) fail('formatVersion', '新しいアプリが必要です。この版では復元できません。')
  if (v.formatVersion !== 1 || !isInstant(v.exportedAt)) fail('ファイル', '形式版または生成日時が不正です。')
  const recipes = array(v.recipes, backupLimits.recipes, 'recipes').map((row, i) => {
    const path = `recipes[${i}]`
    const recipe = exact(row, ['id', 'title', 'category', 'ingredients', 'servings', 'steps', 'cookingMinutes', 'memo', 'tags', 'sourceUrl', 'isFavorite', 'imageIds', 'coverImageId', 'createdAt', 'updatedAt', 'revision'], path)
    array(recipe.ingredients, 100, `${path}.ingredients`).forEach((item, j) => exact(item, ['name', 'amount'], `${path}.ingredients[${j}]`))
    array(recipe.steps, 100, `${path}.steps`); array(recipe.tags, 20, `${path}.tags`)
    const bound = (value: unknown, max: number) => { if (typeof value === 'string' && value.length > max * 2) fail(path, '文字数の上限を超えます。') }
    for (const [key, max] of [['title', 100], ['memo', 5000], ['sourceUrl', 2048]] as const) bound(recipe[key], max)
    for (const item of recipe.ingredients as Record<string, unknown>[]) { bound(item.name, 100); bound(item.amount, 100) }
    for (const item of recipe.steps as unknown[]) bound(item, 2000)
    for (const item of recipe.tags as unknown[]) bound(item, 30)
    try { return validateRecipe(recipe) } catch { return fail(path, '入力制約・URL・日時・IDを確認してください。') }
  })
  const images = array(v.images, backupLimits.images, 'images').map((row, i): BackupImage => {
    const path = `images[${i}]`
    const image = exact(row, ['id', 'recipeId', 'kind', 'createdAt', 'original', 'thumbnail'], path)
    if (!isId(image.id) || !isId(image.recipeId) || !isInstant(image.createdAt) || !['dish', 'screenshot'].includes(image.kind as string)) return fail(path)
    const original = validateBinary(image.original, `${path}.original`, 1024 ** 2, image.kind === 'dish' ? 1600 : 2560)
    const thumbnail = image.thumbnail === null ? null : validateBinary(image.thumbnail, `${path}.thumbnail`, 100 * 1024, 320)
    if (image.kind === 'dish' ? original.mime !== 'image/jpeg' || thumbnail?.mime !== 'image/jpeg' : !['image/png', 'image/webp'].includes(original.mime) || thumbnail !== null) return fail(path, '写真種別と本体・サムネイルの形式が一致しません。')
    return { id: image.id, recipeId: image.recipeId, kind: image.kind as ImageAsset['kind'], createdAt: image.createdAt, original, thumbnail }
  })
  const mealDecisions = array(v.mealDecisions, backupLimits.histories, 'mealDecisions').map((row, i): MealDecision => {
    const path = `mealDecisions[${i}]`
    const d = exact(row, ['id', 'recipeId', 'recipeTitleSnapshot', 'categorySnapshot', 'decidedAt'], path)
    if (!isId(d.id) || !isId(d.recipeId) || !isInstant(d.decidedAt) || !text(d.recipeTitleSnapshot, 100, true) || typeof d.categorySnapshot !== 'string' || !Object.hasOwn(categories, d.categorySnapshot)) return fail(path)
    return { id: d.id, recipeId: d.recipeId, recipeTitleSnapshot: d.recipeTitleSnapshot as string, categorySnapshot: d.categorySnapshot as MealDecision['categorySnapshot'], decidedAt: d.decidedAt }
  })
  const cookingLogs = array(v.cookingLogs, backupLimits.histories, 'cookingLogs').map((row, i): CookingLog => {
    const path = `cookingLogs[${i}]`
    const log = exact(row, ['id', 'recipeId', 'decisionId', 'cookedOn', 'memo', 'createdAt', 'updatedAt', 'revision'], path)
    if (!isId(log.id) || !isId(log.recipeId) || !(log.decisionId === null || isId(log.decisionId)) || !isLocalDate(log.cookedOn, today) || !text(log.memo, 1000) || !isInstant(log.createdAt) || !isInstant(log.updatedAt) || log.updatedAt < log.createdAt || !integer(log.revision)) return fail(path, 'ID・実在する調理日（1900年〜今日）・日時・文字数を確認してください。端末の日付設定も確認してください。')
    return { id: log.id, recipeId: log.recipeId, decisionId: log.decisionId, cookedOn: log.cookedOn, memo: log.memo as string, createdAt: log.createdAt, updatedAt: log.updatedAt, revision: log.revision as number }
  })
  const recipeMap = unique(recipes, 'recipes'); const imageMap = unique(images, 'images'); const decisionMap = unique(mealDecisions, 'mealDecisions'); unique(cookingLogs, 'cookingLogs')
  recipes.forEach((recipe, i) => {
    if (recipe.imageIds.some(id => imageMap.get(id)?.recipeId !== recipe.id)) fail(`recipes[${i}].imageIds`, '参照する写真が存在しないか、所有者が異なります。')
    const dishes = recipe.imageIds.filter(id => imageMap.get(id)?.kind === 'dish')
    if (dishes.length ? !dishes.includes(recipe.coverImageId ?? '') : recipe.coverImageId !== null) fail(`recipes[${i}].coverImageId`, '表紙には同じ料理の写真が必要です。')
  })
  images.forEach((image, i) => { if (!recipeMap.get(image.recipeId)?.imageIds.includes(image.id)) fail(`images[${i}]`, '孤児画像または不正な所有者です。') })
  mealDecisions.forEach((d, i) => { if (!recipeMap.has(d.recipeId)) fail(`mealDecisions[${i}].recipeId`, 'レシピが存在しません。') })
  const linked = new Set<string>()
  cookingLogs.forEach((log, i) => {
    if (!recipeMap.has(log.recipeId) || (log.decisionId !== null && (decisionMap.get(log.decisionId)?.recipeId !== log.recipeId || linked.has(log.decisionId)))) fail(`cookingLogs[${i}]`, '履歴の参照が不正、または決定への紐付けが重複しています。')
    if (log.decisionId !== null) linked.add(log.decisionId)
  })
  const backup: BackupV1 = { format: 'sano-gohan-backup', formatVersion: 1, exportedAt: v.exportedAt as string, recipes, images, mealDecisions, cookingLogs }
  const mediaBytes = images.reduce((sum, image) => sum + image.original.byteLength + (image.thumbnail?.byteLength ?? 0), 0)
  const metadataBytes = new TextEncoder().encode(JSON.stringify(metadataOf(backup))).length
  const encodedBytes = images.reduce((sum, image) => sum + image.original.base64.length + (image.thumbnail?.base64.length ?? 0), 0)
  if (mediaBytes > backupLimits.mediaBytes || metadataBytes > backupLimits.metadataBytes || metadataBytes + encodedBytes > backupLimits.fileBytes) fail('ファイル', '画像40MiB・非画像8MiB・JSON64MiBの上限を超えます。')
  return { backup, mediaBytes, metadataBytes }
}

export function backupReminderDue(meta: Meta, recipeCount: number, now = Date.now()) {
  return recipeCount > 0 && (meta.lastExportRequestedAt === null || (meta.lastExportRevision !== meta.dataRevision && now - Date.parse(meta.lastExportRequestedAt) >= 7 * 86400000))
}
