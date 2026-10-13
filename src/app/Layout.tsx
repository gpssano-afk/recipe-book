import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { BowlMark } from '../components/Shared'
import { initialListSession, ListSessionContext } from './session'

export function Layout() {
  const location = useLocation()
  const [session, setSession] = useState(initialListSession)
  const [favoriteSession, setFavoriteSession] = useState(initialListSession)
  const [message, setMessage] = useState('')
  const editing = /\/recipes\/(new|[^/]+\/edit)$/.test(location.pathname)
  const inRecipes = location.pathname.startsWith('/recipes') || ['/favorites', '/search'].includes(location.pathname)
  useEffect(() => { window.scrollTo(0, 0); setMessage('') }, [location.pathname])
  useEffect(() => {
    const saved = (event: Event) => setMessage((event as CustomEvent<string>).detail)
    window.addEventListener('recipe-favorite-saved', saved)
    return () => window.removeEventListener('recipe-favorite-saved', saved)
  }, [])
  return <ListSessionContext.Provider value={{ session, setSession, favoriteSession, setFavoriteSession }}>
    <header className="site-header"><Link to="/" className="brand"><BowlMark /><span>佐野家のごはん</span></Link><span className="version-label">開発版 1B</span></header>
    <main className={editing ? 'content editing' : 'content'} id="main">{message && <p className="success" role="status">{message}</p>}<Outlet /></main>
    {!editing && <nav className="bottom-nav" aria-label="メインメニュー">
      <NavLink to="/" end><span aria-hidden="true">⌂</span>ホーム</NavLink>
      <Link to="/recipes" className={inRecipes ? 'active' : ''} aria-current={inRecipes ? 'page' : undefined}><span aria-hidden="true">▤</span>レシピ</Link>
      <NavLink to="/roulette"><span aria-hidden="true">◉</span>ルーレット</NavLink>
      <NavLink to="/settings"><span aria-hidden="true">⚙</span>設定</NavLink>
    </nav>}
  </ListSessionContext.Provider>
}
