import { describe, expect, it } from 'vitest'
import { emptyDraft } from '../../src/domain/types'
import { validateDraft, validateRecipe, ValidationError } from '../../src/domain/validation'

const valid = () => ({ ...emptyDraft(), title: 'テストの煮物' })
describe('T01/T02 入力契約', () => {
  it('料理名だけを登録でき、空行・改行・タグ表記を正規化する', () => {
    expect(validateDraft({ ...valid(), title: '  料理😀  ', memo: ' あ\r\nい\rう ',
      ingredients: [{ name: ' ', amount: '' }, { name: ' 人参 ', amount: ' 適量 ' }],
      steps: [' ', ' 切る\r\n煮る '], tags: ['ＡＢＣ', 'abc', 'お弁当'] })).toEqual({
      ...valid(), title: '料理😀', memo: 'あ\nい\nう', ingredients: [{ name: '人参', amount: '適量' }],
      steps: ['切る\n煮る'], tags: ['ＡＢＣ', 'お弁当'],
    })
  })
  it.each(['', '  ', '\n'])('空白料理名を拒否する: %j', title => expect(() => validateDraft({ ...valid(), title })).toThrow(ValidationError))
  it('文字数をUTF-16単位ではなくコードポイントで数える', () => {
    expect(validateDraft({ ...valid(), title: '😀'.repeat(100) }).title).toHaveLength(200)
    expect(() => validateDraft({ ...valid(), title: '😀'.repeat(101) })).toThrow(ValidationError)
  })
  it.each([
    ['memo', 5000], ['title', 100],
  ])('%sの上限と超過', (field, max) => {
    expect(() => validateDraft({ ...valid(), [field]: 'あ'.repeat(Number(max)) })).not.toThrow()
    expect(() => validateDraft({ ...valid(), [field]: 'あ'.repeat(Number(max) + 1) })).toThrow(ValidationError)
  })
  it('材料・手順・タグの件数と文字数の上限を検査する', () => {
    const ingredients = Array.from({ length: 100 }, () => ({ name: 'あ'.repeat(100), amount: 'い'.repeat(100) }))
    const steps = Array.from({ length: 100 }, () => 'う'.repeat(2000))
    const tags = Array.from({ length: 20 }, (_, i) => `${i}`.padEnd(30, 'え'))
    expect(() => validateDraft({ ...valid(), ingredients, steps, tags })).not.toThrow()
    for (const extra of [
      { ingredients: [...ingredients, { name: '追加', amount: '' }] }, { steps: [...steps, '追加'] }, { tags: [...tags, '追加'] },
      { ingredients: [{ name: 'あ'.repeat(101), amount: '' }] }, { ingredients: [{ name: 'あ', amount: 'い'.repeat(101) }] },
      { ingredients: [{ name: '', amount: '大さじ1' }] }, { steps: ['う'.repeat(2001)] }, { tags: ['え'.repeat(31)] },
    ]) expect(() => validateDraft({ ...valid(), ...extra })).toThrow(ValidationError)
  })
  it.each(['servings', 'cookingMinutes'])('%sは整数または未指定のみ', field => {
    const max = field === 'servings' ? 100 : 1440
    for (const value of [null, 1, max]) expect(() => validateDraft({ ...valid(), [field]: value })).not.toThrow()
    for (const value of [0, -1, 1.5, max + 1, NaN, Infinity, '1', undefined]) expect(() => validateDraft({ ...valid(), [field]: value })).toThrow(ValidationError)
  })
  it.each([null, {}, { ...valid(), category: 'unknown' }, { ...valid(), steps: [1] }, { ...valid(), tags: [''] }, { ...valid(), ingredients: [null] }])('型の不正を拒否する: %j', input => expect(() => validateDraft(input)).toThrow(ValidationError))
})
describe('T24 元URLと保存境界', () => {
  it.each(['https://example.com/料理?a=1&b=2#memo', 'http://example.com', '', null])('有効URL: %j', sourceUrl => expect(() => validateDraft({ ...valid(), sourceUrl })).not.toThrow())
  it.each(['javascript:alert(1)', 'data:text/html,test', 'file:///tmp/test', '//example.com', 'example.com', 'https://user:pass@example.com', 'http://user@example.com', 'https://example.com/\npath', 'https://example.com/\u0000path', 'https:/example.com'])('不正URL: %j', sourceUrl => expect(() => validateDraft({ ...valid(), sourceUrl })).toThrow(ValidationError))
  it('URL 2048文字を許可し2049文字を拒否する', () => {
    const url = 'https://example.com/'.padEnd(2048, 'a')
    expect(validateDraft({ ...valid(), sourceUrl: url }).sourceUrl).toBe(url)
    expect(() => validateDraft({ ...valid(), sourceUrl: url + 'a' })).toThrow(ValidationError)
  })
  it('DBの不正値を読み込んでも補完や削除をしない', () => {
    const recipe = { ...valid(), id: crypto.randomUUID(), isFavorite: false, imageIds: [], coverImageId: null,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', revision: 1 }
    expect(validateRecipe(recipe)).toEqual(recipe)
    for (const invalid of [{ revision: 0 }, { id: 'invalid' }, { updatedAt: '2025-01-01T00:00:00.000Z' }, { title: ' 前後空白 ' }, { imageIds: [crypto.randomUUID()], coverImageId: crypto.randomUUID() }]) {
      expect(() => validateRecipe({ ...recipe, ...invalid })).toThrow()
    }
  })
})
