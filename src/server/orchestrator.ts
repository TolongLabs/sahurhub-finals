// The turn orchestrator (docs/plan.md T11 item 5): input (text/audio/upload,
// source-tagged) -> prompt -> VoiceBackend stream -> tag-split -> TTS chunks
// -> WS events. Barge-in cancellation + local latency enforcement
// (docs/trd.md §2.3): 4.5s no-cloud-TTS -> signal the client's WebSpeech
// fallback; 6.5s no-text -> a canned in-persona line. Cold-start opener +
// async, non-blocking title generation also live here.

import type { Database } from 'bun:sqlite'
import type { AgentEvent, EscalationLevel, InputSource, ServerMessage, TaskSummary } from '../shared/protocol.ts'
import {
  type TaskRow,
  countMessages,
  getConversation,
  insertMessage,
  listMessages,
  updateConversationTitle
} from './db/dao.ts'
import type { AgentKernel } from './kernel/kernel.ts'
import { SerializedEventQueue } from './kernel/queue.ts'
import { type ParsedTagEvent, TagDedupeGate, extractTags, splitStreaming, stripTagArtifacts } from './kernel/tags.ts'
import type { VoiceBackend } from './llm/voice-backend.ts'
import { type SchedulerTrigger, type VolatileState, compilePrompt } from './persona/prompt.ts'
import { type CharacterRegistry, pickPokeLine } from './persona/registry.ts'
import type { CharacterPreset } from './persona/types.ts'

export const TTS_FALLBACK_MS = 4500
export const CANNED_FALLBACK_MS = 6500
const RECENT_MESSAGE_WINDOW = 20
const SAMPLE_RATE = 24_000
const MIN_TTS_SENTENCE_CHARS = 12

export interface OrchestratorDeps {
  db: Database
  kernel: AgentKernel
  characters: CharacterRegistry
  backend: VoiceBackend
  broadcast: (message: ServerMessage) => void
  broadcastTts?: (message: ServerMessage) => void
  // Overridable so tests exercise the 4.5s/6.5s latency-enforcement paths
  // (docs/trd.md §2.3) without waiting real seconds; production callers
  // leave these at the spec'd defaults.
  ttsFallbackMs?: number
  cannedFallbackMs?: number
}

interface TurnInput {
  conversationId: string
  userText: string | null
  source: InputSource
  trigger: SchedulerTrigger
  startedAt?: number
  asrMs?: number
}

type QueuedTurn = () => Promise<void>

export function toTaskSummary(task: TaskRow): TaskSummary {
  return {
    taskId: task.taskId,
    taskName: task.taskName,
    duration: task.duration,
    status: task.status,
    escalation: task.escalation,
    nextWakeAt: task.nextWakeAt
  }
}

export class Orchestrator {
  private activeAbort: AbortController | null = null
  private lastEmotion = 'neutral'
  private readonly titleInFlight = new Set<string>()
  private readonly turnQueue = new SerializedEventQueue<QueuedTurn>()
  private queueDraining = false

  constructor(private readonly deps: OrchestratorDeps) {}

  interrupt(): void {
    this.activeAbort?.abort()
  }

  async handleColdStartIfNeeded(conversationId: string): Promise<void> {
    await this.enqueueTurn(async () => {
      if (countMessages(this.deps.db, conversationId) > 0) return
      await this.runTurn({ conversationId, userText: null, source: 'device', trigger: 'cold-start' })
    })
  }

  async handleUserText(input: {
    conversationId: string
    text: string
    source: InputSource
    startedAt?: number
    asrMs?: number
  }): Promise<void> {
    await this.enqueueTurn(async () => {
      insertMessage(this.deps.db, {
        conversationId: input.conversationId,
        role: 'user',
        content: input.text,
        kind: 'text'
      })
      await this.runTurn({
        conversationId: input.conversationId,
        userText: input.text,
        source: input.source,
        trigger: 'user',
        startedAt: input.startedAt,
        asrMs: input.asrMs
      })
    })
  }

