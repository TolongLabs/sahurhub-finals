// Leg 6 — qwen3.5-omni-plus-realtime over WebSocket. Protocol mirrors
// OpenAI's Realtime API (confirmed empirically: session.created on connect,
// input_audio_buffer.append/commit, response.create, response.audio.delta).
// Feeds the 3 TTS wavs from tts-probe.ts (cycled to 5 turns) as prerecorded
// input speech — no mic needed — and applies the T4 promotion gate.

import { join } from 'node:path'
import { API_KEY, MODELS, REALTIME_WS_URL, percentile } from './config.ts'

const OUT_DIR = join(import.meta.dir, 'out')
const WAV_HEADER_BYTES = 44

// The exact inline tag grammar (docs/trd.md §3.4) the system prompt uses in
// production, so we can check whether it ever gets vocalized/echoed by the
// realtime voice output.
const TAG_GRAMMAR_INSTRUCTIONS =
  'You are Sahur, an energetic wake-up character. You may include inline control tags in your ' +
  'reply text such as <|emotion:smug|>, <|tung:2|>, <|escalate|>, and <|task:sleep|30|>. ' +
  'These tags are machine instructions — NEVER speak the tag syntax itself aloud; only speak the ' +
  'natural-language words around them. Keep replies to one short energetic sentence.'

function stripWavHeader(bytes: Uint8Array): Uint8Array {
  return bytes.subarray(WAV_HEADER_BYTES)
}

// Bun's WebSocket client accepts a non-standard { headers } options object
// as the second constructor argument (verified empirically) — needed since
// realtime auth is a Bearer header, not a query param or subprotocol. Not
// part of lib.dom's WebSocket types, hence the narrow local constructor type.
type BunWebSocketCtor = new (url: string, options: { headers: Record<string, string> }) => WebSocket
const BunWebSocket = WebSocket as unknown as BunWebSocketCtor

function openSession(): Promise<{ ws: WebSocket; connectMs: number }> {
  return new Promise((resolve, reject) => {
    const start = performance.now()
    const ws = new BunWebSocket(`${REALTIME_WS_URL}?model=${MODELS.realtime}`, {
      headers: { Authorization: `Bearer ${API_KEY}` }
    })
    const timeout = setTimeout(() => reject(new Error('connect timeout')), 8000)
    ws.onmessage = (e) => {
      const msg = JSON.parse(String(e.data))
      if (msg.type === 'session.created') {
        clearTimeout(timeout)
        ws.onmessage = null
        resolve({ ws, connectMs: performance.now() - start })
      }
    }
    ws.onerror = (e) => {
      clearTimeout(timeout)
      reject(new Error(String((e as unknown as { message?: string }).message ?? 'ws error')))
    }
  })
}

interface TurnResult {
  firstAudioMs: number
  transcript: string
  tagLeak: boolean
}

function runTurn(ws: WebSocket, pcm: Uint8Array): Promise<TurnResult> {
  return new Promise((resolve, reject) => {
    let commitAt = 0
    let firstAudioMs = Number.NaN
    let transcript = ''
    let settled = false
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true
        ws.onmessage = null
        resolve({ firstAudioMs, transcript, tagLeak: /<\|[a-z_]+[:|]/i.test(transcript) })
      }
    }, 12000)

    ws.onmessage = (e) => {
      const msg = JSON.parse(String(e.data))
      if (msg.type === 'response.audio.delta' && Number.isNaN(firstAudioMs)) {
        firstAudioMs = performance.now() - commitAt
      }
      if (msg.type === 'response.audio_transcript.delta' && typeof msg.delta === 'string') {
        transcript += msg.delta
      }
      if (msg.type === 'response.done') {
        clearTimeout(timeout)
        if (!settled) {
          settled = true
          ws.onmessage = null
          resolve({ firstAudioMs, transcript, tagLeak: /<\|[a-z_]+[:|]/i.test(transcript) })
        }
      }
      if (msg.type === 'error') {
        clearTimeout(timeout)
        if (!settled) {
          settled = true
          ws.onmessage = null
          reject(new Error(`realtime error event: ${JSON.stringify(msg).slice(0, 300)}`))
        }
      }
    }

    // Base64 in reasonably sized chunks; DashScope/OpenAI-style servers
    // accept multiple input_audio_buffer.append events before commit.
    const chunkSize = 32000
    for (let i = 0; i < pcm.length; i += chunkSize) {
      const chunk = pcm.subarray(i, i + chunkSize)
      ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: Buffer.from(chunk).toString('base64') }))
    }
    ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }))
    commitAt = performance.now()
    ws.send(JSON.stringify({ type: 'response.create' }))
  })
}

async function main() {
  console.log(`[realtime-probe] model=${MODELS.realtime} url=${REALTIME_WS_URL}`)

  const { ws, connectMs } = await openSession()
  console.log(`  initial connect: ${connectMs.toFixed(0)}ms (session.created received)`)

  ws.send(
    JSON.stringify({
      type: 'session.update',
      session: {
        voice: 'Ethan',
        instructions: TAG_GRAMMAR_INSTRUCTIONS,
        turn_detection: null,
        modalities: ['text', 'audio']
      }
    })
  )
  await new Promise((r) => setTimeout(r, 300)) // let session.update settle

  const wavPaths = [1, 2, 3, 1, 2].map((n) => join(OUT_DIR, `phrase-${n}.wav`))
  const results: TurnResult[] = []
  for (let i = 0; i < wavPaths.length; i++) {
    const bytes = new Uint8Array(await Bun.file(wavPaths[i]).arrayBuffer())
    const pcm = stripWavHeader(bytes)
    try {
      const r = await runTurn(ws, pcm)
      results.push(r)
      console.log(
        `  turn ${i + 1}: firstAudio=${r.firstAudioMs.toFixed(0)}ms tagLeak=${r.tagLeak} transcript=${JSON.stringify(r.transcript.slice(0, 120))}`
      )
    } catch (err) {
      console.log(`  turn ${i + 1}: FAILED ${(err as Error).message}`)
    }
  }

  const firstAudioMsAll = results.map((r) => r.firstAudioMs).filter((v) => !Number.isNaN(v))
  firstAudioMsAll.sort((a, b) => a - b)
  const anyTagLeak = results.some((r) => r.tagLeak)
  console.log(
    `[realtime-probe] first-audio P50=${percentile(firstAudioMsAll, 50).toFixed(0)}ms P95=${percentile(firstAudioMsAll, 95).toFixed(0)}ms tagLeak=${anyTagLeak}`
  )

  ws.close()

  // Reconnect-after-stall test: close abruptly, wait 5s (simulated hotspot
  // drop), then measure time to a fresh session.created.
  await new Promise((r) => setTimeout(r, 5000))
  const reconnectStart = performance.now()
  try {
    const { connectMs: reconnectMs } = await openSession()
    console.log(`[realtime-probe] reconnect after 5s stall: ${(performance.now() - reconnectStart).toFixed(0)}ms`)
    void reconnectMs
  } catch (err) {
    console.log(`[realtime-probe] reconnect FAILED: ${(err as Error).message}`)
  }
}

main().catch((err) => {
  console.error('[realtime-probe] fatal', err)
  process.exit(1)
})
