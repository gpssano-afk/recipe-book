import { useEffect, useRef, type ReactNode } from 'react'

interface Props {
  open: boolean; title: string; children: ReactNode
  confirmLabel: string; cancelLabel?: string; busy?: boolean; dangerous?: boolean
  onConfirm: () => void; onCancel: () => void
}
export function ConfirmDialog({ open, title, children, confirmLabel, cancelLabel = 'キャンセル', busy = false, dangerous = false, onConfirm, onCancel }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const element = dialog.current
    if (!element || !open) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    element.showModal()
    cancel.current?.focus()
    return () => { element.close(); previous?.focus() }
  }, [open])
  return <dialog ref={dialog} aria-label={title} onCancel={event => { event.preventDefault(); if (!busy) onCancel() }}>
    <h2>{title}</h2>
    <div>{children}</div>
    <div className="dialog-actions">
      <button ref={cancel} type="button" disabled={busy} onClick={onCancel}>{cancelLabel}</button>
      <button type="button" className={dangerous ? 'danger' : 'primary'} disabled={busy} onClick={onConfirm}>{confirmLabel}</button>
    </div>
  </dialog>
}
