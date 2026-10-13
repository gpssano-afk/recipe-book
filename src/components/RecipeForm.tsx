import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { useBeforeUnload, useBlocker, useNavigate } from 'react-router-dom'
import { DataError } from '../data/errors'
import { readRecipe, readSnapshot, saveRecipe } from '../data/recipes'
import { categories, emptyDraft, type Category, type Recipe, type RecipeDraft } from '../domain/types'
import { validateDraft, ValidationError, type FieldErrors } from '../domain/validation'
import { ConfirmDialog } from './ConfirmDialog'

interface IngredientRow { key: string; name: string; amount: string }
interface StepRow { key: string; text: string }
interface FormValues { title: string; category: Category; servings: string; cookingMinutes: string; memo: string; tags: string; sourceUrl: string; ingredients: IngredientRow[]; steps: StepRow[] }
const rowKey = () => crypto.randomUUID()
function valuesOf(draft: RecipeDraft): FormValues {
  return { ...draft, servings: draft.servings?.toString() ?? '', cookingMinutes: draft.cookingMinutes?.toString() ?? '',
    sourceUrl: draft.sourceUrl ?? '', tags: draft.tags.join('\n'),
    ingredients: (draft.ingredients.length ? draft.ingredients : [{ name: '', amount: '' }]).map(row => ({ ...row, key: rowKey() })),
    steps: (draft.steps.length ? draft.steps : ['']).map(text => ({ text, key: rowKey() })),
  }
}
const optionalNumber = (value: string) => value.trim() === '' ? null : /^\d+$/.test(value.trim()) ? Number(value) : NaN
function draftOf(values: FormValues): RecipeDraft {
  return { ...values, servings: optionalNumber(values.servings), cookingMinutes: optionalNumber(values.cookingMinutes),
    sourceUrl: values.sourceUrl || null, tags: values.tags.replace(/\r\n?/g, '\n').split('\n').map(tag => tag.trim()).filter(Boolean),
    ingredients: values.ingredients.map(({ name, amount }) => ({ name, amount })), steps: values.steps.map(row => row.text),
  }
}
function move<T>(rows: T[], index: number, direction: number): T[] {
  const result = [...rows]
  const target = index + direction
  if (result[index] !== undefined && result[target] !== undefined) [result[index], result[target]] = [result[target]!, result[index]!]
  return result
}
export function RecipeForm({ initialRecipe, initialDataRevision, dataRevision, readError, deleted }: { initialRecipe?: Recipe; initialDataRevision: number; dataRevision: number; readError: string | null; deleted: boolean }) {
  const [values, setValues] = useState(() => valuesOf(initialRecipe ?? emptyDraft()))
  const [baseline, setBaseline] = useState(() => JSON.stringify(values))
  const [expected, setExpected] = useState({ revision: initialRecipe?.revision ?? null, dataRevision: initialDataRevision })
  const operationId = useRef(initialRecipe?.id ?? crypto.randomUUID())
  const [errors, setErrors] = useState<FieldErrors>({})
  const [saveError, setSaveError] = useState('')
  const [busy, setBusy] = useState(false)
  const saving = useRef(false)
  const [savedId, setSavedId] = useState<string | null>(null)
  const [reloadOpen, setReloadOpen] = useState(false)
  const [missing, setMissing] = useState(false)
  const form = useRef<HTMLFormElement>(null)
  const navigate = useNavigate()
  const dirty = JSON.stringify(values) !== baseline
  const blocker = useBlocker(!savedId && (dirty || busy))
  const changedElsewhere = dataRevision !== expected.dataRevision && !savedId
  useBeforeUnload(useCallback(event => {
    if ((dirty || busy) && !savedId) { event.preventDefault(); event.returnValue = '' }
  }, [dirty, busy, savedId]))
  useEffect(() => {
    if (savedId) navigate(`/recipes/${savedId}`, { replace: true, state: { message: 'レシピを保存しました。' } })
  }, [savedId, navigate])
  useEffect(() => {
    const viewport = window.visualViewport
    const update = () => {
      document.documentElement.style.setProperty('--keyboard-offset', `${Math.max(0, window.innerHeight - (viewport?.height ?? window.innerHeight) - (viewport?.offsetTop ?? 0))}px`)
      if (document.activeElement instanceof HTMLElement && document.activeElement.matches('input, textarea, select')) document.activeElement.scrollIntoView({ block: 'center', behavior: 'instant' })
    }
    viewport?.addEventListener('resize', update); viewport?.addEventListener('scroll', update); update()
    return () => { viewport?.removeEventListener('resize', update); viewport?.removeEventListener('scroll', update); document.documentElement.style.removeProperty('--keyboard-offset') }
  }, [])
  function update<K extends keyof FormValues>(key: K, value: FormValues[K]) { setValues(old => ({ ...old, [key]: value })) }
  const errorProps = (field: string) => ({ 'aria-invalid': !!errors[field], 'aria-describedby': errors[field] ? `error-${field}` : undefined, 'data-field': field })
  const errorFor = (field: string) => errors[field] ? <p id={`error-${field}`} className="field-error">{errors[field]}</p> : null
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (saving.current || missing || deleted) return
    setSaveError(''); setErrors({})
    let draft: RecipeDraft
    try { draft = validateDraft(draftOf(values)) }
    catch (error) {
      if (error instanceof ValidationError) {
        setErrors(error.fields)
        requestAnimationFrame(() => {
          const field = Object.keys(error.fields)[0]
          const control = [...(form.current?.querySelectorAll<HTMLElement>('[data-field]') ?? [])].find(element => element.dataset.field === field)
          control?.focus(); control?.scrollIntoView({ block: 'center', behavior: 'instant' })
        })
      }
      return
    }
    saving.current = true; setBusy(true)
    try {
      const recipe = await saveRecipe(draft, { id: operationId.current, expectedRevision: expected.revision, expectedDataRevision: expected.dataRevision })
      setSavedId(recipe.id)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : '保存できませんでした。')
      if (error instanceof DataError && error.kind === 'missing') setMissing(true)
    } finally { saving.current = false; setBusy(false) }
  }
  async function reload() {
    setBusy(true); setSaveError('')
    try {
      const result = initialRecipe ? await readRecipe(operationId.current) : await readSnapshot()
      const recipe = 'recipe' in result ? result.recipe : undefined
      const next = valuesOf(recipe ?? emptyDraft())
      setValues(next); setBaseline(JSON.stringify(next)); setExpected({ revision: recipe?.revision ?? null, dataRevision: result.meta.dataRevision })
      setErrors({}); setMissing(false); setReloadOpen(false)
    } catch (error) { setSaveError(error instanceof Error ? error.message : '読み込めませんでした。') }
    finally { setBusy(false) }
  }
  return <>
    <p className="eyebrow">{initialRecipe ? 'EDIT RECIPE' : 'NEW RECIPE'}</p><h1>{initialRecipe ? 'レシピを編集' : 'レシピを登録'}</h1>
    <p className="form-intro">料理名だけでも保存できます。<br />材料や手順は、あとから追加できます。</p>
    <p className="help">写真・お気に入りはPhase 1Bで対応します。</p>
    {(readError || saveError) && <div className="error" role="alert"><strong>{saveError ? '保存できませんでした。入力はこの画面に残っています。' : 'データを読み込めません。入力はこの画面に残っています。'}</strong><p>{saveError || readError}</p></div>}
    {changedElsewhere && <p className="notice" role="status">別の画面でデータが更新されました。最新データを確認してから再編集してください。</p>}
    {(changedElsewhere || saveError) && <button type="button" disabled={busy} onClick={() => setReloadOpen(true)}>最新データを読み直す</button>}
    {(missing || deleted) && <p className="error">このレシピは削除されました。必要な入力をコピーしてからキャンセルしてください。</p>}
    {Object.keys(errors).length > 0 && <p className="error" role="alert">入力内容に{Object.keys(errors).length}件のエラーがあります。各項目を確認してください。</p>}
    <form ref={form} id="recipe-form" onSubmit={event => { void submit(event) }}
      onFocusCapture={event => { if (event.target.matches('input, textarea, select')) event.target.scrollIntoView({ block: 'center', behavior: 'instant' }) }} noValidate>
      <fieldset disabled={busy}><legend className="sr-only">レシピ情報</legend>
        <section className="form-section"><h2>基本情報</h2>
          <label htmlFor="title">料理名 <span className="required">必須</span></label><input id="title" value={values.title} {...errorProps('title')} onChange={event => update('title', event.target.value)} placeholder="例：わが家の肉じゃが" />{errorFor('title')}<p className="help">100文字以内</p>
          <label htmlFor="category">カテゴリ <span className="required">必須</span></label><select id="category" value={values.category} {...errorProps('category')} onChange={event => update('category', event.target.value as Category)}>
            {Object.entries(categories).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>{errorFor('category')}
          <div className="filter-row"><div><label htmlFor="servings">人数（人分）</label><input id="servings" inputMode="numeric" value={values.servings} {...errorProps('servings')} onChange={event => update('servings', event.target.value)} />{errorFor('servings')}<p className="help">任意・1〜100人</p></div>
            <div><label htmlFor="cookingMinutes">調理時間（分）</label><input id="cookingMinutes" inputMode="numeric" value={values.cookingMinutes} {...errorProps('cookingMinutes')} onChange={event => update('cookingMinutes', event.target.value)} />{errorFor('cookingMinutes')}<p className="help">任意・1〜1,440分</p></div></div>
        </section>
        <section className="form-section"><h2>材料・分量</h2><p className="help">各100文字以内・100行まで。空の行は保存時に除きます。</p>{errorFor('ingredients')}
          {values.ingredients.map((row, i) => <div className="form-row" key={row.key}><p className="row-heading">材料 {i + 1}</p><div className="ingredient-inputs">
            <div><label htmlFor={`ingredient-${row.key}`}>材料名 {i + 1}</label><input id={`ingredient-${row.key}`} {...errorProps(`ingredients.${i}.name`)} value={row.name} onChange={event => update('ingredients', values.ingredients.map(item => item.key === row.key ? { ...item, name: event.target.value } : item))} />{errorFor(`ingredients.${i}.name`)}</div>
            <div><label htmlFor={`amount-${row.key}`}>分量 {i + 1}</label><input id={`amount-${row.key}`} {...errorProps(`ingredients.${i}.amount`)} value={row.amount} onChange={event => update('ingredients', values.ingredients.map(item => item.key === row.key ? { ...item, amount: event.target.value } : item))} placeholder="適量、大さじ1など" />{errorFor(`ingredients.${i}.amount`)}</div></div>
            <div className="row-actions"><button type="button" aria-label={`材料${i + 1}を上へ`} disabled={i === 0} onClick={() => update('ingredients', move(values.ingredients, i, -1))}>↑ 上へ</button><button type="button" aria-label={`材料${i + 1}を下へ`} disabled={i === values.ingredients.length - 1} onClick={() => update('ingredients', move(values.ingredients, i, 1))}>↓ 下へ</button><button type="button" aria-label={`材料${i + 1}を削除`} onClick={() => update('ingredients', values.ingredients.filter(item => item.key !== row.key))}>削除</button></div>
          </div>)}<button type="button" className="add-row" disabled={values.ingredients.length >= 100} onClick={() => update('ingredients', [...values.ingredients, { key: rowKey(), name: '', amount: '' }])}>＋ 材料を追加</button>
        </section>
        <section className="form-section"><h2>調理手順</h2><p className="help">1件2,000文字以内・100件まで。</p>{errorFor('steps')}
          {values.steps.map((row, i) => <div className="form-row" key={row.key}><label htmlFor={`step-${row.key}`}>手順 {i + 1}</label><textarea id={`step-${row.key}`} rows={4} value={row.text} {...errorProps(`steps.${i}`)} onChange={event => update('steps', values.steps.map(item => item.key === row.key ? { ...item, text: event.target.value } : item))} />{errorFor(`steps.${i}`)}
            <div className="row-actions"><button type="button" aria-label={`手順${i + 1}を上へ`} disabled={i === 0} onClick={() => update('steps', move(values.steps, i, -1))}>↑ 上へ</button><button type="button" aria-label={`手順${i + 1}を下へ`} disabled={i === values.steps.length - 1} onClick={() => update('steps', move(values.steps, i, 1))}>↓ 下へ</button><button type="button" aria-label={`手順${i + 1}を削除`} onClick={() => update('steps', values.steps.filter(item => item.key !== row.key))}>削除</button></div>
          </div>)}<button type="button" className="add-row" disabled={values.steps.length >= 100} onClick={() => update('steps', [...values.steps, { key: rowKey(), text: '' }])}>＋ 手順を追加</button>
        </section>
        <section className="form-section"><h2>メモ・タグ・出典</h2><label htmlFor="memo">メモ</label><textarea id="memo" rows={5} value={values.memo} {...errorProps('memo')} onChange={event => update('memo', event.target.value)} />{errorFor('memo')}<p className="help">5,000文字以内</p>
          <label htmlFor="tags">タグ</label><textarea id="tags" rows={3} value={values.tags} {...errorProps('tags')} onChange={event => update('tags', event.target.value)} placeholder={'お弁当\n作り置き'} />{errorFor('tags')}<p className="help">1行に1個・各30文字以内・20個まで。同じタグはまとめます。</p>
          <label htmlFor="sourceUrl">元レシピURL</label><input id="sourceUrl" type="url" inputMode="url" value={values.sourceUrl} {...errorProps('sourceUrl')} onChange={event => update('sourceUrl', event.target.value)} placeholder="https://…" />{errorFor('sourceUrl')}<p className="help">2,048文字以内。URLだけを保存し、本文や写真は取得しません。</p>
        </section>
      </fieldset>
    </form>
    <div className="form-actions"><button type="button" disabled={busy} onClick={() => navigate(initialRecipe && !deleted ? `/recipes/${operationId.current}` : '/recipes')}>キャンセル</button><button type="submit" form="recipe-form" className="primary" disabled={busy || missing || deleted || !!readError}>{busy ? '保存中…' : '保存する'}</button></div>
    <ConfirmDialog open={blocker.state === 'blocked'} title="入力を破棄しますか？" cancelLabel="編集を続ける" confirmLabel="破棄して戻る" dangerous busy={busy}
      onCancel={() => { if (blocker.state === 'blocked') blocker.reset() }} onConfirm={() => { if (!busy && blocker.state === 'blocked') blocker.proceed() }}>
      <p>未保存の変更があります。破棄すると入力した内容は保存されません。</p>
    </ConfirmDialog>
    <ConfirmDialog open={reloadOpen} title="最新データを読み直しますか？" cancelLabel="編集を続ける" confirmLabel="破棄して読み直す" dangerous busy={busy}
      onCancel={() => setReloadOpen(false)} onConfirm={() => { void reload() }}><p>この画面の入力を破棄して、保存済みの内容を読み直します。</p>{saveError && <p className="error" role="alert">{saveError}</p>}</ConfirmDialog>
  </>
}
