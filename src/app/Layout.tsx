import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { BowlMark } from '../components/Shared'
import { initialListSession, ListSessionContext } from './session'

export function Layout() {
  const location = useLocation()
  const [session, setSession] = useState(initialListSession)
  const editing = /\/recipes\/(new|[^/]+\/edit)$/.test(location.pathname)
  useEffect(() => { window.scrollTo(0, 0) }, [location.pathname])
  return <ListSessionContext.Provider value={{ session, setSession }}>
    <header className="site-header"><Link to="/" className="brand"><BowlMark /><span>佐野家のごはん</span></Link><span className="version-label">開発版 1A</span></header>
    <main className={editing ? 'content editing' : 'content'} id="main"><Outlet /></main>
    {!editing && <nav className="bottom-nav" aria-label="メインメニュー">
      <NavLink to="/" end><span aria-hidden="true">⌂</span>ホーム</NavLink>
      <NavLink to="/recipes"><span aria-hidden="true">▤</span>レシピ</NavLink>
      <NavLink to="/roulette"><span aria-hidden="true">◉</span>ルーレット</NavLink>
      <NavLink to="/settings"><span aria-hidden="true">⚙</span>設定</NavLink>
    </nav>}
  </ListSessionContext.Provider>
}
