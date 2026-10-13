import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { ErrorState, Loading, Missing } from '../components/Shared'
import { RecipeForm } from '../components/RecipeForm'
import { useSnapshot } from '../hooks/useSnapshot'
import type { Snapshot } from '../data/recipes'

export function EditPage() {
  const { id } = useParams()
  const { data, loading, error, retry } = useSnapshot()
  const [initial, setInitial] = useState<Snapshot | null>(null)
  useEffect(() => { if (data) setInitial(previous => previous ?? data) }, [data])
  if (!initial) return loading || data ? <Loading /> : <ErrorState message={error ?? '読み込めませんでした。'} retry={retry} />
  const recipe = id ? initial.recipes.find(item => item.id === id) : undefined
  if (id && !recipe) return <Missing />
  return <RecipeForm key={id ?? 'new'} initialRecipe={recipe} initialDataRevision={initial.meta.dataRevision}
    dataRevision={data?.meta.dataRevision ?? initial.meta.dataRevision} deleted={!!id && !!data && !data.recipes.some(item => item.id === id)} readError={error} />
}
