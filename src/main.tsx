import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createHashRouter, RouterProvider } from 'react-router-dom'
import { Layout } from './app/Layout'
import { Missing } from './components/Shared'
import { HomePage } from './pages/HomePage'
import { ListPage } from './pages/ListPage'
import { DetailPage } from './pages/DetailPage'
import { EditPage } from './pages/EditPage'
import { PlaceholderPage } from './pages/PlaceholderPage'
import './styles/app.css'

// HashRouterと同じhash URLを使い、Data Routerの離脱ブロッカーを利用する。
const router = createHashRouter([{
  element: <Layout />,
  children: [
    { path: '/', element: <HomePage /> },
    { path: '/recipes', element: <ListPage /> },
    { path: '/search', element: <ListPage /> },
    { path: '/recipes/new', element: <EditPage /> },
    { path: '/recipes/:id', element: <DetailPage /> },
    { path: '/recipes/:id/edit', element: <EditPage /> },
    { path: '/roulette', element: <PlaceholderPage kind="roulette" /> },
    { path: '/settings', element: <PlaceholderPage kind="settings" /> },
    { path: '*', element: <Missing screen /> },
  ],
}])
createRoot(document.getElementById('root')!).render(<StrictMode><RouterProvider router={router} /></StrictMode>)
