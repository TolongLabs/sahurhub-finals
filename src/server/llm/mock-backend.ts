// Deterministic, scripted VoiceBackend (docs/plan.md T11 item 6). Used by
// EVERY test in this repo and as the runtime default whenever
// DASHSCOPE_API_KEY is unset (docs/plan.md: "used by ALL tests and the
// default when no DASHSCOPE_API_KEY"). No network calls, no randomness.

import type { CompiledPrompt } from '../persona/prompt.ts'
import type { GenerateOptions, VoiceBackend } from './voice-backend.ts'

function lastUserLine(volatile: string): string {
  return (
    volatile
      .split('\n')
      .filter((line) => line.startsWith('user: '))
      .at(-1)
      ?.slice('user: '.length)
      .trim() ?? ''
  )
}

function activeTaskId(volatile: string): string | null {
  const match = /^- \[([^\]]+)] .* \(\d+m, status=/m.exec(volatile)
  return match?.[1] ?? null
}

// A task-capture-shaped utterance: "<name> in <N> minutes" (case-insensitive,
// mirrors the conversational phrasing the intent classifier is meant to
// catch without an explicit "add task" command).
const TASK_PHRASE = /^(.*?)\s+in\s+(\d+)\s*(?:minutes?|mins?|m)\b/i

function scriptedReply(userLine: string, volatile: string): string {
  if (!userLine) {
    return '<|emotion:neutral|>Cold start — what do you need to get done today?'
  }
  const taskMatch = TASK_PHRASE.exec(userLine)
  if (taskMatch) {
    const name = (taskMatch[1] ?? 'that thing').trim().slice(0, 60)
    const minutes = taskMatch[2]
    return `<|emotion:smug|>Got it — ${name} in ${minutes} minutes. <|task:${name}|${minutes}|>I'll come knocking.`
  }
  if (/\b(done|submitted|finished|completed)\b/i.test(userLine)) {
    const taskId = activeTaskId(volatile)
    return taskId
      ? `<|emotion:happy|>Nice work, that is one less thing hanging over you. <|task_done:${taskId}|>`
      : '<|emotion:happy|>Nice work, that is one less thing hanging over you.'
  }
  return "<|emotion:happy|>Heard you loud and clear — what's next on the list?"
}

async function* fakePcm(chunkCount: number): AsyncGenerator<Uint8Array> {
  for (let i = 0; i < chunkCount; i++) {
    const chunk = new Uint8Array(16)
    for (let j = 0; j < chunk.length; j++) chunk[j] = (i * 7 + j) % 256
    yield chunk
    await Promise.resolve()
  }
}

export class MockVoiceBackend implements VoiceBackend {
  readonly name = 'mock'

  async generateReply(
    prompt: CompiledPrompt,
    onToken: (delta: string) => void,
    opts?: GenerateOptions
  ): Promise<string> {
    const reply = prompt.volatile.includes('Scheduler trigger: tick')
      ? '<|emotion:smug|>Reminder time — the task is still waiting, and so is my mallet.'
      : scriptedReply(lastUserLine(prompt.volatile), prompt.volatile)
    const chunkSize = 12
    let emitted = ''
    for (let i = 0; i < reply.length; i += chunkSize) {
      if (opts?.signal?.aborted) {
        const err = new Error('generation aborted')
        err.name = 'AbortError'
        throw err
      }
      const delta = reply.slice(i, i + chunkSize)
      emitted += delta
      onToken(delta)
      await Promise.resolve()
    }
    return emitted
  }

  async *synthesize(text: string, opts?: GenerateOptions): AsyncGenerator<Uint8Array> {
    const chunkCount = Math.max(1, Math.ceil(text.length / 20))
    for (const chunk of iterateFakePcm(chunkCount)) {
      if (opts?.signal?.aborted) return
      yield chunk
      await Promise.resolve()
    }
  }

  async transcribe(_audio: Uint8Array): Promise<string> {
    return '(mock transcript)'
  }

  async generateTitle(firstUserMessage: string, _firstReply: string): Promise<string> {
    const trimmed = firstUserMessage.trim()
    if (!trimmed) return 'New conversation'
    return trimmed.length > 40 ? `${trimmed.slice(0, 37)}...` : trimmed
  }

  async describeImage(_imageBytes: Uint8Array, _mime: string, _userText?: string): Promise<string> {
    return 'I can see you slacking off in that picture — get back to it!'
  }
}

function* iterateFakePcm(chunkCount: number): Generator<Uint8Array> {
  for (let i = 0; i < chunkCount; i++) {
    const chunk = new Uint8Array(16)
    for (let j = 0; j < chunk.length; j++) chunk[j] = (i * 7 + j) % 256
    yield chunk
  }
}

void fakePcm // kept for reference parity with the async-generator shape above; unused directly
