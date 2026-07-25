import type { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { actionForAgentEvent } from '../kiosk/behavior.ts'
import type { ServerMessage } from '../shared/protocol.ts'
import { createConversation, getConversation, insertMessage, listMessages } from './db/dao.ts'
import { openDb } from './db/index.ts'
import { AgentKernel } from './kernel/kernel.ts'
import { Scheduler } from './kernel/scheduler.ts'
import { MockVoiceBackend } from './llm/mock-backend.ts'
import type { GenerateOptions, VoiceBackend } from './llm/voice-backend.ts'
import { Orchestrator, toTaskSummary } from './orchestrator.ts'
import type { CompiledPrompt } from './persona/prompt.ts'
import { CharacterRegistry } from './persona/registry.ts'

function setup(
  overrides: {
    backend?: VoiceBackend
    characters?: CharacterRegistry
    ttsFallbackMs?: number
    cannedFallbackMs?: number
  } = {}
) {
  const db = openDb(':memory:')
  const kernel = new AgentKernel(db, new Scheduler())
  const characters = overrides.characters ?? new CharacterRegistry('no/such/dir')
  const backend = overrides.backend ?? new MockVoiceBackend()
  const broadcasts: ServerMessage[] = []
  const orchestrator = new Orchestrator({
    db,
    kernel,
    characters,
    backend,
    broadcast: (m) => broadcasts.push(m),
    ttsFallbackMs: overrides.ttsFallbackMs,
    cannedFallbackMs: overrides.cannedFallbackMs
  })
  const conv = createConversation(db)
  return { db, kernel, characters, backend, broadcasts, orchestrator, conv }
}

function types(messages: ServerMessage[]): string[] {
  return messages.map((m) => m.type)
}

describe('Orchestrator — cold start', () => {
  test('an empty conversation gets the TODO-intent opener with no user message', async () => {
    const { orchestrator, broadcasts, conv, db } = setup()
    await orchestrator.handleColdStartIfNeeded(conv.id)

    const reply = broadcasts.find((m): m is Extract<ServerMessage, { type: 'reply' }> => m.type === 'reply')
    expect(reply?.say).toContain('Cold start')
    expect(listMessages(db, conv.id)).toHaveLength(1) // the opener only — no user turn
    expect(listMessages(db, conv.id)[0]?.role).toBe('assistant')
  })

  test('a non-empty conversation is left alone', async () => {
    const { orchestrator, broadcasts, conv } = setup()
    await orchestrator.handleUserText({ conversationId: conv.id, text: 'hi', source: 'phone' })
    broadcasts.length = 0

    await orchestrator.handleColdStartIfNeeded(conv.id)
    expect(broadcasts).toEqual([])
  })
})

describe('Orchestrator — whole-text speech', () => {
  test('persists and speaks a direct reaction, then closes the turn', async () => {
    const { orchestrator, broadcasts, conv, db } = setup()

    await orchestrator.speakWholeText(conv.id, 'That picture is suspiciously productive.')

    expect(listMessages(db, conv.id)).toEqual([
      expect.objectContaining({ role: 'assistant', content: 'That picture is suspiciously productive.' })
    ])
    expect(types(broadcasts)).toEqual(['reply', 'tts_chunk', 'tts_chunk', 'done'])
  })

  test('keeps the reply text-only when TTS is unavailable', async () => {
    class FailingTtsBackend extends MockVoiceBackend {
      // biome-ignore lint/correctness/useYield: failure stub — throws before any chunk
      override async *synthesize(): AsyncGenerator<Uint8Array> {
        throw new Error('tts unavailable')
      }
    }

    const { orchestrator, broadcasts, conv, db } = setup({ backend: new FailingTtsBackend() })
    await orchestrator.speakWholeText(conv.id, 'The picture still reached me.')

    expect(listMessages(db, conv.id)).toEqual([
      expect.objectContaining({ role: 'assistant', content: 'The picture still reached me.' })
    ])
    expect(types(broadcasts)).toEqual(['reply', 'done'])
  })
})

describe('Orchestrator — a plain-chat turn', () => {
  test('uses the conversation character for its prompt persona and TTS voice', async () => {
    const characters = new CharacterRegistry('no/such/dir')
    characters.register('stub', {
      manifest: {
        id: 'stub',
        name: 'Stub Character',
        voice: { backend: 'tts-flash', voiceId: 'stub-voice' },
        model: { primary: 'stub', spriteFallback: 'stub' },
        actionMap: { remind: 'wave', escalate: 'wave' },
        escalationFlavor: 'stub escalation'
      },
      bible: {
        identity: 'Stub identity',
        voice: 'Stub voice',
        comedy: 'Stub comedy',
        doDont: 'Stub rules',
        lore: 'Stub lore'
      }
    })
    let stablePrompt = ''
    let ttsVoice = ''
    const backend: VoiceBackend = {
      name: 'character-assertion',
      async generateReply(prompt, onToken) {
        stablePrompt = prompt.stable
        onToken('Stub reply.')
        return 'Stub reply.'
      },
      async *synthesize(_text, opts) {
        ttsVoice = opts?.voiceId ?? ''
        yield new Uint8Array(0)
      },
      async transcribe() {
        return ''
      },
      async generateTitle() {
        return 'title'
      },
      async describeImage() {
        return 'reaction'
      }
    }
    const { orchestrator, db } = setup({ backend, characters })
    const conv = createConversation(db, { characterId: 'stub' })

    await orchestrator.handleUserText({ conversationId: conv.id, text: 'hello', source: 'phone' })

    expect(stablePrompt).toContain('Persona (Stub Character)')
    expect(ttsVoice).toBe('stub-voice')
  })

  test('streams clean tokens (tags stripped), an emotion avatar event, a reply, tts chunks, then done', async () => {
    const { orchestrator, broadcasts, conv, db } = setup()
    await orchestrator.handleUserText({ conversationId: conv.id, text: 'hello there', source: 'phone' })

    expect(types(broadcasts)).toEqual(expect.arrayContaining(['avatar', 'token', 'reply', 'tts_chunk', 'done']))
    const tokenText = broadcasts
      .filter((m): m is Extract<ServerMessage, { type: 'token' }> => m.type === 'token')
      .map((m) => m.text)
      .join('')
    expect(tokenText).not.toContain('<|')
    expect(tokenText).not.toContain('|>')

    const messages = listMessages(db, conv.id)
    expect(messages[0]).toMatchObject({ role: 'user', content: 'hello there' })
    expect(messages[1]?.role).toBe('assistant')
  })

  test('starts sequential sentence TTS before reply and flushes a trailing fragment', async () => {
    const synthesized: string[] = []
    class SentenceMockBackend extends MockVoiceBackend {
      override async generateReply(_prompt: CompiledPrompt, onToken: (delta: string) => void): Promise<string> {
        onToken('First complete sentence.')
        await Promise.resolve()
        onToken(' Second complete sentence.')
        await Promise.resolve()
        onToken(' Trailing fragment')
        return 'First complete sentence. Second complete sentence. Trailing fragment'
      }

      override async *synthesize(text: string): AsyncGenerator<Uint8Array> {
        synthesized.push(text)
        yield new Uint8Array([synthesized.length])
      }
    }

    const { orchestrator, broadcasts, conv } = setup({ backend: new SentenceMockBackend() })
    await orchestrator.handleUserText({ conversationId: conv.id, text: 'hello', source: 'phone' })

    expect(synthesized).toEqual(['First complete sentence.', 'Second complete sentence.', 'Trailing fragment'])
    expect(types(broadcasts).indexOf('tts_chunk')).toBeLessThan(types(broadcasts).indexOf('reply'))
  })

  test('interrupt cancels the pending sentence TTS queue', async () => {
    let startFirstSynthesis: (() => void) | undefined
    const firstSynthesisStarted = new Promise<void>((resolve) => {
      startFirstSynthesis = resolve
    })
    let releaseFirstSynthesis: (() => void) | undefined
    const releaseFirstSynthesisPromise = new Promise<void>((resolve) => {
      releaseFirstSynthesis = resolve
    })
    const synthesized: string[] = []

    class InterruptibleSentenceMockBackend extends MockVoiceBackend {
      override async generateReply(_prompt: CompiledPrompt, onToken: (delta: string) => void): Promise<string> {
        onToken('First complete sentence.')
        onToken(' Second complete sentence.')
        return 'First complete sentence. Second complete sentence.'
      }

      override async *synthesize(text: string, opts?: GenerateOptions): AsyncGenerator<Uint8Array> {
        synthesized.push(text)
        if (synthesized.length === 1) {
          startFirstSynthesis?.()
          await releaseFirstSynthesisPromise
        }
        if (!opts?.signal?.aborted) yield new Uint8Array([1])
      }
    }

    const { orchestrator, broadcasts, conv } = setup({ backend: new InterruptibleSentenceMockBackend() })
    const turn = orchestrator.handleUserText({ conversationId: conv.id, text: 'hello', source: 'phone' })
    await firstSynthesisStarted
    orchestrator.interrupt()
    releaseFirstSynthesis?.()
    await turn

    expect(synthesized).toEqual(['First complete sentence.'])
    expect(broadcasts.some((message) => message.type === 'tts_chunk')).toBe(false)
  })

  test('never sends an unterminated task tag to TTS or the final reply', async () => {
    const synthesized: string[] = []
    class UnterminatedTagMockBackend extends MockVoiceBackend {
      override async generateReply(_prompt: CompiledPrompt, onToken: (delta: string) => void): Promise<string> {
        onToken('This complete sentence is safe.')
        onToken(' <|task:submit poster|10')
        return 'This complete sentence is safe. <|task:submit poster|10'
      }

      override async *synthesize(text: string): AsyncGenerator<Uint8Array> {
        synthesized.push(text)
        yield new Uint8Array([1])
      }
    }

    const { orchestrator, broadcasts, conv } = setup({ backend: new UnterminatedTagMockBackend() })
    await orchestrator.handleUserText({ conversationId: conv.id, text: 'hello', source: 'phone' })

    const reply = broadcasts.find(
      (message): message is Extract<ServerMessage, { type: 'reply' }> => message.type === 'reply'
    )
    expect(synthesized).toEqual(['This complete sentence is safe.'])
    expect(reply?.say).toBe('This complete sentence is safe.')
  })

  test('persists and broadcasts reply text with unknown junk tags removed', async () => {
    const backend: VoiceBackend = {
      name: 'junk-tag',
      async generateReply(_prompt, onToken) {
        onToken('Understood. <junk-tag:unexpected> Back to business.')
        return 'Understood. <junk-tag:unexpected> Back to business.'
      },
      async *synthesize() {},
      async transcribe() {
        return ''
      },
      async generateTitle() {
        return 'title'
      },
      async describeImage() {
        return 'reaction'
      }
    }
    const { orchestrator, broadcasts, conv, db } = setup({ backend })

    await orchestrator.handleUserText({ conversationId: conv.id, text: 'hello', source: 'phone' })

    const reply = broadcasts.find(
      (message): message is Extract<ServerMessage, { type: 'reply' }> => message.type === 'reply'
    )
    expect(reply?.say).toBe('Understood.  Back to business.')
    expect(listMessages(db, conv.id)[1]?.content).toBe('Understood.  Back to business.')
  })

  test('trims reply edges and collapses runs longer than two newlines after stripping tag artifacts', async () => {
    const backend: VoiceBackend = {
      name: 'whitespace',
      async generateReply(_prompt, onToken) {
        onToken('\n\n\nHello <junk-tag:unexpected>there.\n\n\n\nStill awake?\n\n\n\n')
        return '\n\n\nHello <junk-tag:unexpected>there.\n\n\n\nStill awake?\n\n\n\n'
      },
      async *synthesize() {},
      async transcribe() {
        return ''
      },
      async generateTitle() {
        return 'title'
      },
      async describeImage() {
        return 'reaction'
      }
    }
    const { orchestrator, broadcasts, conv, db } = setup({ backend })

    await orchestrator.handleUserText({ conversationId: conv.id, text: 'hello', source: 'phone' })

    const reply = broadcasts.find(
      (message): message is Extract<ServerMessage, { type: 'reply' }> => message.type === 'reply'
    )
    expect(reply?.say).toBe('Hello there.\n\nStill awake?')
    expect(listMessages(db, conv.id)[1]?.content).toBe('Hello there.\n\nStill awake?')
  })
})

describe('Orchestrator — character action seam', () => {
  test('the real Sahur bundle emits a generic action with its resolved animation for the kiosk', async () => {
    const backend: VoiceBackend = {
      name: 'remind-tag',
      async generateReply(_prompt, onToken) {
        onToken('<|remind:10|>Wake up.')
        return 'Wake up.'
      },
      async *synthesize() {},
      async transcribe() {
        return ''
      },
      async generateTitle() {
        return 'title'
      },
      async describeImage() {
        return 'reaction'
      }
    }
    const { orchestrator, broadcasts, conv } = setup({ backend, characters: new CharacterRegistry() })

    await orchestrator.handleUserText({ conversationId: conv.id, text: 'remind me', source: 'phone' })

    const event = broadcasts.find((message): message is Extract<ServerMessage, { type: 'agent_event' }> => {
      return message.type === 'agent_event'
    })
    expect(event?.event.kind).toBe('remind')
    expect(event?.event.animation).toBe('knock')
    if (!event) throw new Error('expected an agent event')
    expect(actionForAgentEvent(event.event)).toEqual({ name: 'knock', intensity: 1 })
  })
})

describe('Orchestrator — task capture from conversational context', () => {
  test('"X in N minutes" captures a task and pushes a task_list event', async () => {
    const { orchestrator, broadcasts, kernel, conv } = setup()
    await orchestrator.handleUserText({ conversationId: conv.id, text: 'email Bob in 10 minutes', source: 'phone' })

    const taskList = broadcasts.find((m): m is Extract<ServerMessage, { type: 'task_list' }> => m.type === 'task_list')
    if (!taskList) throw new Error('expected a task_list broadcast')
    expect(taskList.tasks).toEqual([expect.objectContaining({ taskName: 'email Bob', duration: 10 })])
    expect(kernel.listActiveTasks(conv.id).map(toTaskSummary)).toEqual(taskList.tasks)
  })

  test('a plain-chat line captures no task', async () => {
    const { orchestrator, broadcasts, conv } = setup()
    await orchestrator.handleUserText({ conversationId: conv.id, text: 'just saying hi', source: 'phone' })
    expect(broadcasts.some((m) => m.type === 'task_list')).toBe(false)
  })

  test('does not capture a task when a mock model only parrots a tag from historical context', async () => {
    const leakedTag = '<task:ghost task|15>'
    const backend: VoiceBackend = {
      name: 'history-parrot',
      async generateReply(prompt, onToken) {
        const reply = prompt.volatile.includes(leakedTag) ? leakedTag : 'No task in this turn.'
        onToken(reply)
        return reply
      },
      async *synthesize() {},
      async transcribe() {
        return ''
      },
      async generateTitle() {
        return 'title'
      },
      async describeImage() {
        return 'reaction'
      }
    }
    const { orchestrator, kernel, conv, db } = setup({ backend })
    insertMessage(db, { conversationId: conv.id, role: 'assistant', content: `Historical poison ${leakedTag}` })

    await orchestrator.handleUserText({ conversationId: conv.id, text: 'just saying hi', source: 'phone' })

    expect(kernel.listActiveTasks(conv.id)).toEqual([])
    expect(listMessages(db, conv.id).at(-1)?.content).toBe('No task in this turn.')
  })

  test('a model that would parrot its prior task tag creates that task only once', async () => {
    const taskTag = '<task:stretch|15>'
    let calls = 0
    const backend: VoiceBackend = {
      name: 'consecutive-parrot',
      async generateReply(prompt, onToken) {
        const reply =
          calls++ === 0 ? `Do it. ${taskTag}` : prompt.volatile.includes(taskTag) ? taskTag : 'Already noted.'
        onToken(reply)
        return reply
      },
      async *synthesize() {},
      async transcribe() {
        return ''
      },
      async generateTitle() {
        return 'title'
      },
      async describeImage() {
        return 'reaction'
      }
    }
    const { orchestrator, kernel, conv } = setup({ backend })

    await orchestrator.handleUserText({ conversationId: conv.id, text: 'I should stretch', source: 'phone' })
    await orchestrator.handleUserText({ conversationId: conv.id, text: 'okay', source: 'phone' })

    expect(kernel.listActiveTasks(conv.id).map((task) => task.taskName)).toEqual(['stretch'])
  })

  test('the mock backend completes an active task through its short-id completion tag', async () => {
    const { orchestrator, broadcasts, kernel, conv } = setup()
    await orchestrator.handleUserText({ conversationId: conv.id, text: 'submit poster in 10 minutes', source: 'phone' })
    broadcasts.length = 0

    await orchestrator.handleUserText({ conversationId: conv.id, text: 'I submitted it', source: 'phone' })

    expect(kernel.listActiveTasks(conv.id)).toEqual([])
    expect(broadcasts).toContainEqual({ type: 'task_list', conversationId: conv.id, tasks: [] })
  })
})

describe('Orchestrator — barge-in', () => {
  test('interrupt() cancels an in-flight generation without persisting a partial reply', async () => {
    const slowBackend: VoiceBackend = {
      name: 'slow',
      async generateReply(_prompt: CompiledPrompt, onToken: (d: string) => void, opts?: GenerateOptions) {
        onToken('partial')
        await new Promise((resolve) => setTimeout(resolve, 50))
        if (opts?.signal?.aborted) {
          const err = new Error('aborted')
          err.name = 'AbortError'
          throw err
        }
        return 'partial should not reach here'
      },
      async *synthesize() {},
      async transcribe() {
        return ''
      },
      async generateTitle() {
        return 'title'
      },
      async describeImage() {
        return 'reaction'
      }
    }
    const { orchestrator, conv, db } = setup({ backend: slowBackend })
    const turnPromise = orchestrator.handleUserText({ conversationId: conv.id, text: 'hi', source: 'phone' })
    await new Promise((resolve) => setTimeout(resolve, 5))
    orchestrator.interrupt()
    await turnPromise

    const messages = listMessages(db, conv.id)
    expect(messages).toHaveLength(1) // only the user message — no assistant reply persisted
  })

  test('queues a reminder tick behind a live user turn so interrupt keeps its active abort', async () => {
    let releaseFirstTurn: (() => void) | undefined
    let firstTurnStarted: (() => void) | undefined
    const firstTurnStartedPromise = new Promise<void>((resolve) => {
      firstTurnStarted = resolve
    })
    let calls = 0
    const backend: VoiceBackend = {
      name: 'queued-turns',
      async generateReply(_prompt, onToken, opts) {
        calls++
        if (calls === 1) {
          onToken('first turn')
          firstTurnStarted?.()
          await new Promise<void>((resolve) => {
            releaseFirstTurn = resolve
          })
          if (opts?.signal?.aborted) throw new DOMException('aborted', 'AbortError')
        }
        return ''
      },
      async *synthesize() {},
      async transcribe() {
        return ''
      },
      async generateTitle() {
        return 'title'
      },
      async describeImage() {
        return 'reaction'
      }
    }
    const { orchestrator, kernel, conv, db } = setup({ backend })
    const task = kernel.captureTask({ name: 'stretch', durationMinutes: 1, conversationId: conv.id })
    if (!task) throw new Error('expected a task')

    const userTurn = orchestrator.handleUserText({ conversationId: conv.id, text: 'hi', source: 'phone' })
    await firstTurnStartedPromise
    const tickTurn = orchestrator.handleReminderTick(task)
    orchestrator.interrupt()
    releaseFirstTurn?.()
    await userTurn
    await tickTurn

    expect(listMessages(db, conv.id)).toHaveLength(1)
  })
})

describe('Orchestrator — reminder turns', () => {
  test('a reminder after creating another conversation does not replay the original task capture', async () => {
    const { orchestrator, kernel, conv, db } = setup()
    await orchestrator.handleUserText({
      conversationId: conv.id,
      text: 'submit the poster in 2 minutes',
      source: 'phone'
    })
    const task = kernel.listActiveTasks(conv.id)[0]
    if (!task) throw new Error('expected a captured task')

    createConversation(db)
    await orchestrator.handleReminderTick(task)

    expect(kernel.listActiveTasks(conv.id)).toHaveLength(1)
    const assistantMessages = listMessages(db, conv.id).filter((message) => message.role === 'assistant')
    expect(new Set(assistantMessages.map((message) => message.content)).size).toBe(assistantMessages.length)
  })
})

describe('Orchestrator — local latency enforcement', () => {
  test('at the tts-fallback threshold with text already flowing, emits a webspeech notice', async () => {
    let synthesizeCalls = 0
    const slowTtsStart: VoiceBackend = {
      name: 'slow-tts',
      async generateReply(_prompt, onToken) {
        onToken('hello')
        await new Promise((resolve) => setTimeout(resolve, 30))
        return 'hello'
      },
      async *synthesize() {
        synthesizeCalls++
        yield new Uint8Array([1, 2])
      },
      async transcribe() {
        return ''
      },
      async generateTitle() {
        return 'title'
      },
      async describeImage() {
        return 'reaction'
      }
    }
    const { orchestrator, broadcasts, conv } = setup({
      backend: slowTtsStart,
      ttsFallbackMs: 5,
      cannedFallbackMs: 5000
    })
    await orchestrator.handleUserText({ conversationId: conv.id, text: 'hi', source: 'phone' })

    const notice = broadcasts.find((m): m is Extract<ServerMessage, { type: 'notice' }> => m.type === 'notice')
    expect(notice?.message).toBe('tts_fallback:webspeech')
    expect(synthesizeCalls).toBe(0)
    expect(broadcasts.some((message) => message.type === 'tts_chunk')).toBe(false)
  })

  test('at the canned-fallback threshold with no text at all, plays a canned in-persona line', async () => {
    const neverReplies: VoiceBackend = {
      name: 'silent',
      async generateReply(_prompt, _onToken, opts) {
        await new Promise((resolve) => setTimeout(resolve, 30))
        if (opts?.signal?.aborted) throw new DOMException('aborted', 'AbortError')
        return ''
      },
      async *synthesize() {},
      async transcribe() {
        return ''
      },
      async generateTitle() {
        return 'title'
      },
      async describeImage() {
        return 'reaction'
      }
    }
    const { orchestrator, broadcasts, conv, db } = setup({
      backend: neverReplies,
      cannedFallbackMs: 5,
      ttsFallbackMs: 1000
    })
    await orchestrator.handleUserText({ conversationId: conv.id, text: 'hi', source: 'phone' })
    await new Promise((resolve) => setTimeout(resolve, 20))

    const reply = broadcasts.find((m): m is Extract<ServerMessage, { type: 'reply' }> => m.type === 'reply')
    expect(reply?.say).toContain('lost the signal')
    const messages = listMessages(db, conv.id)
    expect(messages[messages.length - 1]?.role).toBe('assistant')
  })
})

describe('Orchestrator — async title generation', () => {
  test('generates a title after the first exchange, without blocking the reply', async () => {
    const { orchestrator, broadcasts, conv, db } = setup()
    await orchestrator.handleUserText({ conversationId: conv.id, text: 'plan my morning', source: 'phone' })
    // allow the fire-and-forget title promise to settle
    await new Promise((resolve) => setTimeout(resolve, 10))

    const title = broadcasts.find((m): m is Extract<ServerMessage, { type: 'title' }> => m.type === 'title')
    expect(title?.title).toBe('plan my morning')
    expect(db).toBeDefined()
  })

  test('does not title an empty (cold-start-only) conversation', async () => {
    const { orchestrator, broadcasts, conv } = setup()
    await orchestrator.handleColdStartIfNeeded(conv.id)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(broadcasts.some((m) => m.type === 'title')).toBe(false)
  })

  test('replaces a persisted placeholder title after the first exchange and broadcasts it', async () => {
    const backend: VoiceBackend = {
      name: 'poster-title',
      async generateReply(_prompt, onToken) {
        onToken('A reply.')
        return 'A reply.'
      },
      async *synthesize() {},
      async transcribe() {
        return ''
      },
      async generateTitle() {
        return 'Poster Deadline Panic'
      },
      async describeImage() {
        return 'reaction'
      }
    }
    const { orchestrator, broadcasts, db } = setup({ backend })
    const conv = createConversation(db, { title: 'New conversation' })

    await orchestrator.handleUserText({ conversationId: conv.id, text: 'plan my morning', source: 'phone' })
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(getConversation(db, conv.id)?.title).toBe('Poster Deadline Panic')
    expect(broadcasts).toContainEqual({ type: 'title', conversationId: conv.id, title: 'Poster Deadline Panic' })
  })

  test('retitles a long-running conversation with the placeholder title on its next exchange', async () => {
    const { orchestrator, broadcasts, db } = setup()
    const conv = createConversation(db, { title: 'New conversation' })
    insertMessage(db, { conversationId: conv.id, role: 'user', content: 'old message one' })
    insertMessage(db, { conversationId: conv.id, role: 'assistant', content: 'old reply one' })
    insertMessage(db, { conversationId: conv.id, role: 'user', content: 'old message two' })
    insertMessage(db, { conversationId: conv.id, role: 'assistant', content: 'old reply two' })

    await orchestrator.handleUserText({ conversationId: conv.id, text: 'finish the presentation', source: 'phone' })
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(getConversation(db, conv.id)?.title).toBe('finish the presentation')
    expect(broadcasts).toContainEqual({ type: 'title', conversationId: conv.id, title: 'finish the presentation' })
  })

  test('logs a failed title generation and retries on the next exchange', async () => {
    let titleCalls = 0
    const backend: VoiceBackend = {
      name: 'title-retry',
      async generateReply(_prompt, onToken) {
        onToken('A reply.')
        return 'A reply.'
      },
      async *synthesize() {},
      async transcribe() {
        return ''
      },
      async generateTitle() {
        titleCalls++
        if (titleCalls === 1) throw new Error('Qwen title endpoint returned 500')
        return 'Recovered title'
      },
      async describeImage() {
        return 'reaction'
      }
    }
    const error = console.error
    const errors: string[] = []
    console.error = (message: unknown) => errors.push(String(message))
    try {
      const { orchestrator, conv, db } = setup({ backend })
      await orchestrator.handleUserText({ conversationId: conv.id, text: 'first turn', source: 'phone' })
      await new Promise((resolve) => setTimeout(resolve, 10))
      await orchestrator.handleUserText({ conversationId: conv.id, text: 'second turn', source: 'phone' })
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(errors).toContain(`title generation failed for conversation ${conv.id}: Qwen title endpoint returned 500`)
      expect(getConversation(db, conv.id)?.title).toBe('Recovered title')
    } finally {
      console.error = error
    }
  })

  test('logs a schema-echo title failure without persisting or broadcasting a fallback', async () => {
    const echoedSchema = '{"type":"object","properties":{"title":{"type":"string"}}}'
    const backend: VoiceBackend = {
      name: 'schema-echo',
      async generateReply(_prompt, onToken) {
        onToken('A reply.')
        return 'A reply.'
      },
      async *synthesize() {},
      async transcribe() {
        return ''
      },
      async generateTitle() {
        throw new Error(`title generation returned no title: ${echoedSchema}`)
      },
      async describeImage() {
        return 'reaction'
      }
    }
    const error = console.error
    const errors: string[] = []
    console.error = (message: unknown) => errors.push(String(message))
    try {
      const { orchestrator, broadcasts, db } = setup({ backend })
      const conv = createConversation(db, { title: 'New conversation' })
      await orchestrator.handleUserText({ conversationId: conv.id, text: 'first turn', source: 'phone' })
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(errors).toContain(
        `title generation failed for conversation ${conv.id}: title generation returned no title: ${echoedSchema}`
      )
      expect(getConversation(db, conv.id)?.title).toBe('New conversation')
      expect(broadcasts.some((message) => message.type === 'title')).toBe(false)
    } finally {
      console.error = error
    }
  })

  test('logs an empty generated title without persisting or broadcasting a fallback', async () => {
    const backend: VoiceBackend = {
      name: 'empty-title',
      async generateReply(_prompt, onToken) {
        onToken('A reply.')
        return 'A reply.'
      },
      async *synthesize() {},
      async transcribe() {
        return ''
      },
      async generateTitle() {
        return '   '
      },
      async describeImage() {
        return 'reaction'
      }
    }
    const error = console.error
    const errors: string[] = []
    console.error = (message: unknown) => errors.push(String(message))
    try {
      const { orchestrator, broadcasts, db } = setup({ backend })
      const conv = createConversation(db, { title: 'New conversation' })
      await orchestrator.handleUserText({ conversationId: conv.id, text: 'first turn', source: 'phone' })
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(errors).toContain(
        `title generation failed for conversation ${conv.id}: title generation returned no title`
      )
      expect(getConversation(db, conv.id)?.title).toBe('New conversation')
      expect(broadcasts.some((message) => message.type === 'title')).toBe(false)
    } finally {
      console.error = error
    }
  })
})
