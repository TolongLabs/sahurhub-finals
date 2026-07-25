// Builds the server-side application context (db, kernel, character
// registry, VoiceBackend) that src/server/index.ts wires onto the WS/HTTP
// layer. Kept separate from index.ts so the wiring decision (Mock vs Qwen
// chained backend and DB path) is unit-testable without
// spinning up a real Bun.serve().

import { openDb } from './db/index.ts'
import { AgentKernel } from './kernel/kernel.ts'
import { MockVoiceBackend } from './llm/mock-backend.ts'
import { QwenChainedBackend } from './llm/qwen-chained-backend.ts'
import type { VoiceBackend } from './llm/voice-backend.ts'
import { CharacterRegistry } from './persona/registry.ts'

export interface AppContext {
  db: ReturnType<typeof openDb>
  kernel: AgentKernel
  characters: CharacterRegistry
  backend: VoiceBackend
}

export interface AppContextOptions {
  dbPath?: string
  charactersDir?: string
  // Injectable so tests never depend on a real DASHSCOPE_API_KEY (docs/plan.md
  // T11 quality bar: MockVoiceBackend is the default and the sole tested path).
  backend?: VoiceBackend
}

function selectBackend(opts: AppContextOptions): VoiceBackend {
  if (opts.backend) return opts.backend
  const apiKey = process.env.DASHSCOPE_API_KEY
  if (!apiKey) return new MockVoiceBackend()
  // UNTESTED-LIVE (docs/plan.md T11 item 6) — never exercised without a real key.
  return new QwenChainedBackend({
    apiKey,
    chatModel: process.env.QWEN_CHAT_MODEL,
    visionModel: process.env.QWEN_VISION_MODEL,
    asrModel: process.env.QWEN_ASR_MODEL,
    ttsModel: process.env.QWEN_TTS_MODEL
  })
}

export function createAppContext(opts: AppContextOptions = {}): AppContext {
  const db = openDb(opts.dbPath ?? 'sahurhub.sqlite')
  const kernel = new AgentKernel(db)
  const characters = new CharacterRegistry(opts.charactersDir ?? 'characters')
  const backend = selectBackend(opts)
  kernel.rebuild()
  return { db, kernel, characters, backend }
}
