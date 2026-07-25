// Leg 3 — qwen3-tts-flash voice verification + 3 short syntheses.
// Quota is scarce (10k CHARACTERS total on the free tier) so this script
// keeps every probe call to a handful of characters and only synthesizes
// the 3 real demo phrases (~50 chars each) once a working voice is picked.

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { MODELS, MULTIMODAL_URL, authHeaders } from './config.ts'

const OUT_DIR = join(import.meta.dir, 'out')
mkdirSync(OUT_DIR, { recursive: true })

interface TtsResponse {
  output?: { audio?: { data?: string; url?: string } }
  usage?: Record<string, unknown>
  code?: string
  message?: string
}

// GOTCHA (see REPORT.md): this gateway returns audio via output.audio.url
// (an OSS-hosted .wav, `data` comes back as ""), not inline base64 in
// output.audio.data as the production qwen-chained-backend.ts assumes.
// audio_format/sample_rate parameters appear to be ignored (URL is always
// .wav) — so a second fetch is needed to actually get bytes.
async function synth(
  text: string,
  voice?: string
): Promise<{ ok: boolean; ms: number; bytes: number; wavBytes?: Uint8Array; raw: TtsResponse }> {
  const start = performance.now()
  const res = await fetch(MULTIMODAL_URL, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      model: MODELS.tts,
      input: { text, ...(voice ? { voice } : {}) },
      parameters: { audio_format: 'pcm', sample_rate: 24000 }
    })
  })
  const ms = performance.now() - start
  const raw = (await res.json().catch(() => ({}))) as TtsResponse
  const b64 = raw.output?.audio?.data
  const url = raw.output?.audio?.url
  if (b64)
    return { ok: res.ok, ms, bytes: Buffer.from(b64, 'base64').length, wavBytes: Buffer.from(b64, 'base64'), raw }
  if (url) {
    const audioRes = await fetch(url)
    const buf = new Uint8Array(await audioRes.arrayBuffer())
    return { ok: res.ok && audioRes.ok, ms, bytes: buf.length, wavBytes: buf, raw }
  }
  return { ok: false, ms, bytes: 0, raw }
}

async function main() {
  console.log(`[tts-probe] model=${MODELS.tts}`)

  // Sahur-fitting candidates: male, energetic. Probed with a 2-char string
  // to minimize quota burn while confirming which voice IDs this account's
  // model actually accepts.
  const candidates = ['Ethan', 'Dylan', 'Chelsie']
  const working: string[] = []
  for (const voice of candidates) {
    const r = await synth('Hi', voice)
    console.log(
      `  candidate voice=${voice}: ${r.ok ? 'OK' : 'FAILED'} (${r.ms.toFixed(0)}ms)${r.ok ? '' : ` code=${r.raw.code} message=${r.raw.message}`}`
    )
    if (r.ok) working.push(voice)
  }

  const chosen = working[0] ?? undefined
  console.log(`[tts-probe] chosen voice: ${chosen ?? '(default — none of the candidates worked)'}`)

  const phrases = [
    'Wake up, sahur time is almost over!',
    'Your terrible plan has summoned the drum council.',
    'Eat now or face the escalating knock.'
  ]

  const firstByteMs: number[] = []
  for (let i = 0; i < phrases.length; i++) {
    const r = await synth(phrases[i], chosen)
    if (!r.ok || !r.wavBytes) {
      console.log(`  phrase ${i + 1}: FAILED code=${r.raw.code} message=${r.raw.message}`)
      continue
    }
    firstByteMs.push(r.ms)
    const path = join(OUT_DIR, `phrase-${i + 1}.wav`)
    await Bun.write(path, r.wavBytes)
    console.log(`  phrase ${i + 1}: OK (${r.ms.toFixed(0)}ms, ${r.bytes} wav bytes) -> ${path}`)
    console.log(`    usage: ${JSON.stringify(r.raw.usage ?? {})}`)
  }

  if (firstByteMs.length) {
    const avg = firstByteMs.reduce((a, b) => a + b, 0) / firstByteMs.length
    console.log(`[tts-probe] avg first-byte latency over ${firstByteMs.length} phrases: ${avg.toFixed(0)}ms`)
  }
}

main().catch((err) => {
  console.error('[tts-probe] fatal', err)
  process.exit(1)
})
