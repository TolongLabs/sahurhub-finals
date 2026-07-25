// File upload — boundary validation + routing (docs/plan.md T11 item 7;
// docs/decisions.md 2026-07-15 "Remote chat file upload"). Transport is
// `POST /upload`, `multipart/form-data` with a single `file` field (T10a's
// client-side choice, docs/plan.md T10a) — this re-validates the same
// mime+extension allowlist + size cap at the boundary (AGENTS.md: never trust
// the client). Response shape `{id, name, mime}` matches what
// apps/remote/src/lib/upload.ts already expects.

import type { Database } from 'bun:sqlite'
import type { MessageSummary, ServerMessage } from '../shared/protocol.ts'
import { type MessageRow, insertMessage } from './db/dao.ts'
import type { VoiceBackend } from './llm/voice-backend.ts'
import { emitVisionFailure } from './vision.ts'

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024
const TEXT_CHAR_CAP = 4000
const ALLOWED_TEXT_EXT = new Set(['.txt', '.md'])
const ALLOWED_IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp'])

export interface UploadDeps {
  db: Database
  conversationId: string
  backend: VoiceBackend
  broadcast: (message: ServerMessage) => void
  speak: (text: string) => Promise<void>
}

export interface UploadOk {
  ok: true
  id: string
  name: string
  mime: string
}

export interface UploadRejected {
  ok: false
  status: number
  error: string
}

export type UploadResult = UploadOk | UploadRejected

function extname(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot).toLowerCase()
}

export function toMessageSummary(row: MessageRow): MessageSummary {
  return {
    id: row.id,
    conversationId: row.conversationId,
    role: row.role,
    content: row.content,
    kind: row.kind,
    ts: row.ts
  }
}

export async function handleUpload(deps: UploadDeps, file: File, userText?: string): Promise<UploadResult> {
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, status: 413, error: 'file too large' }

  const ext = extname(file.name)
  const looksLikeText = file.type.startsWith('text/') || ALLOWED_TEXT_EXT.has(ext)
  const looksLikeImage = file.type.startsWith('image/') || ALLOWED_IMAGE_EXT.has(ext)

  if (looksLikeText && ALLOWED_TEXT_EXT.has(ext)) {
    const text = withUserText(userText, (await file.text()).slice(0, TEXT_CHAR_CAP))
    const message = insertMessage(deps.db, {
      conversationId: deps.conversationId,
      role: 'user',
      content: text,
      kind: 'upload-text'
    })
    deps.broadcast({ type: 'message', message: toMessageSummary(message) })
    return { ok: true, id: message.id, name: file.name, mime: file.type || 'text/plain' }
  }

  if (looksLikeImage && ALLOWED_IMAGE_EXT.has(ext)) {
    const message = insertMessage(deps.db, {
      conversationId: deps.conversationId,
      role: 'user',
      content: withUserText(userText, file.name),
      kind: 'upload-image'
    })
    deps.broadcast({ type: 'message', message: toMessageSummary(message) })

    // The async inspect_camera/vision lane (docs/trd.md §3.9) — off the
    // upload response's critical path; a mocked reaction under
    // MockVoiceBackend, real T4-gated vision under QwenChainedBackend.
    const imageBytes = new Uint8Array(await file.arrayBuffer())
    void deps.backend
      .describeImage(imageBytes, file.type || 'image/png', userText)
      .then((reaction) => deps.speak(reaction))
      .catch((error) => {
        emitVisionFailure(deps, error)
      })

    return { ok: true, id: message.id, name: file.name, mime: file.type || 'image/png' }
  }

  return { ok: false, status: 415, error: 'unsupported file type or extension' }
}

function withUserText(userText: string | undefined, content: string): string {
  const text = userText?.trim()
  return text ? `${text}\n${content}` : content
}
