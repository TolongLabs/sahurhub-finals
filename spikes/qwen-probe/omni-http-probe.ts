// Leg 5 — qwen3.5-omni-plus HTTP (non-realtime Omni, fallback rung 2),
// one text-in/audio-out call via the OpenAI-compatible /chat/completions
// endpoint with modalities:["text","audio"].
//
// GOTCHA (see REPORT.md): on this gateway, both streaming and non-streaming
// requests accept the audio modality (no error) and bill audio_tokens in
// usage, but never populate actual audio bytes — non-streaming responses
// have no `message.audio` field at all, and streaming `delta.audio` chunks
// only ever carry an empty `transcript`, never a `data` field. Confirmed by
// probing both modes below.

import { COMPATIBLE_URL, MODELS, authHeaders } from './config.ts'

interface ChatResponse {
  choices?: [{ message?: { content?: string; audio?: unknown } }]
  usage?: Record<string, unknown>
}

async function nonStreaming() {
  const start = performance.now()
  const res = await fetch(`${COMPATIBLE_URL}/chat/completions`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      model: MODELS.omniHttp,
      modalities: ['text', 'audio'],
      audio: { voice: 'Ethan', format: 'wav' },
      messages: [{ role: 'user', content: 'Say one short energetic sentence waking someone up for sahur.' }]
    })
  })
  const ms = performance.now() - start
  const body = (await res.json()) as ChatResponse
  const message = body.choices?.[0]?.message
  console.log(`  non-streaming: status=${res.status} ms=${ms.toFixed(0)}`)
  console.log(`    content: ${JSON.stringify(message?.content)}`)
  console.log(`    has audio field: ${message?.audio !== undefined}`)
  console.log(`    usage: ${JSON.stringify(body.usage ?? {})}`)
}

async function streaming() {
  const start = performance.now()
  const res = await fetch(`${COMPATIBLE_URL}/chat/completions`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      model: MODELS.omniHttp,
      modalities: ['text', 'audio'],
      audio: { voice: 'Ethan', format: 'wav' },
      stream: true,
      stream_options: { include_usage: true },
      messages: [{ role: 'user', content: 'Say hi.' }]
    })
  })
  if (!res.ok || !res.body) {
    console.log(`  streaming: FAILED status=${res.status}`)
    return
  }
  let firstAudioMs: number | undefined
  let audioChunks = 0
  let sawAudioData = false
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const payload = line.replace(/^data:\s*/, '').trim()
      if (!payload || payload === '[DONE]') continue
      try {
        const parsed = JSON.parse(payload) as { choices?: [{ delta?: { audio?: Record<string, unknown> } }] }
        const audio = parsed.choices?.[0]?.delta?.audio
        if (audio) {
          audioChunks++
          if (firstAudioMs === undefined) firstAudioMs = performance.now() - start
          if ('data' in audio) sawAudioData = true
        }
      } catch {
        // keepalive
      }
    }
  }
  console.log(
    `  streaming: audio-bearing chunks=${audioChunks} firstAudioDeltaMs=${firstAudioMs?.toFixed(0) ?? 'n/a'} sawRealAudioDataKey=${sawAudioData}`
  )
}

async function main() {
  console.log(`[omni-http-probe] model=${MODELS.omniHttp}`)
  await nonStreaming()
  await streaming()
}

main().catch((err) => {
  console.error('[omni-http-probe] fatal', err)
  process.exit(1)
})
