import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ServerWebSocket } from 'bun'
import type { ClientMessage, ServerMessage } from '../shared/protocol.ts'
import { createAppContext } from './app-context.ts'
import { countMessages, createConversation, getConversation, getSetting, listMessages } from './db/dao.ts'
import { type SahurServers, Session, createServer } from './index.ts'
import { MockVoiceBackend } from './llm/mock-backend.ts'

let servers: SahurServers | undefined

afterEach(() => {
  servers?.http.stop(true)
  servers?.https?.stop(true)
  servers = undefined
})

function startServer(opts: Parameters<typeof createServer>[0] = {}): SahurServers {
  servers = createServer({
    httpPort: Number(process.env.PORT ?? 18080),
    httpsPort: Number(process.env.HTTPS_PORT ?? 18443),
    appContext: { dbPath: ':memory:' },
    ...opts
  })
  return servers
}

function httpPortOf(s: SahurServers): number {
  if (s.http.port === undefined) throw new Error('server did not bind a port')
  return s.http.port
}

class FailingVisionBackend extends MockVoiceBackend {
  async describeImage(_imageBytes: Uint8Array, _mime: string): Promise<string> {
    throw new Error('qwen vision failed: 400')
  }
}

class CountingAsrBackend extends MockVoiceBackend {
  transcribeCalls = 0

  async transcribe(_audio: Uint8Array): Promise<string> {
    this.transcribeCalls += 1
    return 'transcript'
  }
}

class FailingAsrBackend extends MockVoiceBackend {
  async transcribe(_audio: Uint8Array): Promise<string> {
    throw new Error('qwen asr failed: 400')
  }
}

// `fetch`/`new URL` normalize a literal or singly-percent-encoded `..` path
// segment away before the request ever reaches the server, so a request built
// that way never actually exercises `isSafeRelativePath` (see docs/test.md's
// Wave-2 finding). A raw socket with an encoded-slash traversal payload
// (`..%2f`) survives that normalization — the slash stays opaque to the URL
// parser's dot-segment removal — and only becomes a literal `..` segment once
// the server's own `decodeURIComponent` call runs, which is exactly what the
// guard must catch.
function rawHttpGet(port: number, rawPath: string): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => {
      socket.write(`GET ${rawPath} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`)
    })
    let data = ''
    socket.on('data', (chunk) => {
      data += chunk.toString('utf8')
    })
    socket.on('end', () => {
      const statusLine = data.split('\r\n')[0] ?? ''
      const match = statusLine.match(/^HTTP\/1\.\d (\d{3})/)
      if (!match?.[1]) return reject(new Error(`unexpected response: ${statusLine}`))
      resolve({ status: Number(match[1]) })
    })
    socket.on('error', reject)
  })
}

function connect(port: number): {
  ws: WebSocket
  received: ServerMessage[]
  untilType: (type: ServerMessage['type']) => Promise<void>
} {
  const ws = new WebSocket(`ws://localhost:${port}/ws`)
  const received: ServerMessage[] = []
  const waiters: Array<{ type: ServerMessage['type']; resolve: () => void }> = []
  ws.onmessage = (ev) => {
    const msg = JSON.parse(String(ev.data)) as ServerMessage
    received.push(msg)
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i]?.type === msg.type) {
        waiters.splice(i, 1)[0]?.resolve()
      }
    }
  }
  function untilType(type: ServerMessage['type']): Promise<void> {
    if (received.some((m) => m.type === type)) return Promise.resolve()
    return new Promise((resolve) => waiters.push({ type, resolve }))
  }
  return { ws, received, untilType }
}

