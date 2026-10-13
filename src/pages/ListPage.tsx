import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { initialListSession, useListSession } from '../app/session'
import { ErrorState, Loading, RecipeCard } from '../components/Shared'
import { useSnapshot } from '../hooks/useSnapshot'
import { searchRecipes } from '../domain/search'
import { categories, type Category } from '../domain/types'
import { codePoints, normalizeSearch } from '../domain/validation'

export function ListPage({ favoritesOnly = false }: { favoritesOnly?: boolean }) {
  const { session, setSession } = useListSession(favoritesOnly)
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
  const recipes = useMemo(() => data ? searchRecipes(data.recipes, { ...session, favoritesOnly: favoritesOnly || session.favoritesOnly }) : [], [data, session, favoritesOnly])
  const favoriteCount = data?.recipes.filter(recipe => recipe.isFavorite).length ?? 0
  const tagOptions = useMemo(() => {
    const tags = new Map<string, string>()
    for (const recipe of data?.recipes ?? []) if (!favoritesOnly || recipe.isFavorite) for (const tag of recipe.tags) if (!tags.has(normalizeSearch(tag))) tags.set(normalizeSearch(tag), tag)
    for (const tag of session.tags ?? []) if (!tags.has(normalizeSearch(tag))) tags.set(normalizeSearch(tag), tag)
    return [...tags.values()].sort(new Intl.Collator('ja').compare)
  }, [data, favoritesOnly, session.tags])
  function clear() { setInput(''); setSession(initialListSession) }
  const statusMessage = (location.state as { message?: string } | null)?.message
  return <>
    <div className="page-heading"><div><p className="eyebrow">{favoritesOnly ? 'FAVORITES' : 'RECIPE BOOK'}</p><h1>{favoritesOnly ? '佐野家の定番' : 'レシピ一覧'}</h1></div><Link className="button primary" to="/recipes/new">＋ 新規登録</Link></div>
    <Link className="back-link" to={favoritesOnly ? '/recipes' : '/favorites'}>{favoritesOnly ? 'すべてのレシピへ →' : '佐野家の定番へ →'}</Link>
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
      {!favoritesOnly && <label className="checkbox-label"><input type="checkbox" checked={!!session.favoritesOnly} onChange={event => setSession(old => ({ ...old, favoritesOnly: event.target.checked, visible: 30, scroll: 0 }))} />定番のみ表示</label>}
      {tagOptions.length > 0 && <details className="tag-filters"><summary>タグで絞り込む（複数選択・すべて含む）</summary><div>{tagOptions.map(tag => <label className="checkbox-label" key={normalizeSearch(tag)}><input type="checkbox" checked={(session.tags ?? []).some(item => normalizeSearch(item) === normalizeSearch(tag))} onChange={event => setSession(old => ({ ...old, tags: event.target.checked ? [...(old.tags ?? []), tag] : (old.tags ?? []).filter(item => normalizeSearch(item) !== normalizeSearch(tag)), visible: 30, scroll: 0 }))} />{tag}</label>)}</div></details>}
      {(session.tags?.length || session.favoritesOnly || session.query || session.category) ? <button type="button" onClick={clear}>条件を解除</button> : null}
    </section>
    {loading && !data ? <Loading /> : error ? <ErrorState message={error} retry={retry} /> : data && <>
      <p className="result-count" aria-live="polite">{recipes.length}品 {session.query || session.category ? ` / 全${data.recipes.length}品` : ''}</p>
      {favoritesOnly && favoriteCount === 0 ? <section className="state-panel"><h2>まだ定番がありません</h2><p>気に入った料理に星をつけましょう。</p><Link className="button" to="/recipes">すべてのレシピを見る</Link></section> : data.recipes.length === 0 ? <section className="state-panel"><h2>まだレシピがありません</h2><p>料理名だけでも登録できます。</p><Link className="button primary" to="/recipes/new">レシピを登録</Link></section> :
        recipes.length === 0 ? <section className="state-panel"><h2>条件に合うレシピがありません</h2><p>検索語やカテゴリを変えてみてください。</p></section> :
          <div className="recipe-grid">{recipes.slice(0, session.visible).map(recipe => <RecipeCard key={recipe.id} recipe={recipe} dataRevision={data.meta.dataRevision} />)}</div>}
      {recipes.length > session.visible && <button className="load-more" type="button" onClick={() => setSession(old => ({ ...old, visible: old.visible + 30 }))}>さらに30品を表示</button>}
    </>}
  </>
}
