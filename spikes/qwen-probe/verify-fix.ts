// Throwaway live-verify script for the PG fast-lane fix to
// src/server/llm/qwen-chained-backend.ts (T4 gotchas #1/#2, NOTES.md).
// NOT part of the test suite — one-off confirmation against the real
// gateway, run manually, then discarded (kept in spikes/ for the record).
//
// Note: production `synthesize(text, opts)` has no voice parameter (only
// `text` is sent in the request body), so this can't force voice=Ethan
// through the real interface being fixed — the gateway's default voice is
// used instead. The bug under test (inline-data vs OSS-url response shape)
// is voice-independent, so this still verifies the actual fix.

import { join } from 'node:path'
import { QwenChainedBackend } from '../../src/server/llm/qwen-chained-backend.ts'

const apiKey = process.env.DASHSCOPE_API_KEY
if (!apiKey) throw new Error('DASHSCOPE_API_KEY is not set — copy .env.example to .env.local and fill it in')

const backend = new QwenChainedBackend({ apiKey })

async function verifySynthesize() {
  const text = 'Sahur time, wake up now!'
  console.log(`[verify-fix] synthesize(${JSON.stringify(text)}) via ${backend.name}`)
  const chunks: Uint8Array[] = []
  for await (const chunk of backend.synthesize(text)) chunks.push(chunk)
  const totalBytes = chunks.reduce((n, c) => n + c.length, 0)
  console.log(`[verify-fix] synthesize: received ${chunks.length} chunk(s), ${totalBytes} total bytes`)
  if (totalBytes === 0) throw new Error('synthesize returned zero audio bytes — fix did not work')
}

async function verifyTranscribe() {
  const wavPath = join(import.meta.dir, 'out', 'phrase-1.wav')
  const bytes = new Uint8Array(await Bun.file(wavPath).arrayBuffer())
  console.log(`[verify-fix] transcribe(${wavPath})`)
  const text = await backend.transcribe(bytes)
  console.log(`[verify-fix] transcribe: ${JSON.stringify(text)}`)
  if (typeof text !== 'string' || text.trim().length === 0)
    throw new Error('transcribe returned no text — fix did not work')
}

async function main() {
  await verifySynthesize()
  await verifyTranscribe()
  console.log('[verify-fix] both paths verified OK')
}

main().catch((err) => {
  console.error('[verify-fix] fatal', err)
  process.exit(1)
})
