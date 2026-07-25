// Bun single-server (docs/plan.md T8 scaffold, completed by T11): one process
// serves the kiosk page (plain HTTP on localhost — no getUserMedia, no
// secure-context need), the remote app (HTTPS via mkcert, needed for
// getUserMedia over the venue hotspot), a shared `/ws` endpoint on both
// listeners, and `POST /upload` for the remote's file-upload lane. This file
// wires the Agent Kernel + Orchestrator + persona registry (T11) onto the
// wire contract; it owns no persona/kernel logic itself.

import { existsSync } from 'node:fs'
import type { ServerWebSocket } from 'bun'
import type {
  AudioSink,
  ClientMessage,
  ConversationSummary,
  DisplayRotation,
  ServerMessage
} from '../shared/protocol.ts'
import { isClientMessage } from '../shared/protocol.ts'
import { type AppContext, type AppContextOptions, createAppContext } from './app-context.ts'
import { audioSinkForClient, isClientActiveAudioSink } from './audio-sink.ts'
import {
  createConversation,
  deleteConversation,
  deleteMessages,
  getConversation,
  getSetting,
  insertMessage,
  listConversations,
  listMessages,
  setSetting,
  updateConversationTitle
} from './db/dao.ts'
import { type DiscoveryInfo, createDiscoveryInfo } from './discovery.ts'
import { Orchestrator, toTaskSummary } from './orchestrator.ts'
import { DEFAULT_CHARACTER_ID } from './persona/registry.ts'
import { handleUpload, toMessageSummary } from './upload.ts'
import { emitVisionFailure } from './vision.ts'

const ROOT = import.meta.dir
const KIOSK_DIR = `${ROOT}/../kiosk`
const BGM_DIR = `${ROOT}/../../assets/bgm`
const PHONE_DIR = `${ROOT}/../phone`
const REMOTE_DIST_DIR = `${ROOT}/../../apps/remote/dist`
const CERT_DIR = `${ROOT}/../../cert`
const CERT_PATH = `${CERT_DIR}/cert.pem`
const KEY_PATH = `${CERT_DIR}/key.pem`

const ACTIVE_CONVERSATION_SETTING = 'active_conversation_id'
const AUDIO_SINK_SETTING = 'audio_sink'
const DISPLAY_ROTATION_SETTING = 'display_rotation'
const MIN_TRANSCRIBABLE_AUDIO_BYTES = 3200
const POKE_THROTTLE_MS = 5_000

function audioSinkFromSetting(value: string | null): AudioSink {
  return value === 'device' ? 'device' : 'phone'
}

function displayRotationFromSetting(value: string | null): DisplayRotation {
  if (value === '90') return 90
  if (value === '180') return 180
  if (value === '270') return 270
  return 0
}

function isSafeRelativePath(pathname: string): boolean {
  return !pathname.split('/').some((segment) => segment === '..')
}

async function serveFile(dir: string, relativePath: string): Promise<Response> {
  const file = Bun.file(`${dir}/${relativePath}`)
  if (!(await file.exists())) return new Response('Not found', { status: 404 })
  return new Response(file)
}

async function handleFetch(req: Request, phoneRootDir: string): Promise<Response> {
  const url = new URL(req.url)
  const pathname = decodeURIComponent(url.pathname)

  if (!isSafeRelativePath(pathname)) return new Response('Not found', { status: 404 })

  if (pathname === '/' || pathname === '/index.html') return serveFile(KIOSK_DIR, 'index.html')
  if (pathname === '/phone' || pathname === '/phone/') return serveFile(phoneRootDir, 'index.html')
  if (pathname.startsWith('/bgm/')) return serveFile(BGM_DIR, pathname.slice('/bgm/'.length))
  if (pathname.startsWith('/phone/')) return serveFile(phoneRootDir, pathname.slice('/phone/'.length))

  return serveFile(KIOSK_DIR, pathname.slice(1))
}

function send(ws: ServerWebSocket<undefined>, message: ServerMessage): void {
  ws.send(JSON.stringify(message))
}

// --- app-level session (one active conversation, shared by every client) --

