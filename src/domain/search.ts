import type { Category, Recipe } from './types'
import { codePoints, normalizeSearch } from './validation'

export interface SearchOptions { query: string; category: Category | ''; sort: 'updated' | 'title' }
export function searchRecipes(recipes: Recipe[], options: SearchOptions): Recipe[] {
  if (codePoints(options.query) > 200) throw new Error('検索語は200文字以内で入力してください。')
  const words = normalizeSearch(options.query).split(/\s+/).filter(Boolean)
  const collator = new Intl.Collator('ja')
  return recipes.filter(recipe => {
    const fields = [recipe.title, recipe.memo, ...recipe.ingredients.map(row => row.name), ...recipe.tags].map(normalizeSearch)
    return (!options.category || recipe.category === options.category) && words.every(word => fields.some(field => field.includes(word)))
  }).sort((a, b) => (options.sort === 'title' ? collator.compare(a.title, b.title) : b.updatedAt.localeCompare(a.updatedAt)) || a.id.localeCompare(b.id))
}
