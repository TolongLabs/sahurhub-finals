// Reconnecting typed WebSocket client shared by the kiosk and phone pages.
// Ported from LLaMaDesu's frontend/src/ws/client.ts (`LlamaSocket`), retargeted
// onto src/shared/protocol.ts. Kawan's hub omits auto-reconnect; LLaMaDesu's
// client keeps it — SahurHub keeps it too (docs/plan.md T8).
//
// `sendBinary`/`sendRaw` (T11 reconciliation, docs/plan.md T11): T10a forked
// this client locally as `apps/remote/src/lib/socket.ts`'s `RemoteSocket`
// because this file had no binary-send API for PTT audio frames. Both are
// promoted here so T9b/T10b can drop that fork and share one implementation
// — the server's `wsHandlers.message` already accepts `string | Buffer` on a
// single connection, so text and binary frames share one socket.

import { type ClientMessage, type ServerMessage, isServerMessage } from './protocol.ts'

type Handler<T> = (event: T) => void
type ByType = { [K in ServerMessage['type']]: Extract<ServerMessage, { type: K }> }

export interface SahurSocketOptions {
  url?: string
  reconnect?: boolean
}

export class SahurSocket {
  private ws?: WebSocket
  private handlers: Partial<Record<ServerMessage['type'], Set<Handler<ServerMessage>>>> = {}
  private readonly url: string
  private readonly reconnect: boolean
  private reconnectMs = 1000
  private closed = true
  onConn?: (up: boolean) => void

  constructor(opts: SahurSocketOptions = {}) {
    this.reconnect = opts.reconnect ?? true
    this.url = opts.url ?? defaultWsUrl()
  }

  connect(): void {
    this.closed = false
    const ws = new WebSocket(this.url)
    this.ws = ws
    ws.onopen = () => {
      this.reconnectMs = 1000
      this.onConn?.(true)
    }
    ws.onmessage = (ev) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(String(ev.data))
      } catch {
        return
      }
      if (!isServerMessage(parsed)) return
      for (const handler of this.handlers[parsed.type] ?? []) handler(parsed)
    }
    ws.onclose = () => {
      this.onConn?.(false)
      if (this.closed || !this.reconnect) return
      setTimeout(() => this.connect(), this.reconnectMs)
      this.reconnectMs = Math.min(this.reconnectMs * 2, 15000)
    }
  }

  on<K extends ServerMessage['type']>(type: K, handler: Handler<ByType[K]>): () => void {
    if (!this.handlers[type]) this.handlers[type] = new Set()
    this.handlers[type].add(handler as Handler<ServerMessage>)
    return () => this.handlers[type]?.delete(handler as Handler<ServerMessage>)
  }

  send(message: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message))
  }

  // Escape hatch for a message kind not yet in `ClientMessage` — prefer
  // adding it to protocol.ts and using `send()` once it's real.
  sendRaw<T extends { type: string }>(message: T): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message))
  }

  // Raw binary WS frame — PTT audio chunks (docs/trd.md §3: "Raw audio
  // travels as binary WS frames on the hot path").
  sendBinary(data: ArrayBuffer | Blob | ArrayBufferView): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(data as ArrayBuffer | Blob)
  }

  close(): void {
    this.closed = true
    this.ws?.close()
  }
}

function defaultWsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${location.host}/ws`
}