export class Session {
  readonly ctx: AppContext
  readonly orchestrator: Orchestrator
  readonly clients = new Set<ServerWebSocket<undefined>>()
  private readonly audioBuffers = new Map<ServerWebSocket<undefined>, Uint8Array[]>()
  private readonly clientKinds = new Map<ServerWebSocket<undefined>, string | undefined>()
  private activeConversationId: string
  private activeAudioSink: AudioSink
  private displayRotation: DisplayRotation
  private restoredActiveConversation = false
  private lastPokeAt = 0

  constructor(ctx: AppContext) {
    this.ctx = ctx
    this.activeConversationId = this.loadOrCreateActiveConversation()
    this.activeAudioSink = audioSinkFromSetting(getSetting(ctx.db, AUDIO_SINK_SETTING))
    this.displayRotation = displayRotationFromSetting(getSetting(ctx.db, DISPLAY_ROTATION_SETTING))
    this.orchestrator = new Orchestrator({
      db: ctx.db,
      kernel: ctx.kernel,
      characters: ctx.characters,
      backend: ctx.backend,
      broadcast: (message) => this.broadcast(message),
      broadcastTts: (message) => this.broadcast(message)
    })
    ctx.kernel.setReminderHandler((task) => {
      void this.orchestrator.handleReminderTick(task)
      const conversationId = task.conversationId
      if (!conversationId) return
      this.broadcast({
        type: 'task_list',
        conversationId,
        tasks: ctx.kernel.listActiveTasks(conversationId).map(toTaskSummary)
      })
    })
    if (this.restoredActiveConversation) void this.orchestrator.handleColdStartIfNeeded(this.activeConversationId)
  }

  private loadOrCreateActiveConversation(): string {
    const saved = getSetting(this.ctx.db, ACTIVE_CONVERSATION_SETTING)
    if (saved && getConversation(this.ctx.db, saved)) {
      this.restoredActiveConversation = true
      return saved
    }
    const mostRecent = listConversations(this.ctx.db)[0]
    if (mostRecent) {
      this.restoredActiveConversation = true
      setSetting(this.ctx.db, ACTIVE_CONVERSATION_SETTING, mostRecent.id)
      return mostRecent.id
    }
    const conv = createConversation(this.ctx.db, { characterId: DEFAULT_CHARACTER_ID })
    setSetting(this.ctx.db, ACTIVE_CONVERSATION_SETTING, conv.id)
    return conv.id
  }

  get conversationId(): string {
    return this.activeConversationId
  }

  broadcast(message: ServerMessage): void {
    const payload = JSON.stringify(message)
    for (const ws of this.clients) ws.send(payload)
  }

  private conversationSummaries(): ConversationSummary[] {
    return listConversations(this.ctx.db)
  }

  sendInitialSync(ws: ServerWebSocket<undefined>): void {
    send(ws, { type: 'conversation_list', conversations: this.conversationSummaries() })
    send(ws, { type: 'conversation_active', conversationId: this.activeConversationId })
    send(ws, {
      type: 'task_list',
      conversationId: this.activeConversationId,
      tasks: this.ctx.kernel.listActiveTasks(this.activeConversationId).map(toTaskSummary)
    })
    const messages = listMessages(this.ctx.db, this.activeConversationId).map(toMessageSummary)
    send(ws, { type: 'message_history', conversationId: this.activeConversationId, messages })
    send(ws, { type: 'character_active', characterId: this.activeConversation().characterId })
    send(ws, { type: 'character_list', characters: this.ctx.characters.list() })
    send(ws, { type: 'display_rotation', degrees: this.displayRotation })
    // audio_sink stays last: tests and clients treat it as the end-of-hydration sentinel.
    this.sendAudioSinkState(ws)
  }

  private sendAudioSinkState(ws: ServerWebSocket<undefined>): void {
    const client = this.clientKinds.get(ws)
    send(ws, {
      type: 'audio_sink',
      sink: this.activeAudioSink,
      active: isClientActiveAudioSink(client, this.activeAudioSink)
    })
  }

  private broadcastAudioSinkState(): void {
    for (const ws of this.clients) this.sendAudioSinkState(ws)
  }

