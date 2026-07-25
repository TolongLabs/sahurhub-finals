import { describe, expect, test } from 'bun:test'
import type { ServerMessage } from '../shared/protocol.ts'
import { createConversation, listMessages } from './db/dao.ts'
import { openDb } from './db/index.ts'
import { MockVoiceBackend } from './llm/mock-backend.ts'
import { MAX_UPLOAD_BYTES, handleUpload } from './upload.ts'

function setup() {
  const db = openDb(':memory:')
  const conv = createConversation(db)
  const backend = new MockVoiceBackend()
  const broadcasts: ServerMessage[] = []
  const spoken: string[] = []
  return {
    db,
    conv,
    backend,
    broadcasts,
    spoken,
    deps: {
      db,
      conversationId: conv.id,
      backend,
      broadcast: (m: ServerMessage) => broadcasts.push(m),
      speak: async (text: string) => {
        spoken.push(text)
      }
    }
  }
}

class FailingVisionBackend extends MockVoiceBackend {
  async describeImage(_imageBytes: Uint8Array, _mime: string): Promise<string> {
    throw new Error('qwen vision failed: 400')
  }
}

describe('handleUpload — text', () => {
  test('prefixes text-file content with the submitted composer text', async () => {
    const { db, conv, deps } = setup()
    const file = new File(['hello from a text upload'], 'notes.txt', { type: 'text/plain' })

    const result = await handleUpload(deps, file, 'Read this first')
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.name).toBe('notes.txt')

    const messages = listMessages(db, conv.id)
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({ kind: 'upload-text', content: 'Read this first\nhello from a text upload' })
  })

  test('char-caps an oversized text file at the boundary', async () => {
    const { db, conv, deps } = setup()
    const huge = 'x'.repeat(10_000)
    await handleUpload(deps, new File([huge], 'huge.txt', { type: 'text/plain' }))
    expect(listMessages(db, conv.id)[0]?.content.length).toBe(4000)
  })
})

describe('handleUpload — image', () => {
  test('passes composer text to vision and routes its mock reaction through the whole-text speaker', async () => {
    const { db, conv, deps, spoken } = setup()
    const file = new File([new Uint8Array([1, 2, 3])], 'photo.png', { type: 'image/png' })

    const result = await handleUpload(deps, file, 'What do you think?')
    expect(result.ok).toBe(true)

    const messages = listMessages(db, conv.id)
    expect(messages[0]).toMatchObject({ kind: 'upload-image', content: 'What do you think?\nphoto.png' })

    // the vision reaction is async (off the upload's critical path) — give
    // the fire-and-forget promise a tick to settle.
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(spoken).toEqual(['I can see you slacking off in that picture — get back to it!'])
  })

  test('persists and broadcasts an in-character fallback when vision fails', async () => {
    const { db, conv, deps, broadcasts } = setup()
    deps.backend = new FailingVisionBackend()
    const file = new File([new Uint8Array([1, 2, 3])], 'photo.png', { type: 'image/png' })

    const result = await handleUpload(deps, file)
    expect(result.ok).toBe(true)

    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(broadcasts).toContainEqual(
      expect.objectContaining({
        type: 'message',
        message: expect.objectContaining({
          role: 'assistant',
          content: 'My eyes failed me for a second — try that again.'
        })
      })
    )
    expect(listMessages(db, conv.id)[1]).toMatchObject({
      role: 'assistant',
      content: 'My eyes failed me for a second — try that again.'
    })
  })
})

describe('handleUpload — boundary rejection', () => {
  test('rejects an oversized file regardless of type', async () => {
    const { deps } = setup()
    const oversized = new Uint8Array(MAX_UPLOAD_BYTES + 1)
    const file = new File([oversized], 'big.txt', { type: 'text/plain' })
    const result = await handleUpload(deps, file)
    expect(result).toEqual({ ok: false, status: 413, error: 'file too large' })
  })

  test('rejects a disallowed extension even with an allowlisted mime type', async () => {
    const { deps } = setup()
    const file = new File(['echo hi'], 'script.sh', { type: 'text/plain' })
    const result = await handleUpload(deps, file)
    expect(result).toEqual({ ok: false, status: 415, error: 'unsupported file type or extension' })
  })

  test('rejects a disallowed mime/extension entirely (e.g. a binary blob)', async () => {
    const { deps } = setup()
    const file = new File([new Uint8Array([0, 1, 2])], 'app.exe', { type: 'application/octet-stream' })
    const result = await handleUpload(deps, file)
    expect(result.ok).toBe(false)
  })
})
