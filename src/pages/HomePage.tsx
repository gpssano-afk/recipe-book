import { Link } from 'react-router-dom'
import { DevelopmentNotice, ErrorState, Loading, RecipeCard } from '../components/Shared'
import { useSnapshot } from '../hooks/useSnapshot'
import { searchRecipes } from '../domain/search'

export function HomePage() {
  const { data, loading, error, retry } = useSnapshot()
  return <>
    <section className="hero"><p className="eyebrow">わが家の味を、ひとつずつ。</p><h1>今日のごはんを<br />わが家のレシピから。</h1>
      <p>いつもの料理も、新しく試した一品も。<br />家族のレシピブックを育てましょう。</p>
      <Link className="button primary" to="/recipes/new">＋ レシピを追加</Link>
    </section>
    {loading && !data ? <Loading /> : error ? <ErrorState message={error} retry={retry} /> : data && <><section>
      <div className="section-heading"><h2>佐野家の定番</h2><Link to="/favorites">すべて →</Link></div>
      {data.recipes.some(recipe => recipe.isFavorite) ? <div className="recipe-grid">{searchRecipes(data.recipes, { query: '', category: '', sort: 'updated', favoritesOnly: true }).slice(0, 4).map(recipe => <RecipeCard key={recipe.id} recipe={recipe} dataRevision={data.meta.dataRevision} />)}</div> : <p className="state-panel">気に入った料理に星をつけましょう。<Link className="button" to="/recipes">レシピ一覧へ</Link></p>}
    </section><section>
      <div className="section-heading"><h2>わが家のレシピ <span className="count">{data.recipes.length}品</span></h2><Link to="/recipes">一覧へ →</Link></div>
      {data.recipes.length === 0 ? <div className="state-panel"><h3>最初のレシピを登録しましょう</h3><p>料理名だけでも保存できます。<br />材料や手順は、あとから書き足せます。</p><Link className="button" to="/recipes/new">最初のレシピを登録</Link></div> :
        <div className="recipe-grid">{searchRecipes(data.recipes, { query: '', category: '', sort: 'updated' }).slice(0, 4).map(recipe => <RecipeCard key={recipe.id} recipe={recipe} dataRevision={data.meta.dataRevision} />)}</div>}
    </section></>}
    <div className="home-links"><Link to="/recipes"><strong>レシピを探す →</strong><span>料理名・材料・タグで検索</span></Link>
      <Link to="/roulette"><strong>献立ルーレット</strong><span>未実装 · Phase 2で対応</span></Link><Link to="/settings"><strong>設定</strong><span>未実装 · Phase 1Cで対応</span></Link></div>
    <DevelopmentNotice />
  </>
}
