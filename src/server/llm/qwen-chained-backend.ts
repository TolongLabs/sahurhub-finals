// UNTESTED-LIVE — coded fully per docs/trd.md §2/§3.10 but never exercised
// against a real Qwen key (no DASHSCOPE_API_KEY is registered yet; T4 owns
// probing these endpoints for real). The realtime backend is T4-gated and
// NOT built here — this is the fully-built, rehearsed CHAINED fallback:
// qwen3-asr-flash (audio->text) -> qwen3.6-flash (chat streaming, think-mode
// off) -> qwen3-tts-flash (text->audio), all via the DashScope
// OpenAI-compatible endpoint (Intl/Singapore region, docs/trd.md §4).
//
// PTT audio-format note (T11 reconciliation with T10a): the remote sends
// `audio/webm;codecs=opus` chunks (MediaRecorder timeslice), NOT 16kHz PCM —
// `transcribe()` below forwards the raw bytes with that mime type; DashScope's
// ASR input accepts common container/codec formats via a data URI, so no
// client-side re-encoding is assumed necessary. Verify at the T4 spike.
//
// JSON-mode gotchas (ported from Kawan's backend/app/chutes.py, per
// docs/plan.md T11 item 6): reasoning models blow up under strict
// `json_schema` decoding, so any structured call here (title generation only
// — the primary output format is tags-in-prose, not JSON) uses
// `response_format: json_object` + `chat_template_kwargs:{enable_thinking:
// false}` with an instance example in-prompt, and parses via json-extract.ts's
// ported `_extract_json` (strips <think>/fences, balanced-brace scan).

import type { CompiledPrompt } from '../persona/prompt.ts'
import { extractJson } from './json-extract.ts'
import type { GenerateOptions, VoiceBackend } from './voice-backend.ts'

// Documented Alibaba Cloud Model Studio (Intl/Singapore) root per docs/trd.md
// §2/§4. Some accounts (T4 spike) are provisioned on a dedicated/personal
// MaaS gateway instead — QWEN_BASE_URL overrides the root for those, without
// changing the documented default for everyone else.
const DEFAULT_QWEN_BASE_URL = 'https://dashscope-intl.aliyuncs.com'

export function resolveQwenBaseUrl(explicit?: string): string {
  return explicit ?? process.env.QWEN_BASE_URL ?? DEFAULT_QWEN_BASE_URL
}

export interface QwenChainedBackendConfig {
  apiKey: string
  chatModel?: string
  visionModel?: string
  asrModel?: string
  ttsModel?: string
  ttsVoice?: string
  baseUrl?: string
}

export class QwenChainedBackend implements VoiceBackend {
  readonly name = 'qwen-chained'
  private readonly apiKey: string
  private readonly chatModel: string
  private readonly visionModel: string
  private readonly asrModel: string
  private readonly ttsModel: string
  private readonly ttsVoice: string
  private readonly compatibleUrl: string
  private readonly multimodalUrl: string

  constructor(config: QwenChainedBackendConfig) {
    if (!config.apiKey) throw new Error('QwenChainedBackend requires a DASHSCOPE_API_KEY')
    this.apiKey = config.apiKey
    this.chatModel = config.chatModel ?? 'qwen3.6-flash'
    this.visionModel = config.visionModel ?? 'qwen3-vl-flash'
    this.asrModel = config.asrModel ?? 'qwen3-asr-flash'
    this.ttsModel = config.ttsModel ?? 'qwen3-tts-flash'
    // T4 live spike (spikes/qwen-probe/NOTES.md §2 Leg 3): this gateway
    // rejects TTS requests with no voice at all (400 "voice property is
    // required") — Ethan is the spike's chosen Sahur-fitting voice.
    this.ttsVoice = config.ttsVoice ?? 'Ethan'
    const baseUrl = resolveQwenBaseUrl(config.baseUrl)
    this.compatibleUrl = `${baseUrl}/compatible-mode/v1`
    this.multimodalUrl = `${baseUrl}/api/v1/services/aigc/multimodal-generation/generation`
  }