describe('Bun single-server scaffold', () => {
  test('serves the kiosk page at /', async () => {
    const s = startServer()
    const res = await fetch(`http://localhost:${httpPortOf(s)}/`)
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('<title>SahurHub — Kiosk</title>')
  })

  test('falls back to the phone placeholder page at /phone when apps/remote/dist is absent', async () => {
    const missingDistDir = join(tmpdir(), 'sahurhub-no-such-remote-dist')
    const s = startServer({ remoteDistDir: missingDistDir })
    const res = await fetch(`http://localhost:${httpPortOf(s)}/phone`)
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('Phone remote placeholder')
  })

  test('serves the built remote app at /phone when apps/remote/dist is present', async () => {
    const distDir = mkdtempSync(join(tmpdir(), 'sahurhub-remote-dist-'))
    writeFileSync(join(distDir, 'index.html'), '<p>Remote app built</p>')
    try {
      const s = startServer({ remoteDistDir: distDir })
      const res = await fetch(`http://localhost:${httpPortOf(s)}/phone`)
      expect(res.status).toBe(200)
      expect(await res.text()).toContain('Remote app built')
    } finally {
      rmSync(distDir, { recursive: true, force: true })
    }
  })

  test('404s an unknown path and blocks path traversal', async () => {
    const s = startServer()
    const port = httpPortOf(s)
    expect((await fetch(`http://localhost:${port}/nope.html`)).status).toBe(404)
    const traversal = await rawHttpGet(port, '/..%2f..%2f..%2fpackage.json')
    expect(traversal.status).toBe(404)
  })

  test('exposes a LAN discovery payload for the kiosk phone-link widget', async () => {
    const s = startServer()
    const response = await fetch(`http://localhost:${httpPortOf(s)}/info`)
    const info = (await response.json()) as { phoneUrl: string; mdnsUrl: string; port: number }

    expect(response.status).toBe(200)
    expect(info.phoneUrl).toEndWith('/phone')
    expect(info.mdnsUrl).toBe(`https://sahurhub.local:${process.env.HTTPS_PORT ?? '18443'}/phone`)
    expect(info.port).toBe(Number(process.env.HTTPS_PORT ?? 18443))
  })
})

