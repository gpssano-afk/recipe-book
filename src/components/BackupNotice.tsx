import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { Meta } from '../domain/types'
import { backupReminderDue } from '../domain/backup'
import { acknowledgeLossNotice } from '../data/backup'

export function BackupNotice({ meta, recipeCount }: { meta: Meta; recipeCount: number }) {
  const [dismissed, setDismissed] = useState(false)
  if (dismissed || !backupReminderDue(meta, recipeCount)) return null
  return <aside className="notice"><strong>レシピを端末の外にも保管しましょう</strong><p>ブラウザ内のデータは消えることがあります。写真も含めて書き出し、ファイルを端末の外へ保管してください。</p>
    <div className="actions"><Link className="button" to="/settings">バックアップへ</Link><button type="button" onClick={() => setDismissed(true)}>案内を閉じる</button></div></aside>
}
export function LossNotice({ meta }: { meta: Meta }) {
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  if (meta.lossNoticeAcknowledged || meta.dataRevision === 0) return null
  const acknowledge = async () => {
    setBusy(true); setError('')
    try { await acknowledgeLossNotice() } catch (err) { setError(err instanceof Error ? err.message : '確認状態を保存できませんでした。') }
    finally { setBusy(false) }
  }
  return <aside className="notice"><strong>保存したレシピについて</strong><p>レシピはこのブラウザだけに保存されます。ブラウザのデータ削除・端末故障・保存領域の解放で失われる可能性があります。バックアップを端末外に保管してください。</p><button disabled={busy} type="button" onClick={() => { void acknowledge() }}>確認しました</button>{error && <p role="alert">{error}</p>}</aside>
}
