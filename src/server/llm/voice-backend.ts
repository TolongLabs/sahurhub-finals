// One `VoiceBackend` interface, two production backends max (docs/plan.md
// T11 item 6; docs/trd.md §3.10): `MockVoiceBackend` (deterministic, used by
// every test and the default with no DASHSCOPE_API_KEY) and
// `QwenChainedBackend` (real HTTP, coded fully but UNTESTED-LIVE — no key
// yet). The realtime backend is T4-gated, not this task — this interface is
// what it will plug into.

import type { CompiledPrompt } from '../persona/prompt.ts'

export interface GenerateOptions {
  signal?: AbortSignal
  voiceId?: string
}

export interface VoiceBackend {
  readonly name: string

  // Streams the reply (raw text, tags included) via `onToken`; resolves with
  // the full raw text once generation completes or is aborted.
  generateReply(prompt: CompiledPrompt, onToken: (delta: string) => void, opts?: GenerateOptions): Promise<string>

  // Text -> PCM chunks (TTS), streamed for low first-audio latency.
  synthesize(text: string, opts?: GenerateOptions): AsyncGenerator<Uint8Array>

  // Audio -> text (ASR); chained-backend only in practice.
  transcribe(audio: Uint8Array, opts?: GenerateOptions): Promise<string>

  // A separate, small, non-blocking call (docs/decisions.md — distinct from
  // the single-call intent classifier) that titles a conversation.
  generateTitle(firstUserMessage: string, firstReply: string): Promise<string>

  // The one async `inspect_camera`/upload-image vision lane (docs/trd.md
  // §3.9) — an in-persona reaction to an image, off the turn's critical path.
  describeImage(imageBytes: Uint8Array, mime: string, userText?: string): Promise<string>
}
