import { Link } from 'react-router-dom'
import { categories, type Recipe } from '../domain/types'
import { StoredImage } from './Images'
import { FavoriteButton } from './FavoriteButton'

export function BowlMark() {
  return <svg viewBox="0 0 64 64" fill="none" aria-hidden="true"><path d="M12 31h40c-1 14-8 22-20 22S13 45 12 31Z" fill="currentColor"/><path d="M8 31h48M23 56h18" stroke="currentColor" strokeWidth="4" strokeLinecap="round"/><path d="M22 23c-7-8 8-10 1-18m10 18c-7-8 8-10 1-18m10 18c-7-8 8-10 1-18" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/></svg>
}
export function PhotoPlaceholder({ compact = false }: { compact?: boolean }) {
  return <div className={`photo-placeholder ${compact ? 'compact' : ''}`}><BowlMark /><span>料理写真なし</span></div>
}
export function RecipeCard({ recipe, dataRevision }: { recipe: Recipe; dataRevision: number }) {
  return <article className="recipe-card"><Link className="recipe-card-link" to={`/recipes/${recipe.id}`}>
    <div className="card-photo">{recipe.coverImageId ? <StoredImage id={recipe.coverImageId} recipeId={recipe.id} thumbnail label={`${recipe.title}の表紙`} revision={recipe.revision} /> : <PhotoPlaceholder compact />}</div>
    <div className="card-body"><span className="category-label">{categories[recipe.category]}</span><h2>{recipe.title}</h2>
      <p>{recipe.cookingMinutes === null ? '時間未登録' : `${recipe.cookingMinutes}分`}</p>
      {recipe.tags.length > 0 && <div className="tags">{recipe.tags.slice(0, 2).map(tag => <span key={tag}>{tag}</span>)}{recipe.tags.length > 2 && <span>+{recipe.tags.length - 2}</span>}</div>}
    </div><span className="card-arrow" aria-hidden="true">›</span>
  </Link><FavoriteButton recipe={recipe} dataRevision={dataRevision} /></article>
}
export function Loading() { return <p className="state-panel" role="status">読み込み中…</p> }
export function ErrorState({ message, retry }: { message: string; retry?: () => void }) {
  return <section className="state-panel error"><h2>データを読み込めません</h2><p role="alert">{message}</p>
    {retry && <button type="button" onClick={retry}>再試行</button>}<Link className="button" to="/">ホームへ</Link>
  </section>
}
export function Missing({ screen = false }: { screen?: boolean }) {
  return <section className="state-panel"><h1>{screen ? '画面が見つかりません' : 'レシピが見つかりません'}</h1>
    <p>{screen ? 'URLを確認してください。' : '削除されたか、URLが正しくない可能性があります。'}</p>
    <Link className="button primary" to={screen ? '/' : '/recipes'}>{screen ? 'ホームへ' : 'レシピ一覧へ'}</Link>
  </section>
}
export function DevelopmentNotice() {
  return <aside className="notice"><strong>テスト用の開発版です</strong><p>バックアップ・復元は未実装です。ブラウザのデータ削除や端末故障でレシピを失う可能性があります。家庭の本番データは入力しないでください。</p></aside>
}
