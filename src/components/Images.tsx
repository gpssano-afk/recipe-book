import { useEffect, useRef, useState } from 'react'
import { readImage } from '../data/images'
import { useBlobUrl } from '../hooks/useBlobUrl'

export function BlobImage({ blob, alt, onError }: { blob: Blob; alt: string; onError?: () => void }) {
  const url = useBlobUrl(blob)
  return url ? <img src={url} alt={alt} loading="lazy" decoding="async" onError={onError} /> : <span role="status">画像を準備中…</span>
}
export function StoredImage({ id, recipeId, thumbnail = false, label, revision }: { id: string; recipeId: string; thumbnail?: boolean; label: string; revision: number }) {
  const [blob, setBlob] = useState<Blob>()
  const [kind, setKind] = useState<'dish' | 'screenshot'>()
  const [error, setError] = useState(false)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    let active = true
    setBlob(undefined); setError(false)
    void readImage(id, recipeId, thumbnail).then(result => { if (active) { setBlob(result.blob); setKind(result.kind) } }, () => { if (active) setError(true) })
    return () => { active = false }
  }, [id, recipeId, thumbnail, revision])
  if (error) return <p className="image-error" role="status">写真を読み込めません</p>
  if (!blob) return <div className="image-loading" role="status">写真を読み込み中…</div>
  return <>
    {thumbnail ? <BlobImage blob={blob} alt={label} onError={() => setError(true)} /> : <button type="button" className="image-open" onClick={() => setOpen(true)} aria-label={`${label}を拡大`}><BlobImage blob={blob} alt={label} onError={() => setError(true)} /><span>{kind === 'dish' ? '料理写真' : 'スクリーンショット'} · タップして拡大</span></button>}
    {!thumbnail && <ImageViewer blob={blob} label={label} open={open} onClose={() => setOpen(false)} />}
  </>
}
function ImageViewer({ blob, label, open, onClose }: { blob: Blob; label: string; open: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const close = useRef<HTMLButtonElement>(null)
  const [actualSize, setActualSize] = useState(false)
  useEffect(() => {
    if (!open || !dialog.current) return
    const element = dialog.current
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    element.showModal(); close.current?.focus()
    return () => { element.close(); previous?.focus() }
  }, [open])
  return <dialog ref={dialog} className="image-viewer" aria-label="写真を拡大" onCancel={event => { event.preventDefault(); onClose() }}>
    <div className="viewer-actions"><button ref={close} type="button" onClick={onClose}>閉じる</button><button type="button" aria-pressed={actualSize} onClick={() => setActualSize(value => !value)}>{actualSize ? '画面に合わせる' : '原寸表示'}</button></div>
    <p>{label} · ピンチやスクロールで確認できます。</p>
    {open && <div className={actualSize ? 'viewer-image actual-size' : 'viewer-image'}><BlobImage blob={blob} alt={label} /></div>}
  </dialog>
}
