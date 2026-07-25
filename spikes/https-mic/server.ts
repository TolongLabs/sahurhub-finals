// https-mic spike server: HTTPS (mkcert) + WSS, serves index.html, receives
// audio blobs from the phone over WS and writes them to recordings/, prints
// a console ASCII QR code (and serves it at /qr) for phone handoff.
import { networkInterfaces } from 'node:os'
import qrcodeTerminal from 'qrcode-terminal'

const PORT = Number(process.env.PORT ?? 8443)
const SPIKE_DIR = import.meta.dir
const CERT_PATH = `${SPIKE_DIR}/cert/cert.pem`
const KEY_PATH = `${SPIKE_DIR}/cert/key.pem`
const RECORDINGS_DIR = `${SPIKE_DIR}/recordings`

const certFile = Bun.file(CERT_PATH)
const keyFile = Bun.file(KEY_PATH)
if (!(await certFile.exists()) || !(await keyFile.exists())) {
  console.error(`Missing cert at ${CERT_PATH} or key at ${KEY_PATH}. Run ./setup.sh first.`)
  process.exit(1)
}

const MIME_EXT: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/webm;codecs=opus': 'webm',
  'audio/ogg': 'ogg',
  'audio/ogg;codecs=opus': 'ogg',
  'audio/mp4': 'm4a'
}

function getLanIp(): string {
  const nets = networkInterfaces()
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === 'IPv4' && !net.internal) return net.address
    }
  }
  return '127.0.0.1'
}

function extForMime(mime: string): string {
  return MIME_EXT[mime] ?? 'bin'
}

function renderQr(url: string): Promise<string> {
  return new Promise((resolve) => {
    qrcodeTerminal.generate(url, { small: true }, (output: string) => resolve(output))
  })
}

interface WsData {
  pendingMime: string | null
}

interface AudioStartMessage {
  type: 'audio-start'
  mime: string
}

function isAudioStartMessage(value: unknown): value is AudioStartMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'audio-start' &&
    typeof (value as { mime?: unknown }).mime === 'string'
  )
}

const lanIp = getLanIp()
const baseUrl = `https://${lanIp}:${PORT}`

const server = Bun.serve<WsData, Record<never, never>>({
  port: PORT,
  tls: { cert: certFile, key: keyFile },
  async fetch(req, srv) {
    const url = new URL(req.url)

    if (url.pathname === '/ws') {
      const upgraded = srv.upgrade(req, { data: { pendingMime: null } })
      if (upgraded) return undefined
      return new Response('WebSocket upgrade failed', { status: 400 })
    }

    if (url.pathname === '/qr') {
      const ascii = await renderQr(baseUrl)
      return new Response(`${baseUrl}\n\n${ascii}`, {
        headers: { 'content-type': 'text/plain; charset=utf-8' }
      })
    }

    if (url.pathname.startsWith('/recordings/')) {
      const name = url.pathname.slice('/recordings/'.length)
      if (name.includes('/') || name.includes('..')) return new Response('Not found', { status: 404 })
      const file = Bun.file(`${RECORDINGS_DIR}/${name}`)
      if (!(await file.exists())) return new Response('Not found', { status: 404 })
      return new Response(file)
    }

    if (url.pathname === '/' || url.pathname === '/index.html') {
      return new Response(Bun.file(`${SPIKE_DIR}/index.html`), {
        headers: { 'content-type': 'text/html; charset=utf-8' }
      })
    }

    return new Response('Not found', { status: 404 })
  },
  websocket: {
    open(ws) {
      ws.data.pendingMime = null
    },
    async message(ws, message) {
      if (typeof message === 'string') {
        let parsed: unknown
        try {
          parsed = JSON.parse(message)
        } catch {
          return
        }
        if (isAudioStartMessage(parsed)) {
          ws.data.pendingMime = parsed.mime
        }
        return
      }

      // Binary frame: the audio blob for the mime announced by the preceding audio-start message.
      const mime = ws.data.pendingMime ?? 'application/octet-stream'
      ws.data.pendingMime = null
      const ext = extForMime(mime)
      const filename = `rec-${new Date().toISOString().replace(/[:.]/g, '-')}.${ext}`
      await Bun.write(`${RECORDINGS_DIR}/${filename}`, message)
      ws.send(JSON.stringify({ type: 'saved', url: `/recordings/${filename}`, bytes: message.byteLength }))
    },
    close(ws) {
      ws.data.pendingMime = null
    }
  }
})

console.log(`https-mic spike listening on ${server.url.toString()}`)
console.log(`Phone URL: ${baseUrl}`)
console.log(await renderQr(baseUrl))