  private broadcastMessageHistory(): void {
    const messages = listMessages(this.ctx.db, this.activeConversationId).map(toMessageSummary)
    this.broadcast({ type: 'message_history', conversationId: this.activeConversationId, messages })
  }

  private activeConversation() {
    const conversation = getConversation(this.ctx.db, this.activeConversationId)
    if (!conversation) throw new Error(`active conversation ${this.activeConversationId} not found`)
    return conversation
  }

  private broadcastActiveConversation(): void {
    const conversation = this.activeConversation()
    this.broadcast({ type: 'conversation_list', conversations: this.conversationSummaries() })
    this.broadcast({ type: 'conversation_active', conversationId: conversation.id })
    this.broadcast({ type: 'character_active', characterId: conversation.characterId })
    this.broadcastMessageHistory()
  }

  addClient(ws: ServerWebSocket<undefined>): void {
    this.clients.add(ws)
  }

  removeClient(ws: ServerWebSocket<undefined>): void {
    this.clients.delete(ws)
    this.audioBuffers.delete(ws)
    this.clientKinds.delete(ws)
  }

  appendAudioChunk(ws: ServerWebSocket<undefined>, chunk: Buffer): void {
    const list = this.audioBuffers.get(ws) ?? []
    list.push(new Uint8Array(chunk))
    this.audioBuffers.set(ws, list)
  }

