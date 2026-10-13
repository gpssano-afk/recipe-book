import { LossNotice } from '../components/BackupNotice'
import { useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { ErrorState, Loading, Missing, PhotoPlaceholder } from '../components/Shared'
import { deleteRecipe, getDeleteCounts } from '../data/recipes'
import { categories, type Recipe } from '../domain/types'
import { useSnapshot } from '../hooks/useSnapshot'
import { StoredImage } from '../components/Images'
import { FavoriteButton } from '../components/FavoriteButton'

interface DeleteTarget { recipe: Recipe; dataRevision: number; counts: { images: number; mealDecisions: number; cookingLogs: number } }
const date = (value: string) => new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
export function DetailPage() {
  const { id } = useParams()
  const { data, loading, error, retry } = useSnapshot()
  const [target, setTarget] = useState<DeleteTarget | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const navigate = useNavigate()
  const location = useLocation()
  const recipe = data?.recipes.find(item => item.id === id)
  async function confirmDelete() {
    if (!recipe || !data || busy) return
    setBusy(true); setActionError('')
    try { setTarget({ recipe, dataRevision: data.meta.dataRevision, counts: await getDeleteCounts(recipe.id) }) }
    catch (err) { setActionError(err instanceof Error ? err.message : '削除の準備ができませんでした。') }
    finally { setBusy(false) }
  }
  async function remove() {
    if (!target || busy) return
    setBusy(true); setActionError('')
    try {
      await deleteRecipe(target.recipe.id, target.recipe.revision, target.dataRevision)
      navigate('/recipes', { replace: true, state: { message: 'レシピを削除しました。' } })
    } catch (err) { setActionError(err instanceof Error ? err.message : '削除できませんでした。') }
    finally { setBusy(false) }
  }
  if (loading && !data) return <Loading />
  if (error) return <ErrorState message={error} retry={retry} />
  if (!recipe) return <Missing />
  const message = (location.state as { message?: string } | null)?.message
  return <>
    {data && <LossNotice meta={data.meta} />}
    <Link className="back-link" to="/recipes">← レシピ一覧</Link>
    {message && <p className="success" role="status">{message}</p>}
    <article className="recipe-detail">{recipe.coverImageId ? <StoredImage id={recipe.coverImageId} recipeId={recipe.id} label="表紙写真" revision={recipe.revision} /> : <PhotoPlaceholder />}
      <div className="detail-title"><span className="category-label">{categories[recipe.category]}</span><h1>{recipe.title}</h1>
        <FavoriteButton recipe={recipe} dataRevision={data!.meta.dataRevision} />
        <div className="recipe-facts"><span>人数：{recipe.servings === null ? '未登録' : `${recipe.servings}人分`}</span><span>調理時間：{recipe.cookingMinutes === null ? '未登録' : `${recipe.cookingMinutes}分`}</span></div>
        <div className="tags">{recipe.tags.map(tag => <span key={tag}>{tag}</span>)}</div>
      </div>
      {recipe.imageIds.length > 0 && <section className="detail-section"><h2>写真・スクリーンショット</h2><div className="detail-gallery">{recipe.imageIds.map((imageId, index) => <StoredImage key={imageId} id={imageId} recipeId={recipe.id} label={`添付画像${index + 1}`} revision={recipe.revision} />)}</div></section>}
      <section className="detail-section"><h2>材料・分量</h2>{recipe.ingredients.length ? <dl className="ingredients">{recipe.ingredients.map((row, i) => <div key={i}><dt>{row.name}</dt><dd>{row.amount || '分量未登録'}</dd></div>)}</dl> : <p className="muted">未登録</p>}</section>
      <section className="detail-section"><h2>調理手順</h2>{recipe.steps.length ? <ol className="steps">{recipe.steps.map((step, i) => <li key={i}><span className="step-number" aria-hidden="true">{i + 1}</span><p>{step}</p></li>)}</ol> : <p className="muted">未登録</p>}</section>
      <section className="detail-section"><h2>メモ</h2><p className="preserve-lines">{recipe.memo || '未登録'}</p></section>
      <section className="detail-section"><h2>元レシピURL</h2>{recipe.sourceUrl ? <><a className="source-link" href={recipe.sourceUrl} target="_blank" rel="noopener noreferrer">{new URL(recipe.sourceUrl).hostname} を開く ↗<span className="sr-only">（別タブで開きます）</span></a>
        <details><summary>URL全文を表示</summary><p className="url-text">{recipe.sourceUrl}</p></details><p className="help">リンク先の本文は保存していません。閲覧には通信が必要です。</p></> : <p className="muted">未登録</p>}</section>
      <div className="timestamps"><p>登録日時：<time dateTime={recipe.createdAt}>{date(recipe.createdAt)}</time></p><p>更新日時：<time dateTime={recipe.updatedAt}>{date(recipe.updatedAt)}</time></p></div>
    </article>
    {actionError && !target && <p className="error" role="alert">{actionError}</p>}
    <div className="detail-actions"><Link className="button primary" to={`/recipes/${recipe.id}/edit`}>レシピを編集</Link><button className="danger-outline" type="button" disabled={busy} onClick={() => { void confirmDelete() }}>{busy ? '処理中…' : 'レシピを削除'}</button></div>
    <ConfirmDialog open={target !== null} title="レシピを削除しますか？" confirmLabel={busy ? '削除中…' : '削除する'} dangerous busy={busy} onCancel={() => { setTarget(null); setActionError('') }} onConfirm={() => { void remove() }}>
      <p>「{target?.recipe.title}」を削除します。この操作は取り消せません。</p>
      {target && <p>関連する写真{target.counts.images}件・決定履歴{target.counts.mealDecisions}件・調理履歴{target.counts.cookingLogs}件も削除します。</p>}
      {actionError && <p className="error" role="alert">削除できませんでした。{actionError}</p>}
    </ConfirmDialog>
  </>
}
