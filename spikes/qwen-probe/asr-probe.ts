// Leg 4 — qwen3-asr-flash closed-loop roundtrip: feed the 3 TTS wavs from
// tts-probe.ts back in as ASR input (no mic needed) and check transcription
// accuracy + latency.

import { join } from 'node:path'
import { MODELS, MULTIMODAL_URL, authHeaders } from './config.ts'

const OUT_DIR = join(import.meta.dir, 'out')

interface AsrResponse {
  output?: {
    choices?: [
      {
        message?: {
          // GOTCHA (see REPORT.md): content comes back as an ARRAY of parts
          // (`[{ text: "..." }]`), not a plain string — production
          // qwen-chained-backend.ts's transcribe() assumes a string and
          // would silently return the array object instead of text.
          content?: Array<{ text?: string }> | string
        }
      }
    ]
  }
  usage?: { seconds?: number }
  code?: string
  message?: string
}

const originals = [
  'Wake up, sahur time is almost over!',
  'Your terrible plan has summoned the drum council.',
  'Eat now or face the escalating knock.'
]

async function transcribe(path: string): Promise<{ ok: boolean; ms: number; text: string; raw: AsrResponse }> {
  const bytes = await Bun.file(path).arrayBuffer()
  const dataUri = `data:audio/wav;base64,${Buffer.from(bytes).toString('base64')}`
  const start = performance.now()
  const res = await fetch(MULTIMODAL_URL, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      model: MODELS.asr,
      input: { messages: [{ role: 'user', content: [{ audio: dataUri }] }] }
    })
  })
  const ms = performance.now() - start
  const raw = (await res.json().catch(() => ({}))) as AsrResponse
  const content = raw.output?.choices?.[0]?.message?.content
  const text = Array.isArray(content) ? (content.map((c) => c.text ?? '').join('') ?? '') : (content ?? '')
  return { ok: res.ok && !!text, ms, text, raw }
}

async function main() {
  console.log(`[asr-probe] model=${MODELS.asr}`)
  const latencies: number[] = []
  let totalSeconds = 0
  for (let i = 0; i < originals.length; i++) {
    const path = join(OUT_DIR, `phrase-${i + 1}.wav`)
    const r = await transcribe(path)
    if (!r.ok) {
      console.log(`  phrase ${i + 1}: FAILED code=${r.raw.code} message=${r.raw.message}`)
      continue
    }
    latencies.push(r.ms)
    totalSeconds += r.raw.usage?.seconds ?? 0
    console.log(`  phrase ${i + 1}: (${r.ms.toFixed(0)}ms, ${r.raw.usage?.seconds ?? '?'}s billed)`)
    console.log(`    original:     ${JSON.stringify(originals[i])}`)
    console.log(`    transcribed:  ${JSON.stringify(r.text)}`)
  }
  if (latencies.length) {
    const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length
    console.log(`[asr-probe] avg latency: ${avg.toFixed(0)}ms; total billed seconds: ${totalSeconds}`)
  }
}

main().catch((err) => {
  console.error('[asr-probe] fatal', err)
  process.exit(1)
})
