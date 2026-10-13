import { useCallback, useEffect, useState } from 'react'
import { readSettings, type SettingsSnapshot } from '../data/backup'
import { subscribeChanges } from '../data/database'

export function useSettings() {
  const [data, setData] = useState<SettingsSnapshot | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => setAttempt(value => value + 1), [])
  useEffect(() => {
    let active = true; let request = 0
    const load = async () => {
      const current = ++request
      try { const next = await readSettings(); if (active && current === request) { setData(next); setError('') } }
      catch (error) { if (active && current === request) setError(error instanceof Error ? error.message : '読み込めません。') }
    }
    void load(); const unsubscribe = subscribeChanges(() => { void load() })
    return () => { active = false; unsubscribe() }
  }, [attempt])
  return { data, error, retry }
}