  async flushAudio(ws: ServerWebSocket<undefined>, source: 'phone' | 'device'): Promise<void> {
    const turnStartedAt = performance.now()
    const chunks = this.audioBuffers.get(ws) ?? []
    this.audioBuffers.delete(ws)
    if (chunks.length === 0) return
    const total = chunks.reduce((n, c) => n + c.length, 0)
    if (total < MIN_TRANSCRIBABLE_AUDIO_BYTES) {
      // Too short to transcribe — tell the remote so it clears its pending bubble.
      this.broadcast({ type: 'notice', conversationId: this.activeConversationId, message: 'asr_failed' })
      return
    }
    const merged = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      merged.set(chunk, offset)
      offset += chunk.length
    }
    let text: string
    const asrStartedAt = performance.now()
    try {
      text = await this.ctx.backend.transcribe(merged)
    } catch (error) {
      console.error(`ASR transcription failed: ${error instanceof Error ? error.message : String(error)}`)
      this.broadcast({ type: 'notice', conversationId: this.activeConversationId, message: 'asr_failed' })
      return
    }
    if (!text) {
      this.broadcast({ type: 'notice', conversationId: this.activeConversationId, message: 'asr_failed' })
      return
    }
    await this.orchestrator.handleUserTranscript({
      conversationId: this.activeConversationId,
      text,
      source,
      startedAt: turnStartedAt,
      asrMs: performance.now() - asrStartedAt
    })
  }

  async handleMessage(ws: ServerWebSocket<undefined>, msg: ClientMessage): Promise<void> {
    switch (msg.type) {
      case 'hello':
        this.addClient(ws)
        this.clientKinds.set(ws, msg.client)
        send(ws, { type: 'status', state: 'idle' })
        this.sendInitialSync(ws)
        return

      case 'text':
        await this.orchestrator.handleUserText({
          conversationId: this.activeConversationId,
          text: msg.text,
          source: msg.source ?? 'phone'
        })
        return

      case 'audio_end':
        await this.flushAudio(ws, msg.source ?? 'phone')
        return

      case 'interrupt':
        this.orchestrator.interrupt()
        return

      case 'poke': {
        const now = Date.now()
        if (now - this.lastPokeAt < POKE_THROTTLE_MS) {
          console.debug('poke reaction throttled')
          return
        }
        this.lastPokeAt = now
        const spoken = await this.orchestrator.handlePoke(this.activeConversationId)
        if (!spoken && this.lastPokeAt === now) this.lastPokeAt = 0
        return
      }

      case 'audio_sink':
        this.activeAudioSink = msg.sink
        setSetting(this.ctx.db, AUDIO_SINK_SETTING, msg.sink)
        this.broadcastAudioSinkState()
        return

      case 'display_rotate':
        this.displayRotation = msg.degrees
        setSetting(this.ctx.db, DISPLAY_ROTATION_SETTING, String(msg.degrees))
        this.broadcast({ type: 'display_rotation', degrees: msg.degrees })
        return

      case 'conversation_new': {
        try {
          this.ctx.characters.get(msg.characterId)
        } catch {
          this.broadcast({ type: 'error', message: 'unknown character' })
          return
        }
        const conv = createConversation(this.ctx.db, { characterId: msg.characterId })
        this.activeConversationId = conv.id
        setSetting(this.ctx.db, ACTIVE_CONVERSATION_SETTING, conv.id)
        this.broadcastActiveConversation()
        return
      }

      case 'conversation_switch': {
        if (!getConversation(this.ctx.db, msg.conversationId)) return
        this.activeConversationId = msg.conversationId
        setSetting(this.ctx.db, ACTIVE_CONVERSATION_SETTING, msg.conversationId)
        this.broadcastActiveConversation()
        return
      }

      case 'conversation_delete': {
        const wasActive = msg.conversationId === this.activeConversationId
        deleteConversation(this.ctx.db, msg.conversationId)
        if (wasActive) {
          const next = listConversations(this.ctx.db)[0]
          const replacement = next ?? createConversation(this.ctx.db, { characterId: DEFAULT_CHARACTER_ID })
          this.activeConversationId = replacement.id
          setSetting(this.ctx.db, ACTIVE_CONVERSATION_SETTING, replacement.id)
        }
        if (wasActive) this.broadcastActiveConversation()
        else this.broadcast({ type: 'conversation_list', conversations: this.conversationSummaries() })
        return
      }

      case 'reset':
        deleteMessages(this.ctx.db, this.activeConversationId)
        this.broadcastMessageHistory()
        return

      case 'character_select': {
        console.warn('Ignoring deprecated character_select message; character is set when creating a conversation.')
        return
      }

      case 'escalate': {
        this.ctx.kernel.forceEscalate(this.activeConversationId)
        return
      }

      case 'task_action': {
        const task = this.ctx.kernel
          .listActiveTasks(this.activeConversationId)
          .find((item) => item.taskId === msg.taskId)
        if (!task) return
        const updated =
          msg.action === 'done' ? this.ctx.kernel.markDone(task.taskId) : this.ctx.kernel.dismissTask(task.taskId)
        if (!updated) return
        this.broadcast({
          type: 'task_list',
          conversationId: this.activeConversationId,
          tasks: this.ctx.kernel.listActiveTasks(this.activeConversationId).map(toTaskSummary)
        })
        return
      }

      case 'title_edit': {
        const title = msg.title.trim().slice(0, 60)
        if (!title) return
        updateConversationTitle(this.ctx.db, this.activeConversationId, title)
        this.broadcast({ type: 'title', conversationId: this.activeConversationId, title })
        return
      }

      case 'camera_stub': {
        // A3 stub — no real capture; runs the same async, off-critical-path
        // reaction lane a real inspect_camera/upload-image would (docs/trd.md §3.9).
        const conversationId = this.activeConversationId
        void this.ctx.backend
          .describeImage(new Uint8Array(0), 'image/x-fake')
          .then((reaction) => {
            const reply = insertMessage(this.ctx.db, {
              conversationId,
              role: 'assistant',
              content: reaction,
              kind: 'text'
            })
            this.broadcast({ type: 'message', message: toMessageSummary(reply) })
          })
          .catch((error) => {
            emitVisionFailure(
              { db: this.ctx.db, conversationId, broadcast: (message) => this.broadcast(message) },
              error
            )
          })
        return
      }
    }
  }
}

function fetchHandler(
  req: Request,
  srv: Bun.Server<undefined>,
  phoneRootDir: string,
  session: Session,
  discovery: DiscoveryInfo
): Response | Promise<Response> | undefined {
  const url = new URL(req.url)
  if (url.pathname === '/ws') {
    const upgraded = srv.upgrade(req)
    if (upgraded) return undefined
    return new Response('WebSocket upgrade failed', { status: 400 })
  }
  if (url.pathname === '/upload' && req.method === 'POST') {
    return handleUploadRequest(req, session)
  }
  if (url.pathname === '/info' && req.method === 'GET') return Response.json(discovery)
  return handleFetch(req, phoneRootDir)
}