  // Audio arrives as an already-transcribed-by-the-caller string (the WS
  // layer owns accumulating binary frames and calling backend.transcribe —
  // see src/server/index.ts) — this just threads the transcript + a
  // `transcript` event through the same path as typed text.
  async handleUserTranscript(input: {
    conversationId: string
    text: string
    source: InputSource
    startedAt?: number
    asrMs?: number
  }): Promise<void> {
    this.deps.broadcast({ type: 'transcript', conversationId: input.conversationId, text: input.text, final: true })
    await this.handleUserText(input)
  }

  async handleReminderTick(task: TaskRow): Promise<void> {
    const conversationId = task.conversationId
    if (!conversationId) return
    await this.enqueueTurn(async () => {
      await this.runTurn({ conversationId, userText: null, source: 'device', trigger: 'tick' })
    })
  }

  async handlePoke(conversationId: string): Promise<boolean> {
    // A poke barges in: abort the in-flight turn's generation/TTS and tell
    // clients to drop any buffered audio so the poke line cuts in clean.
    this.interrupt()
    this.deps.broadcast({ type: 'notice', conversationId, message: 'tts_interrupt' })
    let spoken = false
    await this.enqueueTurn(async () => {
      const conversation = getConversation(this.deps.db, conversationId)
      if (!conversation) return
      // Remote pokes get the same baton-swipe retaliation the kiosk touch
      // plays locally — broadcast before the spoken line so the swing lands
      // the instant the poke does.
      this.deps.broadcast({
        type: 'agent_event',
        conversationId,
        event: {
          id: crypto.randomUUID(),
          kind: 'poke',
          args: { intensity: 3 },
          animation: 'swipe',
          playbackCue: 'immediate'
        }
      })
      await this.speakWholeTextNow(conversationId, pickPokeLine(this.deps.characters.get(conversation.characterId)))
      spoken = true
    })
    return spoken
  }

  async speakWholeText(conversationId: string, text: string): Promise<void> {
    await this.enqueueTurn(() => this.speakWholeTextNow(conversationId, text))
  }