  private authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' }
  }

  async generateReply(
    prompt: CompiledPrompt,
    onToken: (delta: string) => void,
    opts?: GenerateOptions
  ): Promise<string> {
    const res = await fetch(`${this.compatibleUrl}/chat/completions`, {
      method: 'POST',
      headers: this.authHeaders(),
      signal: opts?.signal,
      body: JSON.stringify({
        model: this.chatModel,
        stream: true,
        chat_template_kwargs: { enable_thinking: false },
        messages: [
          { role: 'system', content: prompt.stable },
          { role: 'user', content: prompt.volatile }
        ]
      })
    })
    if (!res.ok || !res.body) throw new Error(`qwen chat completions failed: ${res.status}`)

    let full = ''
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
          const parsed = JSON.parse(payload) as { choices?: [{ delta?: { content?: string } }] }
          const delta = parsed.choices?.[0]?.delta?.content
          if (delta) {
            full += delta
            onToken(delta)
          }
        } catch {
          // a non-JSON SSE keepalive line — ignore
        }
      }
    }
    return full
  }

  async *synthesize(text: string, opts?: GenerateOptions): AsyncGenerator<Uint8Array> {
    // qwen3-tts-flash: single-shot synthesis (no server-side streaming
    // multipart in the documented API), returned as one base64 audio blob —
    // chunked here client-side so downstream playback stays a streaming path.
    // T4 live spike (spikes/qwen-probe/NOTES.md gotcha #1): this gateway
    // returns output.audio.url (an OSS-hosted wav) with data:"" instead of
    // inline base64 — prefer inline data when present, else fetch the URL.
    const res = await fetch(this.multimodalUrl, {
      method: 'POST',
      headers: this.authHeaders(),
      signal: opts?.signal,
      body: JSON.stringify({
        model: this.ttsModel,
        input: { text, voice: opts?.voiceId ?? this.ttsVoice },
        parameters: { audio_format: 'pcm', sample_rate: 24000 }
      })
    })
    if (!res.ok) throw new Error(`qwen tts failed: ${res.status}`)
    const body = (await res.json()) as { output?: { audio?: { data?: string; url?: string } } }
    const b64 = body.output?.audio?.data
    const url = body.output?.audio?.url
    let bytes: Buffer
    if (b64) {
      bytes = Buffer.from(b64, 'base64')
    } else if (url) {
      const timeoutSignal = AbortSignal.timeout(10_000)
      const signal = opts?.signal ? AbortSignal.any([opts.signal, timeoutSignal]) : timeoutSignal
      const audioRes = await fetch(url, { signal })
      if (!audioRes.ok) throw new Error(`qwen tts audio url fetch failed: ${audioRes.status}`)
      bytes = Buffer.from(await audioRes.arrayBuffer())
    } else {
      throw new Error('qwen tts response had no audio data or url')
    }
    const chunkSize = 4096
    for (let i = 0; i < bytes.length; i += chunkSize) {
      if (opts?.signal?.aborted) return
      yield new Uint8Array(bytes.subarray(i, i + chunkSize))
    }
  }

  async transcribe(audio: Uint8Array, opts?: GenerateOptions): Promise<string> {
    // See the file-header note: audio arrives as audio/webm;codecs=opus.
    const dataUri = `data:audio/webm;base64,${Buffer.from(audio).toString('base64')}`
    const res = await fetch(this.multimodalUrl, {
      method: 'POST',
      headers: this.authHeaders(),
      signal: opts?.signal,
      body: JSON.stringify({
        model: this.asrModel,
        input: { messages: [{ role: 'user', content: [{ audio: dataUri }] }] }
      })
    })
    if (!res.ok) throw new Error(`qwen asr failed: ${res.status}`)
    const body = (await res.json()) as {
      output?: { choices?: [{ message?: { content?: string | Array<{ text?: string }> } }] }
    }
    // T4 live spike (spikes/qwen-probe/NOTES.md gotcha #2): this gateway
    // returns message.content as an array of {text} parts, not a string.
    const content = body.output?.choices?.[0]?.message?.content
    return Array.isArray(content) ? content.map((part) => part.text ?? '').join('') : (content ?? '')
  }

  async generateTitle(firstUserMessage: string, firstReply: string): Promise<string> {
    const res = await fetch(`${this.compatibleUrl}/chat/completions`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify({
        model: this.chatModel,
        response_format: { type: 'json_object' },
        chat_template_kwargs: { enable_thinking: false },
        messages: [
          {
            role: 'system',
            content:
              'Give this conversation a short title: under 6 words, no trailing punctuation. Reply with ONLY a JSON object of the form {"title": "your title here"}.'
          },
          { role: 'user', content: `User: ${firstUserMessage}\nAssistant: ${firstReply}` }
        ]
      })
    })
    if (!res.ok) throw new Error(`qwen title generation failed: ${res.status}`)
    const body = (await res.json()) as { choices?: [{ message?: { content?: string } }] }
    const content = body.choices?.[0]?.message?.content ?? '{}'
    const parsed = extractJson(content) as { title?: string }
    const title = typeof parsed.title === 'string' ? parsed.title.trim() : ''
    if (!title) throw new Error(`title generation returned no title: ${content.slice(0, 120)}`)
    return title
  }

  async describeImage(imageBytes: Uint8Array, mime: string, userText?: string): Promise<string> {
    const dataUri = `data:${mime};base64,${Buffer.from(imageBytes).toString('base64')}`
    const res = await fetch(`${this.compatibleUrl}/chat/completions`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify({
        model: this.visionModel,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: dataUri } },
              {
                type: 'text',
                text: userText?.trim()
                  ? `React to this image and address the user message in one in-persona sentence. User message: ${userText.trim()}`
                  : 'React to this image in one in-persona sentence.'
              }
            ]
          }
        ]
      })
    })
    if (!res.ok) throw new Error(`qwen vision failed: ${res.status}: ${await res.text()}`)
    const body = (await res.json()) as { choices?: [{ message?: { content?: string } }] }
    return body.choices?.[0]?.message?.content ?? "I can't quite make that out, but I see you."
  }
}
