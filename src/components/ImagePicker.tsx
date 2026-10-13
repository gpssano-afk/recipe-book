import { useRef, useState } from 'react'
import type { ImageAsset } from '../domain/types'
import { prepareImage } from '../services/images'
import { BlobImage } from './Images'
import type { RecipeMedia } from '../domain/images'
export function ImagePicker({ media, recipeId, disabled, onChange, onProcessing }: { media: RecipeMedia; recipeId: string; disabled: boolean; onChange: (media: RecipeMedia) => void; onProcessing: (busy: boolean) => void }) {
  const dishInput = useRef<HTMLInputElement>(null)
  const cameraInput = useRef<HTMLInputElement>(null)
  const screenshotInput = useRef<HTMLInputElement>(null)
  const [processing, setProcessing] = useState(false)
  const processingRef = useRef(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  async function select(input: HTMLInputElement, kind: ImageAsset['kind']) {
    const files = [...(input.files ?? [])]; input.value = ''
    if (!files.length || processingRef.current) return
    if (files.length + media.images.length > 6) { setError('料理写真・スクリーンショットは合計6枚までです。写真を削除してから選び直してください。'); return }
    processingRef.current = true; setProcessing(true); onProcessing(true); setError('')
    try {
      const prepared: ImageAsset[] = []
      for (const [index, file] of files.entries()) { setStatus(`画像を処理中… ${index + 1}/${files.length}`); prepared.push(await prepareImage(file, recipeId, kind)) }
      const images = [...media.images, ...prepared]
      onChange({ images, coverImageId: media.coverImageId ?? images.find(image => image.kind === 'dish')?.id ?? null })
      setStatus('画像を準備しました。プレビューを確認して「保存する」で確定してください。')
    } catch (err) { setError(err instanceof Error ? err.message : '画像を処理できませんでした。'); setStatus('') }
    finally { processingRef.current = false; setProcessing(false); onProcessing(false) }
  }
  function remove(id: string) {
    const images = media.images.filter(image => image.id !== id)
    onChange({ images, coverImageId: media.coverImageId === id ? images.find(image => image.kind === 'dish')?.id ?? null : media.coverImageId })
  }
  function move(index: number, direction: number) {
    const images = [...media.images]; const target = index + direction
    if (images[index] && images[target]) [images[index], images[target]] = [images[target]!, images[index]!]
    onChange({ ...media, images })
  }
  return <section className="form-section"><h2>写真・スクリーンショット <span className="count">{media.images.length}/6枚</span></h2>
    <p className="help">JPEG・PNG・WebPの静止画、1枚20MiBまで。端末内で圧縮し、元ファイルは保存しません。位置情報などの元の付随情報は引き継ぎません。</p>
    <div className="image-picker-actions"><button type="button" disabled={disabled || processing || media.images.length >= 6} onClick={() => dishInput.current?.click()}>料理写真を選ぶ</button><button type="button" disabled={disabled || processing || media.images.length >= 6} onClick={() => cameraInput.current?.click()}>撮影する</button><button type="button" disabled={disabled || processing || media.images.length >= 6} onClick={() => screenshotInput.current?.click()}>スクリーンショットを選ぶ</button></div>
    <input ref={dishInput} type="file" hidden aria-label="料理写真ファイル" accept="image/jpeg,image/png,image/webp" multiple disabled={disabled || processing} onChange={event => { void select(event.currentTarget, 'dish') }} />
    <input ref={cameraInput} type="file" hidden aria-label="撮影ファイル" accept="image/jpeg,image/png,image/webp" capture="environment" disabled={disabled || processing} onChange={event => { void select(event.currentTarget, 'dish') }} />
    <input ref={screenshotInput} type="file" hidden aria-label="スクリーンショットファイル" accept="image/jpeg,image/png,image/webp" multiple disabled={disabled || processing} onChange={event => { void select(event.currentTarget, 'screenshot') }} />
    <p className="help">撮影が使えない場合は「料理写真を選ぶ」を利用してください。画面の画像は自動で文字に変換しません。</p>
    {status && <p role="status">{status}</p>}{error && <p className="error" role="alert">{error} 入力と準備済みの写真は残っています。</p>}
    <div className="image-previews">{media.images.map((image, index) => <div className="image-preview" key={image.id}>
      <BlobImage blob={image.blob} alt={`添付画像${index + 1}のプレビュー`} /><p>{image.kind === 'dish' ? '料理写真' : 'スクリーンショット'} {index + 1} · {Math.ceil(image.byteLength / 1024)}KiB · {image.width}×{image.height}px</p>
      {image.kind === 'dish' && <button type="button" disabled={disabled || processing} aria-pressed={media.coverImageId === image.id} onClick={() => onChange({ ...media, coverImageId: image.id })}>{media.coverImageId === image.id ? '表紙に設定済み' : '表紙にする'}<span className="sr-only"> · 写真{index + 1}</span></button>}
      <div className="row-actions"><button type="button" disabled={disabled || processing || index === 0} aria-label={`写真${index + 1}を上へ`} onClick={() => move(index, -1)}>↑ 上へ</button><button type="button" disabled={disabled || processing || index === media.images.length - 1} aria-label={`写真${index + 1}を下へ`} onClick={() => move(index, 1)}>↓ 下へ</button><button type="button" disabled={disabled || processing} aria-label={`写真${index + 1}を削除`} onClick={() => remove(image.id)}>削除</button></div>
    </div>)}</div>
    {media.images.length === 0 && <p className="muted">写真なしでも登録できます。</p>}
  </section>
}
