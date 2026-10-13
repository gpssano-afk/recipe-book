import { createContext, useContext, type Dispatch, type SetStateAction } from 'react'
import type { SearchOptions } from '../domain/search'

export interface ListSession extends SearchOptions { visible: number; scroll: number }
export const initialListSession: ListSession = { query: '', category: '', sort: 'updated', tags: [], favoritesOnly: false, visible: 30, scroll: 0 }
export const ListSessionContext = createContext<{ session: ListSession; setSession: Dispatch<SetStateAction<ListSession>>; favoriteSession: ListSession; setFavoriteSession: Dispatch<SetStateAction<ListSession>> } | null>(null)
export function useListSession(favoritesOnly = false) {
  const value = useContext(ListSessionContext)
  if (!value) throw new Error('一覧の表示状態がありません。')
  return favoritesOnly ? { session: value.favoriteSession, setSession: value.setFavoriteSession } : value
}
