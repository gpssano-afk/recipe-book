import { useRef, useState } from 'react'
import type { Recipe } from '../domain/types'
import { setRecipeFavorite } from '../data/recipes'

export function FavoriteButton({ recipe, dataRevision }: { recipe: Recipe; dataRevision: number }) {
  const [busy, setBusy] = useState(false)
  const saving = useRef(false)
  const [error, setError] = useState('')
  async function toggle() {
    if (saving.current) return
    saving.current = true; setBusy(true); setError('')
    try { await setRecipeFavorite(recipe, !recipe.isFavorite, dataRevision); window.dispatchEvent(new CustomEvent('recipe-favorite-saved', { detail: recipe.isFavorite ? '定番から外しました。' : '定番に登録しました。' })) }
    catch (err) { setError(err instanceof Error ? err.message : '定番の変更を保存できませんでした。') }
    finally { saving.current = false; setBusy(false) }
  }
  return <div className="favorite-control"><button className="favorite-button" type="button" disabled={busy} aria-pressed={recipe.isFavorite} aria-label={`${recipe.title}を${recipe.isFavorite ? '定番から外す' : '定番に登録'}`} onClick={() => { void toggle() }}><span aria-hidden="true">{recipe.isFavorite ? '★' : '☆'}</span>{busy ? '保存中…' : '定番'}</button>
    {error && <p className="field-error" role="alert">定番を変更できませんでした。{error}</p>}
  </div>
}
