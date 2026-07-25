import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

interface ConfirmDialogProps {
  open: boolean
  message: string
  confirmLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmDialog({
  open,
  message,
  confirmLabel = 'Reset',
  onConfirm,
  onCancel
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    if (!open) return
    dialogRef.current?.focus()
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onCancel, open])

  if (!open) return null

  // Portal to <body>: transformed ancestors (drawers) must not become the
  // containing block for this fixed overlay.
  return createPortal(
    <div className="dialog-backdrop" role="presentation" onPointerDown={onCancel}>
      <dialog
        ref={dialogRef}
        open
        className="dialog-panel"
        aria-label="Confirm action"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <p className="dialog-copy">{message}</p>
        <div className="dialog-actions">
          <button type="button" onClick={onCancel} className="secondary-button">
            Cancel
          </button>
          <button type="button" onClick={onConfirm} className="danger-button">
            {confirmLabel}
          </button>
        </div>
      </dialog>
    </div>,
    document.body
  )
}