async function handleUploadRequest(req: Request, session: Session): Promise<Response> {
  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return Response.json({ error: 'expected multipart/form-data' }, { status: 400 })
  }
  const file = form.get('file')
  if (!(file instanceof File)) return Response.json({ error: 'missing file field' }, { status: 400 })
  const text = form.get('text')
  const conversationId = session.conversationId

  const result = await handleUpload(
    {
      db: session.ctx.db,
      conversationId,
      backend: session.ctx.backend,
      broadcast: (message) => session.broadcast(message),
      speak: (reply) => session.orchestrator.speakWholeText(conversationId, reply)
    },
    file,
    typeof text === 'string' ? text : undefined
  )
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status })
  return Response.json({ id: result.id, name: result.name, mime: result.mime })
}

export interface SahurServers {
  http: ReturnType<typeof Bun.serve>
  https: ReturnType<typeof Bun.serve> | null
  session: Session
}

export function createServer(
  opts: {
    httpPort?: number
    httpsPort?: number
    remoteDistDir?: string
    appContext?: AppContextOptions
  } = {}
): SahurServers {
  const remoteDistDir = opts.remoteDistDir ?? REMOTE_DIST_DIR
  const remoteDistAvailable = existsSync(`${remoteDistDir}/index.html`)
  if (!remoteDistAvailable) {
    console.warn(
      `No built remote app at ${remoteDistDir} — serving the placeholder src/phone page. Run \`bun run build:remote\`.`
    )
  }
  const phoneRootDir = remoteDistAvailable ? remoteDistDir : PHONE_DIR
  const httpsPort = opts.httpsPort ?? Number(process.env.HTTPS_PORT ?? 8443)
  const discovery = createDiscoveryInfo(httpsPort)

  const ctx = createAppContext(opts.appContext)
  const session = new Session(ctx)

  const wsHandlers = {
    open(ws: ServerWebSocket<undefined>) {
      session.addClient(ws)
    },
    close(ws: ServerWebSocket<undefined>) {
      session.removeClient(ws)
    },
    message(ws: ServerWebSocket<undefined>, raw: string | Buffer) {
      if (typeof raw !== 'string') {
        session.appendAudioChunk(ws, raw)
        return
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch {
        return
      }
      if (!isClientMessage(parsed)) {
        send(ws, { type: 'error', message: 'invalid client message' })
        return
      }
      void session.handleMessage(ws, parsed)
    }
  }

  const http = Bun.serve({
    port: opts.httpPort ?? Number(process.env.PORT ?? 8080),
    hostname: '0.0.0.0',
    fetch: (req, srv) => fetchHandler(req, srv, phoneRootDir, session, discovery),
    websocket: wsHandlers
  })

  let https: ReturnType<typeof Bun.serve> | null = null
  const certFile = Bun.file(CERT_PATH)
  const keyFile = Bun.file(KEY_PATH)
  if (certFile.size > 0 && keyFile.size > 0) {
    https = Bun.serve({
      port: httpsPort,
      hostname: '0.0.0.0',
      tls: { cert: certFile, key: keyFile },
      fetch: (req, srv) => fetchHandler(req, srv, phoneRootDir, session, discovery),
      websocket: wsHandlers
    })
  } else {
    console.warn(`No mkcert cert at ${CERT_DIR} — HTTPS listener (phone page) not started. Run scripts/setup.sh.`)
  }

  return { http, https, session }
}

if (import.meta.main) {
  process.on('unhandledRejection', (reason) => {
    console.error(`unhandled rejection: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`)
  })
  process.on('uncaughtException', (error) => {
    console.error(`uncaught exception: ${error.stack ?? error.message}`)
  })
  const { http, https } = createServer()
  console.log(`kiosk (local): http://localhost:${http.port}`)
  if (https) console.log(`phone (local; use the LAN IP on the hotspot): https://localhost:${https.port}`)
}
