export type Id = string
export type Instant = string
export type LocalDate = string
export const categories = {
  main: '主菜', side: '副菜', soup: '汁物', staple: '主食', dessert: 'デザート', other: 'その他',
} as const
export type Category = keyof typeof categories
export interface Ingredient { name: string; amount: string }
export interface RecipeDraft {
  title: string
  category: Category
  ingredients: Ingredient[]
  servings: number | null
  steps: string[]
  cookingMinutes: number | null
  memo: string
  tags: string[]
  sourceUrl: string | null
}
export interface Recipe extends RecipeDraft {
  id: Id
  isFavorite: boolean
  imageIds: Id[]
  coverImageId: Id | null
  createdAt: Instant
  updatedAt: Instant
  revision: number
}
export interface ImageAsset {
  id: Id
  recipeId: Id
  kind: 'dish' | 'screenshot'
  mime: 'image/jpeg' | 'image/png' | 'image/webp'
  width: number
  height: number
  byteLength: number
  blob: Blob
  thumbnail: { mime: 'image/jpeg'; width: number; height: number; byteLength: number; blob: Blob } | null
  createdAt: Instant
}
export interface MealDecision {
  id: Id; recipeId: Id; recipeTitleSnapshot: string; categorySnapshot: Category; decidedAt: Instant
}
export interface CookingLog {
  id: Id; recipeId: Id; decisionId: Id | null; cookedOn: LocalDate; memo: string
  createdAt: Instant; updatedAt: Instant; revision: number
}
export interface Meta {
  key: 'state'
  dataRevision: number
  lastChangedAt: Instant | null
  lastExportRequestedAt: Instant | null
  lastExportRevision: number | null
  lossNoticeAcknowledged: boolean
  mediaBytes: number
  metadataBytes: number
}
export const emptyDraft = (): RecipeDraft => ({
  title: '', category: 'other', ingredients: [], servings: null, steps: [],
  cookingMinutes: null, memo: '', tags: [], sourceUrl: null,
})
