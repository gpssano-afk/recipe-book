import { Link } from 'react-router-dom'
import { DevelopmentNotice } from '../components/Shared'

export function PlaceholderPage({ kind }: { kind: 'roulette' | 'settings' }) {
  return <><section className="state-panel"><span className="category-label">未実装</span><h1>{kind === 'roulette' ? '献立ルーレット' : '設定'}</h1>
    <p>{kind === 'roulette' ? '献立の抽選・決定履歴・調理履歴はPhase 2で実装します。' : 'バックアップ・復元・容量管理はPhase 1Cで実装します。'}</p>
    <Link className="button primary" to="/recipes">レシピ一覧へ</Link></section><DevelopmentNotice /></>
}
