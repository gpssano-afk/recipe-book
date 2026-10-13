import { useCallback, useEffect, useState } from 'react'
import { readSnapshot, type Snapshot } from '../data/recipes'
import { subscribeChanges } from '../data/database'

export function useSnapshot() {
  const [data, setData] = useState<Snapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => setAttempt(value => value + 1), [])
  useEffect(() => {
    let active = true
    let request = 0
    const load = async () => {
      const current = ++request
      setLoading(true)
      try {
        const result = await readSnapshot()
        if (active && current === request) { setData(result); setError(null) }
      } catch (err) {
        if (active && current === request) setError(err instanceof Error ? err.message : '読み込めませんでした。')
      } finally { if (active && current === request) setLoading(false) }
    }
    void load()
    const unsubscribe = subscribeChanges(() => { void load() })
    return () => { active = false; unsubscribe() }
  }, [attempt])
  return { data, error, loading, retry }
}
