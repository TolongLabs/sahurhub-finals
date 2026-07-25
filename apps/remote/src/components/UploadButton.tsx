import { Paperclip } from 'lucide-react'
import { type ChangeEvent, useRef } from 'react'
import { UPLOAD_ACCEPT, isAllowedUpload } from '../lib/upload.ts'

interface UploadButtonProps {
  onSelect: (file: File) => void
  onRejected: (message: string) => void
}

// Client-side accept + size cap; the server re-validates at the boundary
// (T11's job — this button owns only the picker + the optimistic echo).
export default function UploadButton({ onSelect, onRejected }: UploadButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!isAllowedUpload(file)) {
      onRejected('only text/image files up to 5MB are allowed')
      return
    }
    onSelect(file)
  }

  return (
    <>
      <input ref={inputRef} type="file" accept={UPLOAD_ACCEPT} className="file-input" onChange={handleChange} />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        aria-label="Upload file"
        className="composer-icon-button"
      >
        <Paperclip size={18} aria-hidden="true" />
      </button>
    </>
  )
}
