import { Link } from 'react-router-dom'
import { DevelopmentNotice } from '../components/Shared'

export function PlaceholderPage() {
  return <><section className="state-panel"><span className="category-label">未実装</span><h1>献立ルーレット</h1>
    <p>献立の抽選・決定履歴・調理履歴はPhase 2で実装します。</p>
    <Link className="button primary" to="/recipes">レシピ一覧へ</Link></section><DevelopmentNotice /></>
}
