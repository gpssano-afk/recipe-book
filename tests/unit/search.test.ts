import { describe, expect, it } from 'vitest'
import { emptyDraft, type Recipe } from '../../src/domain/types'
import { searchRecipes } from '../../src/domain/search'
const recipe = (id: string, title: string, extra: Partial<Recipe> = {}): Recipe => ({
  ...emptyDraft(), id, title, isFavorite: false, imageIds: [], coverImageId: null,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', revision: 1, ...extra,
})
const fixtures = [recipe('b', 'ＡＢＣ煮物', { category: 'main', ingredients: [{ name: '人参', amount: '大さじ1' }], tags: ['弁当'], memo: '冷凍可' }), recipe('a', 'あんかけ', { category: 'side' }), recipe('c', 'ＡＢＣ煮物')]
describe('T05 検索・カテゴリ・並び順', () => {
  it('カテゴリ+複数タグ+お気に入りをANDで絞り、タグはNFKC完全一致', () => {
    const recipes = [recipe('a', '料理', { category: 'main', tags: ['ＡＢＣ', '弁当'], isFavorite: true }), recipe('b', '料理', { category: 'main', tags: ['abc'], isFavorite: true }), recipe('c', '料理', { category: 'side', tags: ['abc', '弁当'], isFavorite: true })]
    expect(searchRecipes(recipes, { query: '', category: 'main', sort: 'updated', tags: ['abc', '弁当'], favoritesOnly: true }).map(item => item.id)).toEqual(['a'])
    expect(searchRecipes(recipes, { query: '', category: '', sort: 'updated', tags: ['ab'] })).toEqual([])
  })
  it('全半角/大小文字、複数語のANDとカテゴリを検査する', () => {
    expect(searchRecipes(fixtures, { query: 'abc 人参 弁当 冷凍', category: 'main', sort: 'updated' }).map(item => item.id)).toEqual(['b'])
    expect(searchRecipes(fixtures, { query: '人参', category: 'side', sort: 'updated' })).toEqual([])
    expect(searchRecipes(fixtures, { query: '大さじ', category: '', sort: 'updated' })).toEqual([])
  })
  it('空欄は全件、同時刻・同名の順序はID順で固定する', () => {
    expect(searchRecipes(fixtures, { query: ' ', category: '', sort: 'updated' }).map(item => item.id)).toEqual(['a', 'b', 'c'])
    expect(searchRecipes(fixtures, { query: '', category: '', sort: 'title' }).map(item => item.id)).toEqual(['b', 'c', 'a'])
  })
  it('検索上限を超える入力を拒否する', () => {
    expect(() => searchRecipes([], { query: 'a'.repeat(200), category: '', sort: 'updated' })).not.toThrow()
    expect(() => searchRecipes([], { query: 'a'.repeat(201), category: '', sort: 'updated' })).toThrow()
  })
})
