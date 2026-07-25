import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { Character } from '../types.ts'

interface CharacterPickerDialogProps {
  open: boolean
  characters: Character[]
  onSelect: (characterId: string) => void
  onClose: () => void
}

export default function CharacterPickerDialog({ open, characters, onSelect, onClose }: CharacterPickerDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    if (!open) return
    dialogRef.current?.focus()
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose, open])

  if (!open) return null

  // Portal to <body>: the drawer's translateX transform would otherwise make
  // position:fixed resolve against the drawer instead of the viewport.
  return createPortal(
    <div className="dialog-backdrop" role="presentation" onPointerDown={onClose}>
      <dialog
        ref={dialogRef}
        open
        aria-labelledby="character-picker-title"
        className="dialog-panel character-picker-dialog"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <h2 id="character-picker-title" className="dialog-title">
          Pick A Character
        </h2>
        <p className="dialog-copy">Your choice stays with this conversation.</p>
        <div className="character-picker-list">
          {characters.map((character) => (
            <button
              key={character.id}
              type="button"
              className="character-picker-card"
              onClick={() => onSelect(character.id)}
            >
              <span>{character.displayName}</span>
              <span className="settings-choice-id">{character.id}</span>
            </button>
          ))}
        </div>
        <div className="dialog-actions">
          <button type="button" onClick={onClose} className="secondary-button">
            Cancel
          </button>
        </div>
      </dialog>
    </div>,
    document.body
  )
}
