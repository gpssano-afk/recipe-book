import { categories, type Recipe, type RecipeDraft } from './types'

export type FieldErrors = Record<string, string>
export class ValidationError extends Error {
  constructor(public readonly fields: FieldErrors) { super('入力内容を確認してください。') }
}
export const normalizeText = (value: string) => value.replace(/\r\n?/g, '\n').trim()
export const normalizeSearch = (value: string) => normalizeText(value).normalize('NFKC').toLowerCase()
export const codePoints = (value: string) => [...value].length
export const isId = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
export const isInstant = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false
  const date = new Date(value)
  return Number.isFinite(date.getTime()) && date.toISOString() === value
}
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

export function validateDraft(input: unknown): RecipeDraft {
  if (!record(input)) throw new ValidationError({ title: '入力形式が正しくありません。' })
  const errors: FieldErrors = {}
  function text(value: unknown, field: string, max: number, required = false): string {
    if (typeof value !== 'string') { errors[field] = '文字列を入力してください。'; return '' }
    const normalized = normalizeText(value)
    if (required && !normalized) errors[field] = '入力してください。'
    if (codePoints(normalized) > max) errors[field] = `${max}文字以内で入力してください。`
    return normalized
  }
  function number(value: unknown, field: string, max: number): number | null {
    if (value === null) return null
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > max) {
      errors[field] = `1〜${max}の整数を入力してください。`; return null
    }
    return value
  }
  const title = text(input.title, 'title', 100, true)
  const category = typeof input.category === 'string' && Object.hasOwn(categories, input.category) ? input.category as RecipeDraft['category'] : 'other'
  if (category !== input.category) errors.category = 'カテゴリを選択してください。'
  const ingredients: RecipeDraft['ingredients'] = []
  if (!Array.isArray(input.ingredients)) errors.ingredients = '材料の形式が正しくありません。'
  else input.ingredients.forEach((row: unknown, i: number) => {
    if (!record(row)) { errors[`ingredients.${i}.name`] = '材料の形式が正しくありません。'; return }
    const name = text(row.name, `ingredients.${i}.name`, 100)
    const amount = text(row.amount, `ingredients.${i}.amount`, 100)
    if (amount && !name) errors[`ingredients.${i}.name`] = '分量を入力した行には材料名が必要です。'
    if (name || amount) ingredients.push({ name, amount })
  })
  if (ingredients.length > 100) errors.ingredients = '材料は100行までです。'
  const steps: string[] = []
  if (!Array.isArray(input.steps)) errors.steps = '手順の形式が正しくありません。'
  else input.steps.forEach((row: unknown, i: number) => {
    const step = text(row, `steps.${i}`, 2000)
    if (step) steps.push(step)
  })
  if (steps.length > 100) errors.steps = '手順は100件までです。'
  const tags: string[] = []
  const seen = new Set<string>()
  if (!Array.isArray(input.tags)) errors.tags = 'タグの形式が正しくありません。'
  else input.tags.forEach((row: unknown) => {
    const tag = text(row, 'tags', 30, true)
    const key = normalizeSearch(tag)
    if (tag && !seen.has(key)) { seen.add(key); tags.push(tag) }
  })
  if (tags.length > 20) errors.tags = 'タグは20個までです。'
  let sourceUrl: string | null = null
  if (input.sourceUrl !== null) {
    const raw = input.sourceUrl
    const url = text(raw, 'sourceUrl', 2048)
    if (typeof raw === 'string' && [...raw].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) errors.sourceUrl = 'URLに制御文字は使えません。'
    if (url) {
      try {
        const parsed = new URL(url)
        if (!/^https?:\/\//i.test(url) || !['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error()
        sourceUrl = url
      } catch { errors.sourceUrl = 'ユーザー情報を含まないhttp:// またはhttps:// のURLを入力してください。' }
    }
  }
  const result: RecipeDraft = {
    title, category, ingredients, steps, tags, sourceUrl,
    servings: number(input.servings, 'servings', 100),
    cookingMinutes: number(input.cookingMinutes, 'cookingMinutes', 1440),
    memo: text(input.memo, 'memo', 5000),
  }
  if (Object.keys(errors).length) throw new ValidationError(errors)
  return result
}

export function validateRecipe(input: unknown): Recipe {
  if (!record(input)) throw new Error('保存データの形式が正しくありません。')
  const draft = validateDraft(input)
  for (const key of Object.keys(draft) as (keyof RecipeDraft)[]) {
    if (JSON.stringify(draft[key]) !== JSON.stringify(input[key])) throw new Error('保存データの値が正しくありません。')
  }
  if (!isId(input.id) || !isInstant(input.createdAt) || !isInstant(input.updatedAt) || input.updatedAt < input.createdAt ||
    typeof input.revision !== 'number' || !Number.isSafeInteger(input.revision) || input.revision < 1 ||
    typeof input.isFavorite !== 'boolean' || !Array.isArray(input.imageIds) || input.imageIds.length > 6 ||
    !input.imageIds.every(isId) || new Set(input.imageIds).size !== input.imageIds.length ||
    !(input.coverImageId === null || (isId(input.coverImageId) && input.imageIds.includes(input.coverImageId)))) {
    throw new Error('保存データの形式が正しくありません。')
  }
  return { ...draft, id: input.id, createdAt: input.createdAt, updatedAt: input.updatedAt,
    revision: input.revision, isFavorite: input.isFavorite, imageIds: input.imageIds as string[], coverImageId: input.coverImageId as string | null }
}