  private async speakWholeTextNow(conversationId: string, text: string): Promise<void> {
    const turnStartedAt = performance.now()
    const conversation = getConversation(this.deps.db, conversationId)
    if (!conversation) return
    const preset = this.deps.characters.get(conversation.characterId)

    insertMessage(this.deps.db, { conversationId, role: 'assistant', content: text, kind: 'text' })
    this.deps.broadcast({
      type: 'reply',
      conversationId,
      say: text,
      emotion: 'neutral',
      escalation: this.deps.kernel.currentEscalation(conversationId)
    })

    let ttsFirstMs: number | null = null
    try {
      for await (const chunk of this.deps.backend.synthesize(text, { voiceId: preset.manifest.voice.voiceId })) {
        if (ttsFirstMs === null) ttsFirstMs = Math.round(performance.now() - turnStartedAt)
        this.broadcastTtsChunk(conversationId, chunk)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.debug(`whole-text TTS unavailable: ${message}`)
    }

    this.deps.broadcast({ type: 'done', conversationId })
    this.logTurnTiming({
      llmFirstMs: null,
      llmTotalMs: null,
      ttsFirstMs,
      totalMs: Math.round(performance.now() - turnStartedAt)
    })
  }

  private buildVolatileState(turn: TurnInput): VolatileState {
    const conversationId = turn.conversationId
    const activeTasks = this.deps.kernel.listActiveTasks(conversationId)
    const recent = listMessages(this.deps.db, conversationId, { limit: RECENT_MESSAGE_WINDOW })
    return {
      tasks: activeTasks.map((t) => ({
        taskId: t.taskId,
        name: t.taskName,
        durationMinutes: t.duration,
        status: t.status,
        escalation: t.escalation
      })),
      escalation: this.deps.kernel.currentEscalation(conversationId),
      nextWakeAt: activeTasks.reduce<number | null>((min, t) => {
        if (t.nextWakeAt === null) return min
        return min === null ? t.nextWakeAt : Math.min(min, t.nextWakeAt)
      }, null),
      schedulerTrigger: turn.trigger,
      recentMessages: recent,
      recentActions: [],
      toolResult: null
    }
  }

  private dispatchEvent(event: ParsedTagEvent, preset: CharacterPreset, turn: TurnInput): void {
    const { conversationId } = turn
    switch (event.kind) {
      case 'emotion': {
        const name = event.args.name as string
        this.lastEmotion = name
        this.deps.broadcast({ type: 'avatar', conversationId, expression: name })
        return
      }
      case 'remind':
      case 'escalate': {
        const agentEvent: AgentEvent = {
          id: crypto.randomUUID(),
          kind: event.kind,
          args: event.args,
          animation: preset.manifest.actionMap[event.kind],
          playbackCue: 'audio-boundary'
        }
        this.deps.broadcast({ type: 'agent_event', conversationId, event: agentEvent })
        return
      }
      case 'schedule': {
        const agentEvent: AgentEvent = {
          id: crypto.randomUUID(),
          kind: 'schedule',
          args: event.args,
          playbackCue: 'immediate'
        }
        this.deps.broadcast({ type: 'agent_event', conversationId, event: agentEvent })
        return
      }
      case 'task': {
        if (turn.trigger !== 'user') return
        const captured = this.deps.kernel.captureTask({
          name: event.args.name as string,
          durationMinutes: event.args.duration as number,
          conversationId
        })
        if (captured) {
          this.deps.broadcast({
            type: 'task_list',
            conversationId,
            tasks: this.deps.kernel.listActiveTasks(conversationId).map(toTaskSummary)
          })
        }
        return
      }
      case 'task_done': {
        if (turn.trigger !== 'user') return
        const completed = this.deps.kernel.completeTaskFromName(event.args.name as string, conversationId)
        if (completed) {
          this.deps.broadcast({
            type: 'task_list',
            conversationId,
            tasks: this.deps.kernel.listActiveTasks(conversationId).map(toTaskSummary)
          })
          // Victory beat: lets the kiosk fire the completion sting.
          this.deps.broadcast({
            type: 'agent_event',
            conversationId,
            event: { id: crypto.randomUUID(), kind: 'task_done', args: {}, playbackCue: 'immediate' }
          })
        }
        return
      }
    }
  }

  private emitCannedFallback(
    preset: CharacterPreset,
    conversationId: string,
    timing: { startedAt: number; asrMs?: number }
  ): void {
    const line = pickCannedLine(preset)
    insertMessage(this.deps.db, { conversationId, role: 'assistant', content: line, kind: 'text' })
    this.deps.broadcast({
      type: 'reply',
      conversationId,
      say: line,
      emotion: 'neutral',
      escalation: this.deps.kernel.currentEscalation(conversationId)
    })
    this.deps.broadcast({ type: 'done', conversationId })
    this.logTurnTiming({
      asrMs: timing.asrMs,
      llmFirstMs: null,
      llmTotalMs: null,
      ttsFirstMs: null,
      totalMs: Math.round(performance.now() - timing.startedAt)
    })
  }

  private async runTurn(turn: TurnInput): Promise<void> {
    const turnStartedAt = turn.startedAt ?? performance.now()
    const abort = new AbortController()
    this.activeAbort = abort
    const conversation = getConversation(this.deps.db, turn.conversationId)
    if (!conversation) return
    const preset = this.deps.characters.get(conversation.characterId)
    const state = this.buildVolatileState(turn)
    const prompt = compilePrompt(preset, state)
    const dedupe = new TagDedupeGate()

    let pending = ''
    let cleanAccum = ''
    let sawAnyText = false
    let cannedFired = false
    let webSpeechFallbackFired = false
    let llmFirstAt: number | null = null
    let ttsFirstAt: number | null = null
    let ttsFirstMs: number | null = null
    let ttsChunkBroadcast = false
    let ttsPending = ''
    let ttsChain = Promise.resolve()
    const streamSentenceTts = turn.trigger !== 'tick'

    const queueTts = (text: string) => {
      const sentence = text.trim()
      if (!sentence || cannedFired || webSpeechFallbackFired || abort.signal.aborted) return
      if (ttsFirstAt === null) ttsFirstAt = performance.now()
      ttsChain = ttsChain.then(async () => {
        if (webSpeechFallbackFired || abort.signal.aborted) return
        for await (const chunk of this.deps.backend.synthesize(sentence, {
          signal: abort.signal,
          voiceId: preset.manifest.voice.voiceId
        })) {
          if (webSpeechFallbackFired || abort.signal.aborted) return
          if (ttsFirstMs === null && ttsFirstAt !== null) ttsFirstMs = Math.round(performance.now() - ttsFirstAt)
          ttsChunkBroadcast = true
          this.broadcastTtsChunk(turn.conversationId, chunk)
        }
      })
    }

    const queueCompleteSentences = (flush: boolean) => {
      for (;;) {
        const sentence = takeCompleteSentence(ttsPending)
        if (!sentence) break
        ttsPending = sentence.remainder
        queueTts(sentence.text)
      }
      if (flush && ttsPending.trim()) {
        queueTts(ttsPending)
        ttsPending = ''
      }
    }

    const cannedFallbackTimer = setTimeout(() => {
      if (!sawAnyText) {
        cannedFired = true
        this.emitCannedFallback(preset, turn.conversationId, { startedAt: turnStartedAt, asrMs: turn.asrMs })
      }
    }, this.deps.cannedFallbackMs ?? CANNED_FALLBACK_MS)
    const ttsFallbackTimer = setTimeout(() => {
      if (sawAnyText && !ttsChunkBroadcast) {
        webSpeechFallbackFired = true
        this.deps.broadcast({ type: 'notice', conversationId: turn.conversationId, message: 'tts_fallback:webspeech' })
      }
    }, this.deps.ttsFallbackMs ?? TTS_FALLBACK_MS)

    const onToken = (delta: string) => {
      if (llmFirstAt === null) llmFirstAt = performance.now()
      pending += delta
      const { clean, events, remainder } = splitStreaming(pending)
      pending = remainder
      const safeClean = stripTagArtifacts(clean)
      if (safeClean) {
        sawAnyText = true
        cleanAccum += safeClean
        this.deps.broadcast({ type: 'token', conversationId: turn.conversationId, text: safeClean })
        if (streamSentenceTts && !cannedFired) {
          ttsPending += safeClean
          queueCompleteSentences(false)
        }
      }
      for (const event of dedupe.filter(events)) this.dispatchEvent(event, preset, turn)
    }

    const llmStartedAt = performance.now()
    let llmTotalMs: number | null = null
    try {
      await this.deps.backend.generateReply(prompt, onToken, { signal: abort.signal })
      llmTotalMs = Math.round(performance.now() - llmStartedAt)
    } catch (err) {
      clearTimeout(cannedFallbackTimer)
      clearTimeout(ttsFallbackTimer)
      if (err instanceof Error && err.name === 'AbortError') return
      this.deps.broadcast({ type: 'error', message: 'generation failed' })
      return
    }
    clearTimeout(cannedFallbackTimer)
    clearTimeout(ttsFallbackTimer)
    if (cannedFired) return // the 6.5s fallback already closed this turn out

    const flush = extractTags(pending)
    const safeFlush = stripTagArtifacts(flush.clean)
    if (safeFlush) {
      sawAnyText = true
      cleanAccum += safeFlush
      this.deps.broadcast({ type: 'token', conversationId: turn.conversationId, text: safeFlush })
      if (streamSentenceTts && !cannedFired) {
        ttsPending += safeFlush
        queueCompleteSentences(false)
      }
    }
    for (const event of dedupe.filter(flush.events)) this.dispatchEvent(event, preset, turn)

    if (!cleanAccum && !sawAnyText) {
      // nothing usable came back at all (aborted mid-flight, or an empty
      // reply) — degrade gracefully rather than persisting an empty turn.
      return
    }

    const sayText = normalizeReplyText(stripTagArtifacts(cleanAccum))
    if (streamSentenceTts) queueCompleteSentences(true)
    else queueTts(sayText)
    insertMessage(this.deps.db, {
      conversationId: turn.conversationId,
      role: 'assistant',
      content: sayText,
      kind: 'text'
    })
    const escalation: EscalationLevel = this.deps.kernel.currentEscalation(turn.conversationId)
    this.deps.broadcast({
      type: 'reply',
      conversationId: turn.conversationId,
      say: sayText,
      emotion: this.lastEmotion,
      escalation
    })

    void this.maybeGenerateTitle(turn.conversationId, turn.userText, sayText)

    try {
      await ttsChain
    } catch (err) {
      if (abort.signal.aborted || (err instanceof Error && err.name === 'AbortError')) return
      throw err
    }
    if (abort.signal.aborted) return
    this.deps.broadcast({ type: 'done', conversationId: turn.conversationId })
    this.logTurnTiming({
      asrMs: turn.asrMs,
      llmFirstMs: llmFirstAt === null ? null : Math.round(llmFirstAt - llmStartedAt),
      llmTotalMs,
      ttsFirstMs,
      totalMs: Math.round(performance.now() - turnStartedAt)
    })
  }

  private enqueueTurn(run: QueuedTurn): Promise<void> {
    return new Promise((resolve, reject) => {
      this.turnQueue.enqueue(async () => {
        try {
          await run()
          resolve()
        } catch (error) {
          reject(error)
        }
      })
      void this.drainTurnQueue()
    })
  }

  private broadcastTtsChunk(conversationId: string, chunk: Uint8Array): void {
    const broadcastTts = this.deps.broadcastTts ?? this.deps.broadcast
    broadcastTts({
      type: 'tts_chunk',
      conversationId,
      data: Buffer.from(chunk).toString('base64'),
      sampleRate: SAMPLE_RATE
    })
  }

  private logTurnTiming(timing: {
    asrMs?: number
    llmFirstMs: number | null
    llmTotalMs: number | null
    ttsFirstMs: number | null
    totalMs: number
  }): void {
    const value = (ms: number | null) => (ms === null ? 'n/a' : `${ms}ms`)
    const asr = timing.asrMs === undefined ? '' : ` asr=${Math.round(timing.asrMs)}ms`
    console.log(
      `turn timing:${asr} llm_first=${value(timing.llmFirstMs)} llm_total=${value(timing.llmTotalMs)} tts_first=${value(timing.ttsFirstMs)} total=${timing.totalMs}ms`
    )
  }

  private async drainTurnQueue(): Promise<void> {
    if (this.queueDraining) return
    this.queueDraining = true
    try {
      while (this.turnQueue.size > 0) await (await this.turnQueue.dequeue())()
    } finally {
      this.queueDraining = false
      if (this.turnQueue.size > 0) void this.drainTurnQueue()
    }
  }

  private async maybeGenerateTitle(conversationId: string, userText: string | null, replyText: string): Promise<void> {
    if (!userText) return // the cold-start opener has no user text to title from yet
    const conv = getConversation(this.deps.db, conversationId)
    if (!conv || (conv.title && conv.title !== 'New conversation') || this.titleInFlight.has(conversationId)) return
    this.titleInFlight.add(conversationId)
    // Fire-and-forget: never blocks the turn (docs/decisions.md — a
    // deliberate second, cheap, non-blocking call, distinct from the
    // single-call intent classifier).
    void this.deps.backend
      .generateTitle(userText, replyText)
      .then((title) => {
        const safeTitle = title.trim().slice(0, 60)
        if (!safeTitle) throw new Error('title generation returned no title')
        updateConversationTitle(this.deps.db, conversationId, safeTitle)
        this.deps.broadcast({ type: 'title', conversationId, title: safeTitle })
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        console.error(`title generation failed for conversation ${conversationId}: ${message}`)
      })
      .finally(() => {
        this.titleInFlight.delete(conversationId)
      })
  }
}

function pickCannedLine(preset: CharacterPreset): string {
  return `${preset.manifest.name} lost the signal for a second — say that again?`
}

function normalizeReplyText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function takeCompleteSentence(text: string): { text: string; remainder: string } | null {
  const boundary = /[.!?]|\n(?=\s|$)/g
  for (const match of text.matchAll(boundary)) {
    const end = (match.index ?? 0) + match[0].length
    const sentence = text.slice(0, end)
    if (sentence.trim().length >= MIN_TTS_SENTENCE_CHARS) {
      return { text: sentence, remainder: text.slice(end) }
    }
  }
  return null
}
