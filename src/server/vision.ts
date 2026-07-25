import type { Database } from 'bun:sqlite'
import type { ServerMessage } from '../shared/protocol.ts'
import { insertMessage } from './db/dao.ts'

export const VISION_FAILURE_FALLBACK = 'My eyes failed me for a second — try that again.'

interface VisionFailureDeps {
  db: Database
  conversationId: string
  broadcast: (message: ServerMessage) => void
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function emitVisionFailure(deps: VisionFailureDeps, error: unknown): void {
  console.error(`vision lane failed: ${errorMessage(error)}`)
  try {
    const reply = insertMessage(deps.db, {
      conversationId: deps.conversationId,
      role: 'assistant',
      content: VISION_FAILURE_FALLBACK,
      kind: 'text'
    })
    deps.broadcast({
      type: 'message',
      message: {
        id: reply.id,
        conversationId: reply.conversationId,
        role: reply.role,
        content: reply.content,
        kind: reply.kind,
        ts: reply.ts
      }
    })
  } catch (fallbackError) {
    console.error(`vision fallback failed: ${errorMessage(fallbackError)}`)
  }
}
