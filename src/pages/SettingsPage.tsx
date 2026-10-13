import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useBeforeUnload, useBlocker, useNavigate } from 'react-router-dom'
import { BackupNotice } from '../components/BackupNotice'
import { DevelopmentNotice, ErrorState, Loading } from '../components/Shared'
import { DB_VERSION } from '../data/database'
import { generateBackup, readSettings, recordExportRequest, restoreBackup, restoreCounts, type SettingsSnapshot } from '../data/backup'
import { useSettings } from '../hooks/useSettings'
import { backupLimits, type Counts } from '../domain/backup'
import { readBackupFile, type PreparedRestore } from '../services/backup'
import { formatBytes, readStorageStatus, type StorageStatus } from '../services/storage'

const countLabels: Record<keyof Counts, string> = { recipes: 'レシピ', images: '写真・スクリーンショット', mealDecisions: '決定履歴', cookingLogs: '調理履歴' }
const dateLabel = (value: string | null) => value ? new Date(value).toLocaleString('ja-JP') : 'なし'
const messageOf = (error: unknown) => error instanceof Error ? error.message : '処理できませんでした。'
interface Preview { prepared: PreparedRestore; current: SettingsSnapshot }

export function SettingsPage() {
  const { data, error: readError, retry } = useSettings()
  const navigate = useNavigate()
  const [storage, setStorage] = useState<StorageStatus | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const [operation, setOperation] = useState<'export' | 'restore' | 'validate' | 'persist' | null>(null)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [restored, setRestored] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const controller = useRef<AbortController | null>(null)
  const urls = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const previewHeading = useRef<HTMLHeadingElement>(null)
  const busy = operation === 'export' || operation === 'restore'
  const blocker = useBlocker(busy && !restored)
  const stale = !!preview && data?.meta.dataRevision !== preview.current.meta.dataRevision
  useBeforeUnload(event => { if (busy) { event.preventDefault(); event.returnValue = '' } })
  useEffect(() => { if (blocker.state === 'blocked') blocker.reset() }, [blocker])
  useEffect(() => { if (restored) navigate('/', { replace: true, state: { message: 'バックアップを復元しました。' } }) }, [restored, navigate])
  useEffect(() => {
    let active = true
    void readStorageStatus().then(status => { if (active) setStorage(status) })
    return () => { active = false }
  }, [data?.meta.dataRevision])
  useEffect(() => {
    const ownedUrls = urls.current
    return () => { controller.current?.abort(); for (const [url, timer] of ownedUrls) { clearTimeout(timer); URL.revokeObjectURL(url) } ownedUrls.clear() }
  }, [])
  useEffect(() => { if (preview) { previewHeading.current?.focus(); previewHeading.current?.scrollIntoView({ block: 'start' }) } }, [preview])
  const exportData = async () => {
    setOperation('export'); setError(''); setMessage(''); setProgress('バックアップを生成しています…')
    let requested = false
    try {
      const backup = await generateBackup((done, total) => setProgress(`写真を書き出しています… ${done} / ${total}`))
      const url = URL.createObjectURL(backup.blob)
      const timer = setTimeout(() => { URL.revokeObjectURL(url); urls.current.delete(url) }, 30000)
      urls.current.set(url, timer)
      const link = document.createElement('a'); link.href = url; link.download = backup.name
      document.body.append(link)
      try { link.click(); requested = true } finally { link.remove() }
      await recordExportRequest(backup.revision, new Date().toISOString())
      setMessage('書き出しを開始しました。保存先のファイルを確認し、端末の外に保管してください。')
    } catch (err) { setError(`${requested ? 'ダウンロードを要求しましたが、書き出し要求の記録を保存できませんでした。ファイルを確認してください。' : 'バックアップを生成できませんでした。'} ${messageOf(err)}`) }
    finally { setOperation(null); setProgress('') }
  }
  const cancelValidation = () => { controller.current?.abort(); controller.current = null; setOperation(null); setProgress(''); setPreview(null); setAcknowledged(false); setError('') }
  const selectFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = ''
    if (!file) return
    controller.current?.abort()
    const current = new AbortController(); controller.current = current
    setPreview(null); setAcknowledged(false); setOperation('validate'); setError(''); setMessage(''); setProgress('ファイル全体を検証しています…')
    try {
      const prepared = await readBackupFile(file, current.signal, (done, total) => setProgress(`写真を検証しています… ${done} / ${total}`))
      const snapshot = await readSettings(); current.signal.throwIfAborted()
      setPreview({ prepared, current: snapshot })
    } catch (err) { if (!current.signal.aborted) setError(`復元できません。既存データは変更していません。 ${messageOf(err)}`) }
    finally { if (!current.signal.aborted) { setOperation(null); setProgress('') } }
  }
  const refreshPreview = async () => {
    setAcknowledged(false); setError('')
    try { const current = await readSettings(); if (preview) setPreview({ ...preview, current }); retry() }
    catch (err) { setError(messageOf(err)) }
  }
  const restore = async () => {
    if (!preview || !acknowledged || stale || operation) return
    setOperation('restore'); setError(''); setMessage(''); setProgress('置き換えています。アプリを閉じないでください…')
    try { await restoreBackup(preview.prepared, preview.current.meta.dataRevision); setPreview(null); setRestored(true) }
    catch (err) { setError(`復元を完了できませんでした。置換処理は取り消されました。 ${messageOf(err)}`); setAcknowledged(false); retry() }
    finally { setOperation(null); setProgress('') }
  }
  const persist = async () => {
    setOperation('persist'); setError(''); setMessage('')
    try { const allowed = await navigator.storage.persist(); setStorage(await readStorageStatus()); setMessage(allowed ? '永続保存の許可が得られました。データ消失を防ぐ保証はありません。バックアップも保管してください。' : '永続保存は許可されませんでした。引き続き利用できます。バックアップを保管してください。') }
    catch { setError('永続保存の許可を確認できません。引き続き利用できます。バックアップを保管してください。') }
    finally { setOperation(null) }
  }
  return <>
    <h1>設定</h1><p>レシピを大切に残すために、定期的にバックアップしましょう。</p>
    {readError ? <ErrorState message={readError} retry={retry} /> : !data ? <Loading /> : <>
      <BackupNotice meta={data.meta} recipeCount={data.counts.recipes} />
      <section className="settings-panel"><h2>保存データと容量</h2>
        <dl className="settings-values">{(Object.keys(countLabels) as (keyof Counts)[]).map(key => <div key={key}><dt>{countLabels[key]}</dt><dd>{data.counts[key]}件</dd></div>)}
          <div><dt>画像本体とサムネイル</dt><dd>{formatBytes(data.meta.mediaBytes)} / 40 MiB</dd></div><div><dt>非画像データ</dt><dd>{formatBytes(data.meta.metadataBytes)} / 8 MiB</dd></div>
          <div><dt>ブラウザ全体の概算使用量</dt><dd>{storage?.usage == null ? '取得できません' : formatBytes(storage.usage)}</dd></div><div><dt>概算割当量</dt><dd>{storage?.quota == null ? '取得できません' : formatBytes(storage.quota)}</dd></div>
          <div><dt>永続保存</dt><dd>{storage?.persisted == null ? '確認できません' : storage.persisted ? '許可あり' : '許可なし'}</dd></div>
          <div><dt>最終書き出し要求</dt><dd>{dateLabel(data.meta.lastExportRequestedAt)}</dd></div>
        </dl><p>ブラウザの概算は同じオリジン全体の値です。保存の成功や永続性を保証しません。</p>
        {(data.meta.mediaBytes >= backupLimits.mediaBytes * .8 || data.meta.metadataBytes >= backupLimits.metadataBytes * .8 || (storage?.usage != null && storage.quota != null && storage.quota > 0 && storage.usage >= storage.quota * .8)) && <p className="notice" role="status">保存容量が上限に近づいています。バックアップを確認し、不要な写真やレシピを整理してください。自動削除はしません。</p>}
        <p>永続保存の許可はブラウザによる自動解放のリスクを減らします。データ削除・端末故障には備えられません。</p>
        <button type="button" disabled={!!operation || !storage?.canRequest || storage.persisted === true} onClick={() => { void persist() }}>永続保存の許可をリクエスト</button>
        {storage && !storage.canRequest && <p>このブラウザでは永続保存の許可を要求できません。</p>}
      </section>
      <section className="settings-panel"><h2>バックアップ</h2><p>写真・定番・レシピを含む全データを、1つのJSONファイルに書き出します。履歴も形式に含まれます（操作はPhase 2）。空のデータも書き出せます。</p><p>暗号化されません。私的な情報を含むため、共有先に注意し、GitHubなどの公開場所へ置かないでください。</p>
        <button type="button" className="primary" disabled={!!operation} onClick={() => { void exportData() }}>バックアップを書き出す</button>
        <p className="help">表示される日時は書き出しの要求日時です。保存先への書き込み完了や端末外への保管は確認できません。</p>
      </section>
      <section className="settings-panel"><h2>バックアップから復元</h2><p>信頼できる自分のバックアップを選んでください。現在のデータは全件置き換わります。追加・統合は行いません。ファイルの上限は64 MiBです。</p>
        <input ref={input} hidden type="file" accept=".json,application/json" aria-label="復元するバックアップファイル" onChange={event => { void selectFile(event) }} />
        <button type="button" disabled={!!operation} onClick={() => input.current?.click()}>復元ファイルを選ぶ</button>
        {operation === 'validate' && <button type="button" onClick={cancelValidation}>検証をキャンセル</button>}
      </section>
    </>}
    {progress && <p className="notice" role="status">{progress}</p>}
    {error && <p className="error" role="alert">{error}</p>}{message && <p className="success" role="status">{message}</p>}
    {preview && <section className="settings-panel restore-preview" aria-label="復元内容の確認"><h2 ref={previewHeading} tabIndex={-1}>復元内容の確認</h2>
      <p>ファイル生成日時：{dateLabel(preview.prepared.exportedAt)}</p><p className="error">現在のデータは置き換わります。削除されるデータは取り消せません。</p>
      <table><thead><tr><th scope="col">データ</th><th scope="col">現在</th><th scope="col">復元後</th></tr></thead><tbody>{(Object.keys(countLabels) as (keyof Counts)[]).map(key => <tr key={key}><th scope="row">{countLabels[key]}</th><td>{preview.current.counts[key]}</td><td>{restoreCounts(preview.prepared)[key]}</td></tr>)}</tbody></table>
      {stale && <p className="error" role="alert">別の画面で更新されました。現在の件数を再確認してください。<button disabled={!!operation} type="button" onClick={() => { void refreshPreview() }}>現在の件数を再確認</button></p>}
      <button type="button" disabled={!!operation} onClick={() => { void exportData() }}>今のデータを書き出す</button>
      <label className="checkbox-label"><input type="checkbox" checked={acknowledged && !stale} disabled={!!operation || stale || !!readError} onChange={event => setAcknowledged(event.target.checked)} />バックアップ済み、または全件置換を理解しました</label>
      <div className="actions"><button type="button" disabled={busy} onClick={cancelValidation}>復元をキャンセル</button><button type="button" className="danger" disabled={!!operation || !acknowledged || stale || !!readError} onClick={() => { void restore() }}>置き換えて復元</button></div>
    </section>}
    <section className="settings-panel"><h2>保存とバックアップについて</h2><p>レシピはこの端末のブラウザ内だけに保存されます。ブラウザデータの削除、端末故障、保存領域の解放で失われることがあります。書き出したファイルを確認し、定期的に端末の外にも保管してください。</p><p>保存先のURL・ブラウザ・プロファイルが変わるとデータは引き継がれません。旧環境で書き出し、新環境で復元してください。</p></section>
    <section className="settings-panel"><h2>アプリ情報</h2><p>アプリ 0.3.0（Phase 1C）<br />DB版 {DB_VERSION} / バックアップ形式版 1</p><p>PWAのインストール・オフライン・更新案内はPhase 4で対応します。</p></section>
    <DevelopmentNotice />
  </>
}
