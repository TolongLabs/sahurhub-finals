import { afterEach, describe, expect, test } from 'bun:test'
import type { ServerWebSocket } from 'bun'
import type { ClientMessage, ServerMessage } from './protocol.ts'
import { SahurSocket } from './ws-client.ts'

let server: ReturnType<typeof Bun.serve> | undefined
let activeConn: ServerWebSocket<undefined> | undefined

afterEach(() => {
  server?.stop(true)
  server = undefined
  activeConn = undefined
})

function startEchoServer(): number {
  const srv = Bun.serve({
    port: 0,
    fetch(req, s) {
      if (s.upgrade(req)) return undefined
      return new Response('upgrade failed', { status: 400 })
    },
    websocket: {
      open(ws) {
        activeConn = ws
        send(ws, { type: 'status', state: 'idle' })
      },
      message(ws, raw) {
        if (typeof raw !== 'string') {
          send(ws, { type: 'transcript', conversationId: 'c1', text: `binary:${raw.length}`, final: true })
          return
        }
        const msg = JSON.parse(raw) as ClientMessage
        if (msg.type === 'text') send(ws, { type: 'transcript', conversationId: 'c1', text: msg.text, final: true })
        if (msg.type === 'title_edit') {
          send(ws, { type: 'transcript', conversationId: 'c1', text: `raw:${msg.title}`, final: true })
        }
      }
    }
  })
  server = srv
  if (srv.port === undefined) throw new Error('test server did not bind a port')
  return srv.port
}

// Drops the current connection from the server side — proves the client
// reconnects on an unexpected close, not just on a client-initiated close().
function dropCurrentConnection(): void {
  activeConn?.close()
}

function send(ws: ServerWebSocket<undefined>, message: ServerMessage): void {
  ws.send(JSON.stringify(message))
}

describe('SahurSocket', () => {
  test('connects, receives typed events, and round-trips a send()', async () => {
    const port = startEchoServer()
    const socket = new SahurSocket({ url: `ws://localhost:${port}/ws` })
    const received: ServerMessage[] = []

    await new Promise<void>((resolve) => {
      socket.on('status', (event) => {
        received.push(event)
        socket.send({ type: 'text', text: 'wake up' })
      })
      socket.on('transcript', (event) => {
        received.push(event)
        resolve()
      })
      socket.connect()
    })

    expect(received).toEqual([
      { type: 'status', state: 'idle' },
      { type: 'transcript', conversationId: 'c1', text: 'wake up', final: true }
    ])
    socket.close()
  })

  test('auto-reconnects after the connection drops', async () => {
    const port = startEchoServer()
    const socket = new SahurSocket({ url: `ws://localhost:${port}/ws` })
    const connEvents: boolean[] = []

    await new Promise<void>((resolve) => {
      let sawOpen = false
      socket.onConn = (up) => {
        connEvents.push(up)
        if (up && !sawOpen) {
          sawOpen = true
          dropCurrentConnection()
          return
        }
        if (up && sawOpen) resolve()
      }
      socket.connect()
    })

    expect(connEvents).toEqual([true, false, true])
    socket.close()
  }, 10000)

  test('does not reconnect once close() has been called', async () => {
    const port = startEchoServer()
    const socket = new SahurSocket({ url: `ws://localhost:${port}/ws` })
    const connEvents: boolean[] = []

    await new Promise<void>((resolve) => {
      socket.onConn = (up) => {
        connEvents.push(up)
        if (up) {
          socket.close()
          setTimeout(resolve, 50)
        }
      }
      socket.connect()
    })

    expect(connEvents).toEqual([true, false])
  })

  test('sendBinary delivers a raw binary frame; sendRaw delivers an untyped escape-hatch message', async () => {
    const port = startEchoServer()
    const socket = new SahurSocket({ url: `ws://localhost:${port}/ws` })
    const received: ServerMessage[] = []

    await new Promise<void>((resolve) => {
      socket.on('status', () => {
        socket.sendBinary(new Uint8Array([1, 2, 3, 4]).buffer)
      })
      socket.on('transcript', (event) => {
        received.push(event)
        if (received.length === 1) {
          socket.sendRaw({ type: 'title_edit', title: 'Wake-up plans' })
        } else {
          resolve()
        }
      })
      socket.connect()
    })

    expect(received).toEqual([
      { type: 'transcript', conversationId: 'c1', text: 'binary:4', final: true },
      { type: 'transcript', conversationId: 'c1', text: 'raw:Wake-up plans', final: true }
    ])
    socket.close()
  })
})
