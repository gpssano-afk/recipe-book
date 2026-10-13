import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useListSession } from '../app/session'
import { ErrorState, Loading, RecipeCard } from '../components/Shared'
import { useSnapshot } from '../hooks/useSnapshot'
import { searchRecipes } from '../domain/search'
import { categories, type Category } from '../domain/types'
import { codePoints } from '../domain/validation'

export function ListPage() {
  const { session, setSession } = useListSession()
  const { data, loading, error, retry } = useSnapshot()
  const location = useLocation()
  const [input, setInput] = useState(session.query)
  const [composing, setComposing] = useState(false)
  const scroll = useRef(session.scroll)
  const restored = useRef(false)
  const queryError = codePoints(input) > 200
  useEffect(() => {
    if (composing || queryError) return
    const timeout = window.setTimeout(() => setSession(old => old.query === input ? old : { ...old, query: input, visible: 30, scroll: 0 }), 200)
    return () => window.clearTimeout(timeout)
  }, [composing, input, queryError, setSession])
  useEffect(() => {
    const listener = () => { scroll.current = window.scrollY }
    window.addEventListener('scroll', listener)
    return () => { window.removeEventListener('scroll', listener); setSession(old => ({ ...old, scroll: scroll.current })) }
  }, [setSession])
  useEffect(() => {
    if (!loading && data && !restored.current) {
      restored.current = true
      const frame = requestAnimationFrame(() => window.scrollTo(0, scroll.current))
      return () => cancelAnimationFrame(frame)
    }
  }, [data, loading])
  const recipes = useMemo(() => data ? searchRecipes(data.recipes, session) : [], [data, session])
  function clear() { setInput(''); setSession({ query: '', category: '', sort: 'updated', visible: 30, scroll: 0 }) }
  const statusMessage = (location.state as { message?: string } | null)?.message
  return <>
    <div className="page-heading"><div><p className="eyebrow">RECIPE BOOK</p><h1>レシピ一覧</h1></div><Link className="button primary" to="/recipes/new">＋ 新規登録</Link></div>
    {statusMessage && <p className="success" role="status">{statusMessage}</p>}
    <section className="filters" aria-label="レシピを絞り込む">
      <label htmlFor="search">レシピを検索</label><input id="search" type="search" value={input} placeholder="料理名、材料、タグ、メモ" aria-invalid={queryError}
        onChange={event => setInput(event.target.value)} onCompositionStart={() => setComposing(true)} onCompositionEnd={event => { setComposing(false); setInput(event.currentTarget.value) }} />
      {queryError && <p className="field-error" role="alert">検索語は200文字以内で入力してください。</p>}
      <div className="filter-row"><div><label htmlFor="filter-category">カテゴリ</label><select id="filter-category" value={session.category}
        onChange={event => setSession(old => ({ ...old, category: event.target.value as Category | '', visible: 30, scroll: 0 }))}>
        <option value="">すべて</option>{Object.entries(categories).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></div><div><label htmlFor="sort">並び替え</label><select id="sort" value={session.sort}
        onChange={event => setSession(old => ({ ...old, sort: event.target.value as 'updated' | 'title', visible: 30, scroll: 0 }))}>
        <option value="updated">更新が新しい</option><option value="title">料理名</option>
      </select></div></div>
    </section>
    {loading ? <Loading /> : error ? <ErrorState message={error} retry={retry} /> : data && <>
      <p className="result-count" aria-live="polite">{recipes.length}品 {session.query || session.category ? ` / 全${data.recipes.length}品` : ''}</p>
      {data.recipes.length === 0 ? <section className="state-panel"><h2>まだレシピがありません</h2><p>料理名だけでも登録できます。</p><Link className="button primary" to="/recipes/new">レシピを登録</Link></section> :
        recipes.length === 0 ? <section className="state-panel"><h2>条件に合うレシピがありません</h2><p>検索語やカテゴリを変えてみてください。</p><button type="button" onClick={clear}>条件を解除</button></section> :
          <div className="recipe-grid">{recipes.slice(0, session.visible).map(recipe => <RecipeCard key={recipe.id} recipe={recipe} />)}</div>}
      {recipes.length > session.visible && <button className="load-more" type="button" onClick={() => setSession(old => ({ ...old, visible: old.visible + 30 }))}>さらに30品を表示</button>}
    </>}
  </>
}