describe('WS wiring — Agent Kernel + Orchestrator over the wire', () => {
  test('does not transcribe an audio buffer below the minimum size', async () => {
    const received: ServerMessage[] = []
    const ws = {
      send(payload: string) {
        received.push(JSON.parse(payload) as ServerMessage)
      }
    } as unknown as ServerWebSocket<undefined>
    const backend = new CountingAsrBackend()
    const session = new Session(createAppContext({ dbPath: ':memory:', backend }))

    session.appendAudioChunk(ws, Buffer.alloc(3199))
    await session.handleMessage(ws, { type: 'audio_end', source: 'phone' })

    expect(backend.transcribeCalls).toBe(0)
    expect(received).toEqual([])
  })

  test('hydrates and persists display rotation without opening a listener', async () => {
    const received: ServerMessage[] = []
    const ws = {
      send(payload: string) {
        received.push(JSON.parse(payload) as ServerMessage)
      }
    } as unknown as ServerWebSocket<undefined>
    const session = new Session(createAppContext({ dbPath: ':memory:' }))

    await session.handleMessage(ws, { type: 'hello', client: 'kiosk' })
    expect(received).toContainEqual({ type: 'display_rotation', degrees: 0 })
    received.length = 0

    await session.handleMessage(ws, { type: 'display_rotate', degrees: 270 })

    expect(getSetting(session.ctx.db, 'display_rotation')).toBe('270')
    expect(received).toContainEqual({ type: 'display_rotation', degrees: 270 })
  })

  test('reports a failed ASR request without rejecting the audio flush', async () => {
    const received: ServerMessage[] = []
    const ws = {
      send(payload: string) {
        received.push(JSON.parse(payload) as ServerMessage)
      }
    } as unknown as ServerWebSocket<undefined>
    const session = new Session(createAppContext({ dbPath: ':memory:', backend: new FailingAsrBackend() }))
    session.addClient(ws)
    const originalConsoleError = console.error
    const errors: string[] = []
    console.error = (message: unknown) => errors.push(String(message))

    try {
      session.appendAudioChunk(ws, Buffer.alloc(3200))
      await expect(session.handleMessage(ws, { type: 'audio_end', source: 'phone' })).resolves.toBeUndefined()
    } finally {
      console.error = originalConsoleError
    }

    expect(errors).toEqual(['ASR transcription failed: qwen asr failed: 400'])
    expect(received).toContainEqual({ type: 'notice', conversationId: session.conversationId, message: 'asr_failed' })
  })

  test('conversation_new persists the requested character, broadcasts it, and leaves the thread empty', async () => {
    const received: ServerMessage[] = []
    const ws = {
      send: (payload: string) => received.push(JSON.parse(payload) as ServerMessage)
    } as ServerWebSocket<undefined>
    const session = new Session(createAppContext({ dbPath: ':memory:' }))
    session.addClient(ws)

    await session.handleMessage(ws, { type: 'conversation_new', characterId: 'tralala' })

    expect(getConversation(session.ctx.db, session.conversationId)).toMatchObject({ characterId: 'tralala' })
    expect(countMessages(session.ctx.db, session.conversationId)).toBe(0)
    expect(received.map((message) => message.type)).toEqual([
      'conversation_list',
      'conversation_active',
      'character_active',
      'message_history'
    ])
    expect(received[2]).toEqual({ type: 'character_active', characterId: 'tralala' })
    expect(received[3]).toEqual({ type: 'message_history', conversationId: session.conversationId, messages: [] })
  })

  test('task_action round-trips through the session and broadcasts the refreshed active-task list', async () => {
    const received: ServerMessage[] = []
    const ws = {
      send(payload: string) {
        received.push(JSON.parse(payload) as ServerMessage)
      }
    } as unknown as ServerWebSocket<undefined>
    const session = new Session(createAppContext({ dbPath: ':memory:' }))
    const task = session.ctx.kernel.captureTask({
      name: 'email Bob',
      durationMinutes: 10,
      conversationId: session.conversationId
    })
    if (!task) throw new Error('expected a captured task')
    session.addClient(ws)
    received.length = 0

    await session.handleMessage(ws, { type: 'task_action', taskId: task.taskId, action: 'discard' })

    expect(session.ctx.kernel.listActiveTasks(session.conversationId)).toEqual([])
    expect(received).toContainEqual({ type: 'task_list', conversationId: session.conversationId, tasks: [] })
  })

  test('poke speaks and persists one in-character reaction, then throttles an immediate repeat', async () => {
    const received: ServerMessage[] = []
    const ws = {
      send(payload: string) {
        received.push(JSON.parse(payload) as ServerMessage)
      }
    } as unknown as ServerWebSocket<undefined>
    const session = new Session(createAppContext({ dbPath: ':memory:' }))
    session.addClient(ws)

    await session.handleMessage(ws, { type: 'poke' } as ClientMessage)
    await session.handleMessage(ws, { type: 'poke' } as ClientMessage)

    const messages = listMessages(session.ctx.db, session.conversationId)
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({ role: 'assistant', kind: 'text' })
    expect(received).toContainEqual(
      expect.objectContaining({ type: 'reply', conversationId: session.conversationId, say: messages[0]?.content })
    )
    expect(received.some((message) => message.type === 'tts_chunk')).toBe(true)
    expect(received).toContainEqual({ type: 'done', conversationId: session.conversationId })
  })

  test('rejects malformed client messages with an error event', async () => {
    const s = startServer()
    const { ws, received, untilType } = connect(httpPortOf(s))
    await new Promise<void>((resolve) => {
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'text' }))
        resolve()
      }
    })

    await Promise.race([
      untilType('error'),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('missing invalid-message error')), 100))
    ])
    expect(received).toContainEqual({ type: 'error', message: 'invalid client message' })
    ws.close()
  })

  test('hello syncs active conversation history as well as status, conversation, task, and character state', async () => {
    const s = startServer()
    const port = httpPortOf(s)
    const { ws, received, untilType } = connect(port)
    await new Promise<void>((resolve) => {
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'hello' } satisfies ClientMessage))
        resolve()
      }
    })
    await untilType('audio_sink')

    expect(received.map((m) => m.type)).toEqual([
      'status',
      'conversation_list',
      'conversation_active',
      'task_list',
      'message_history',
      'character_active',
      'character_list',
      'display_rotation',
      'audio_sink'
    ])
    expect((received[5] as Extract<ServerMessage, { type: 'character_active' }>).characterId).toBe('sahur')
    expect((received[6] as Extract<ServerMessage, { type: 'character_list' }>).characters).toEqual([
      { id: 'sahur', displayName: 'Sahur' },
      { id: 'tralala', displayName: 'Tralala' }
    ])
    expect((received[7] as Extract<ServerMessage, { type: 'display_rotation' }>).degrees).toBe(0)
    expect((received[8] as Extract<ServerMessage, { type: 'audio_sink' }>).active).toBe(true)
    ws.close()
  })

  test('persists the selected audio sink and echoes its active status', async () => {
    const s = startServer()
    const port = httpPortOf(s)
    const { ws, received, untilType } = connect(port)
    await new Promise<void>((resolve) => {
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'hello', client: 'remote' } satisfies ClientMessage))
        resolve()
      }
    })
    await untilType('audio_sink')
    received.length = 0

    ws.send(JSON.stringify({ type: 'audio_sink', sink: 'device' } satisfies ClientMessage))
    await untilType('audio_sink')

    const sinkEvent = received.find((message): message is Extract<ServerMessage, { type: 'audio_sink' }> => {
      return message.type === 'audio_sink'
    })
    expect(sinkEvent).toEqual({ type: 'audio_sink', sink: 'device', active: false })
    ws.close()
  })

  test('typed text drives a full turn: avatar + tokens + reply + tts + done, with no tag leakage', async () => {
    const s = startServer()
    const port = httpPortOf(s)
    const { ws, received, untilType } = connect(port)
    await new Promise<void>((resolve) => {
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'hello' } satisfies ClientMessage))
        resolve()
      }
    })
    await untilType('character_active')
    received.length = 0

    ws.send(JSON.stringify({ type: 'text', text: 'hello there', source: 'phone' } satisfies ClientMessage))
    await untilType('done')

    const types = received.map((m) => m.type)
    expect(types).toContain('avatar')
    expect(types).toContain('token')
    expect(types.indexOf('reply')).toBeGreaterThan(-1)
    expect(types.indexOf('tts_chunk')).toBeGreaterThan(types.indexOf('reply'))
    expect(types[types.length - 1]).toBe('done')

    const tokenText = received
      .filter((m): m is Extract<ServerMessage, { type: 'token' }> => m.type === 'token')
      .map((m) => m.text)
      .join('')
    expect(tokenText).not.toContain('<|')
    ws.close()
  })

  test('a task-capture utterance pushes a task_list event', async () => {
    const s = startServer()
    const port = httpPortOf(s)
    const { ws, received, untilType } = connect(port)
    await new Promise<void>((resolve) => {
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'hello' } satisfies ClientMessage))
        resolve()
      }
    })
    await untilType('character_active')
    received.length = 0

    ws.send(JSON.stringify({ type: 'text', text: 'email Bob in 10 minutes', source: 'phone' } satisfies ClientMessage))
    await untilType('done')

    const taskList = received.find((m): m is Extract<ServerMessage, { type: 'task_list' }> => m.type === 'task_list')
    expect(taskList?.tasks).toEqual([expect.objectContaining({ taskName: 'email Bob', duration: 10 })])
    ws.close()
  })

  test('task_action transitions an active task to done and broadcasts its updated task list', async () => {
    const s = startServer()
    const port = httpPortOf(s)
    const { ws, received, untilType } = connect(port)
    await new Promise<void>((resolve) => {
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'hello' } satisfies ClientMessage))
        resolve()
      }
    })
    await untilType('character_active')
    ws.send(JSON.stringify({ type: 'text', text: 'email Bob in 10 minutes', source: 'phone' } satisfies ClientMessage))
    await untilType('done')
    const taskId = s.session.ctx.kernel.listActiveTasks(s.session.conversationId)[0]?.taskId
    if (!taskId) throw new Error('expected a captured task')
    received.length = 0

    ws.send(JSON.stringify({ type: 'task_action', taskId, action: 'done' } satisfies ClientMessage))
    await untilType('task_list')

    expect(s.session.ctx.kernel.listActiveTasks(s.session.conversationId)).toEqual([])
    expect(received).toContainEqual({ type: 'task_list', conversationId: s.session.conversationId, tasks: [] })
    ws.close()
  })

  test('conversation_new creates an empty character-bound conversation and broadcasts its active character', async () => {
    const s = startServer()
    const port = httpPortOf(s)
    const { ws, received, untilType } = connect(port)
    await new Promise<void>((resolve) => {
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'hello' } satisfies ClientMessage))
        resolve()
      }
    })
    await untilType('audio_sink')
    const firstActive = received.find(
      (m): m is Extract<ServerMessage, { type: 'conversation_active' }> => m.type === 'conversation_active'
    )?.conversationId
    received.length = 0

    ws.send(JSON.stringify({ type: 'conversation_new', characterId: 'tralala' } satisfies ClientMessage))
    await untilType('message_history')

    const newActive = received.find(
      (m): m is Extract<ServerMessage, { type: 'conversation_active' }> => m.type === 'conversation_active'
    )?.conversationId
    expect(newActive).toBeDefined()
    expect(newActive).not.toBe(firstActive)
    if (!newActive) throw new Error('expected a newly active conversation')
    expect(getConversation(s.session.ctx.db, newActive)?.characterId).toBe('tralala')
    expect(countMessages(s.session.ctx.db, newActive)).toBe(0)
    expect(received.map((message) => message.type)).toEqual([
      'conversation_list',
      'conversation_active',
      'character_active',
      'message_history'
    ])
    expect(received[2]).toEqual({ type: 'character_active', characterId: 'tralala' })
    expect(received[3]).toEqual({ type: 'message_history', conversationId: newActive, messages: [] })
    ws.close()
  })

  test('deleting the active conversation activates the most recently created remaining conversation', async () => {
    const received: ServerMessage[] = []
    const ws = {
      send: (payload: string) => received.push(JSON.parse(payload) as ServerMessage)
    } as ServerWebSocket<undefined>
    const session = new Session(createAppContext({ dbPath: ':memory:' }))
    const oldest = session.conversationId
    const middle = createConversation(session.ctx.db, { characterId: 'sahur' })
    const newest = createConversation(session.ctx.db, { characterId: 'tralala' })
    session.addClient(ws)

    await session.handleMessage(ws, { type: 'conversation_switch', conversationId: newest.id })
    expect(received.map((message) => message.type)).toEqual([
      'conversation_list',
      'conversation_active',
      'character_active',
      'message_history'
    ])
    expect(received[1]).toEqual({ type: 'conversation_active', conversationId: newest.id })
    expect(received[2]).toEqual({ type: 'character_active', characterId: 'tralala' })
    expect(received[3]).toEqual({ type: 'message_history', conversationId: newest.id, messages: [] })
    received.length = 0
    await session.handleMessage(ws, { type: 'conversation_delete', conversationId: newest.id })

    expect(session.conversationId).toBe(middle.id)
    expect(session.conversationId).not.toBe(oldest)
    expect(received.map((message) => message.type)).toEqual([
      'conversation_list',
      'conversation_active',
      'character_active',
      'message_history'
    ])
    expect(received[1]).toEqual({ type: 'conversation_active', conversationId: middle.id })
    expect(received[2]).toEqual({ type: 'character_active', characterId: 'sahur' })
    expect(received[3]).toEqual({ type: 'message_history', conversationId: middle.id, messages: [] })
  })

  test('deleting the last conversation creates an empty Sahur replacement', async () => {
    const received: ServerMessage[] = []
    const ws = {
      send: (payload: string) => received.push(JSON.parse(payload) as ServerMessage)
    } as ServerWebSocket<undefined>
    const session = new Session(createAppContext({ dbPath: ':memory:' }))
    const deletedId = session.conversationId
    session.addClient(ws)

    await session.handleMessage(ws, { type: 'conversation_delete', conversationId: deletedId })

    expect(session.conversationId).not.toBe(deletedId)
    expect(getConversation(session.ctx.db, session.conversationId)).toMatchObject({ characterId: 'sahur' })
    expect(countMessages(session.ctx.db, session.conversationId)).toBe(0)
    expect(received.map((message) => message.type)).toEqual([
      'conversation_list',
      'conversation_active',
      'character_active',
      'message_history'
    ])
    expect(received[2]).toEqual({ type: 'character_active', characterId: 'sahur' })
    expect(received[3]).toEqual({ type: 'message_history', conversationId: session.conversationId, messages: [] })
  })

  test('reset clears the active conversation thread', async () => {
    const s = startServer()
    const port = httpPortOf(s)
    const { ws, untilType } = connect(port)
    await new Promise<void>((resolve) => {
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'hello' } satisfies ClientMessage))
        resolve()
      }
    })
    await untilType('character_active')
    ws.send(JSON.stringify({ type: 'text', text: 'hi', source: 'phone' } satisfies ClientMessage))
    await untilType('done')

    ws.send(JSON.stringify({ type: 'reset' } satisfies ClientMessage))
    const historyPromise = untilType('message_history')
    await historyPromise
    ws.close()
  })

  test('character_select is a backward-compatible no-op', async () => {
    const s = startServer()
    const port = httpPortOf(s)
    const { ws, received, untilType } = connect(port)
    await new Promise<void>((resolve) => {
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'hello' } satisfies ClientMessage))
        resolve()
      }
    })
    await untilType('audio_sink')
    received.length = 0

    ws.send(JSON.stringify({ type: 'character_select', characterId: 'sahur' } satisfies ClientMessage))
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(received).toEqual([])
    ws.close()
  })

  test('a failed camera vision job emits an in-character fallback and leaves the session responsive', async () => {
    const received: ServerMessage[] = []
    const ws = {
      send(payload: string) {
        received.push(JSON.parse(payload) as ServerMessage)
      }
    } as unknown as ServerWebSocket<undefined>
    const session = new Session(createAppContext({ dbPath: ':memory:', backend: new FailingVisionBackend() }))
    session.addClient(ws)

    await session.handleMessage(ws, { type: 'camera_stub' })
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(received).toContainEqual(
      expect.objectContaining({
        type: 'message',
        message: expect.objectContaining({
          role: 'assistant',
          content: 'My eyes failed me for a second — try that again.'
        })
      })
    )
    await expect(session.handleMessage(ws, { type: 'title_edit', title: 'Still awake' })).resolves.toBeUndefined()
  })
})

describe('POST /upload', () => {
  test('uploads a .txt file and returns {id, name, mime}', async () => {
    const s = startServer()
    const port = httpPortOf(s)
    const form = new FormData()
    form.append('file', new File(['hello upload'], 'notes.txt', { type: 'text/plain' }))

    const res = await fetch(`http://localhost:${port}/upload`, { method: 'POST', body: form })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { id: string; name: string; mime: string }
    expect(body.name).toBe('notes.txt')
    expect(typeof body.id).toBe('string')
  })

  test('rejects a disallowed file type at the boundary', async () => {
    const s = startServer()
    const port = httpPortOf(s)
    const form = new FormData()
    form.append('file', new File(['x'], 'script.sh', { type: 'text/plain' }))

    const res = await fetch(`http://localhost:${port}/upload`, { method: 'POST', body: form })
    expect(res.status).toBe(415)
  })
})
