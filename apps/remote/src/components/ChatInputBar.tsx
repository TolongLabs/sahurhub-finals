import { SendHorizontal, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { AgentStatus, RecordingState } from '../types.ts'
import RecordButton from './RecordButton.tsx'
import UploadButton from './UploadButton.tsx'

interface ChatInputBarProps {
  status: AgentStatus
  characterName: string
  recording: RecordingState
  text: string
  onTextChange: (text: string) => void
  onSendText: (text: string) => void
  onBeginRecording: () => void
  onCommitRecording: () => void
  onFrame: (data: ArrayBuffer) => void
  onEndRecording: (sendAudio: boolean) => void
  onInterrupt: () => void
  onUpload: (file: File, text: string) => Promise<void>
}

export default function ChatInputBar(props: ChatInputBarProps) {
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [attachment, setAttachment] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!attachment?.type.startsWith('image/')) {
      setPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(attachment)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [attachment])

  function handleSend() {
    const trimmed = props.text.trim()
    if (!trimmed && !attachment) return
    if (attachment) {
      const file = attachment
      setAttachment(null)
      props.onTextChange('')
      void props.onUpload(file, trimmed).catch(() => setUploadError('upload failed — try again'))
      return
    }
    props.onSendText(trimmed)
    props.onTextChange('')
  }

  return (
    <div className="composer">
      <div className="composer-column">
        {uploadError && <span className="form-error">{uploadError}</span>}
        {attachment && (
          <div className="attachment-chip">
            {previewUrl && <img src={previewUrl} alt="" className="attachment-preview" />}
            <span className="attachment-name" title={attachment.name}>
              {attachment.name}
            </span>
            <button
              type="button"
              onClick={() => setAttachment(null)}
              className="attachment-remove"
              aria-label={`Remove ${attachment.name}`}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        )}
        <div className="composer-row">
          <UploadButton
            onSelect={(file) => {
              setUploadError(null)
              setAttachment(file)
            }}
            onRejected={setUploadError}
          />
          <textarea
            value={props.text}
            onChange={(e) => props.onTextChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            rows={1}
            placeholder={
              props.status === 'thinking' ? `${props.characterName} is thinking…` : `Message ${props.characterName}…`
            }
            className="composer-input"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!props.text.trim() && !attachment}
            aria-label="Send"
            className="composer-icon-button send-button"
          >
            <SendHorizontal size={18} aria-hidden="true" />
          </button>
          <RecordButton
            status={props.status}
            recording={props.recording}
            onBeginRecording={props.onBeginRecording}
            onCommitRecording={props.onCommitRecording}
            onFrame={props.onFrame}
            onEndRecording={props.onEndRecording}
            onInterrupt={props.onInterrupt}
          />
        </div>
      </div>
    </div>
  )
}
