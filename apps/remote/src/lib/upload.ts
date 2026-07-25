// File upload — text/image only (docs/decisions.md 2026-07-15 "Remote chat
// file upload"). The plan leaves the transport as "implementer's call"
// (multipart POST or WS binary); this picks a multipart POST to `/upload`
// so the upload doesn't need to share the chat WS connection at all.
//
// TODO(T11): `/upload` doesn't exist on the server yet. FLAGGED contract —
// T11's "File upload — boundary validation + routing" task owns the real
// endpoint: `POST /upload`, `multipart/form-data` with a single `file` field,
// server re-validates the same mime/extension allowlist + size cap (never
// trust the client), routes images into the async vision lane / text files
// (char-capped) into the active conversation's L4, and records a `messages`
// row. Expected response used here: `{ id, name, mime }` on success.

export const UPLOAD_ACCEPT = 'text/*,image/*'
export const UPLOAD_MAX_BYTES = 5 * 1024 * 1024

export function isAllowedUpload(file: File): boolean {
  const allowedType = file.type.startsWith('text/') || file.type.startsWith('image/')
  return allowedType && file.size <= UPLOAD_MAX_BYTES
}

export interface UploadResult {
  id: string
  name: string
  mime: string
}

export async function uploadFile(file: File, text: string): Promise<UploadResult> {
  const form = new FormData()
  form.append('file', file)
  form.append('text', text)
  const res = await fetch('/upload', { method: 'POST', body: form })
  if (!res.ok) throw new Error(`upload failed: ${res.status}`)
  return (await res.json()) as UploadResult
}
