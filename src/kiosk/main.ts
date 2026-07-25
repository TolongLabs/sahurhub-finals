import qrcode from 'qrcode-generator'
import sahurBundle from '../../characters/sahur/character.json'
import tralalaBundle from '../../characters/tralala/character.json'
import type { DisplayRotation } from '../shared/protocol.ts'
import { SahurSocket } from '../shared/ws-client.ts'
import { KioskAudioPlayer } from './audio-player.ts'
import { PlaybackBoundaryQueue, actionForAgentEvent, expressionForAvatar } from './behavior.ts'
import { startDeviceRecording } from './device-input.ts'
import { validateCharacterDef } from './model/index.ts'
import { type KioskRenderer, mountRenderer } from './renderer.ts'
import { StingPlayer, stingForAgentEvent } from './stings.ts'

async function main(): Promise<void> {
  const stage = requiredElement('stage')
  const connection = requiredElement('connection')
  const qrWidget = requiredElement('phone-link')
  const deviceInput = document.getElementById('device-input')
  const deviceButton = document.getElementById('device-talk')
  const deviceStatus = document.getElementById('device-status')
  const bundles: Record<string, unknown> = { sahur: sahurBundle, tralala: tralalaBundle }
  let character = validateCharacterDef(sahurBundle)
  const forceKioskAudio = new URLSearchParams(location.search).get('audioSink') === 'kiosk'
  let renderer: KioskRenderer
  try {
    renderer = mountRenderer(stage, character)
  } catch (error) {
    console.error('[kiosk] Three.js mount failed', error)
    showRendererError(stage)
    return
  }

  // Character hot-swap: the server broadcasts character_active on connect and
  // whenever the remote's picker changes it; remount the matching model.
  const swapCharacter = (characterId: string): void => {
    if (characterId === character.id) return
    const bundle = bundles[characterId]
    if (!bundle) {
      console.warn(`[kiosk] no local bundle for character "${characterId}", keeping ${character.id}`)
      return
    }
    try {
      const next = validateCharacterDef(bundle)
      renderer.dispose()
      renderer = mountRenderer(stage, next)
      character = next
    } catch (error) {
      console.error(`[kiosk] character swap to "${characterId}" failed`, error)
    }
  }

  const stings = new StingPlayer()
  // Wake-up entrance: the character announces itself with its theme sting.
  stings.play(character.id, { volume: 0.5 })

  const boundaryQueue = new PlaybackBoundaryQueue()
  const audio = new KioskAudioPlayer({
    onAmplitude: (amount) => renderer.setMouth(amount),
    onPlaybackBoundary: () => boundaryQueue.flush()
  })
  const socket = new SahurSocket()
  let tokenText = ''
  let fallbackActive = false
  let kioskAudioActive = forceKioskAudio
  let displayRotation: DisplayRotation = 0
  let rotationFrame = 0
  let agentStatus: 'idle' | 'listening' | 'thinking' | 'speaking' = 'idle'
  let restorePokeExpression = 0
  let pokeExpressionActive = false
  let stopRecording: (() => void) | null = null
  let hasDiscoveryInfo = false
  let currentPhoneUrl = fallbackPhoneUrl()
  let pokeSuppressedUntil = 0

  const refreshPhoneUrl = async () => {
    const discovered = await renderPhoneUrl(qrWidget, hasDiscoveryInfo)
    if (discovered) {
      hasDiscoveryInfo = true
      currentPhoneUrl = discovered
    }
  }

  void refreshPhoneUrl()
  const phoneUrlInterval = window.setInterval(() => void refreshPhoneUrl(), 60_000)
  if (new URLSearchParams(location.search).get('deviceInput') === '1') deviceInput?.removeAttribute('hidden')

  // Pressing the PHONE badge shows a scannable QR of the remote URL; pressing
  // anywhere outside the QR card closes it.
  const showQrOverlay = (): void => {
    if (document.getElementById('qr-overlay')) return
    const overlay = document.createElement('div')
    overlay.id = 'qr-overlay'
    const card = document.createElement('div')
    card.className = 'qr-card'
    const qr = qrcode(0, 'M')
    qr.addData(currentPhoneUrl)
    qr.make()
    card.innerHTML = qr.createSvgTag({ cellSize: 5, margin: 2, scalable: true })
    const label = document.createElement('p')
    label.textContent = currentPhoneUrl
    card.appendChild(label)
    overlay.appendChild(card)
    overlay.addEventListener('pointerdown', (event) => {
      event.stopPropagation()
      if (event.target instanceof Node && card.contains(event.target)) return
      // Swallow the tap that closes the QR so it can't double as a poke.
      pokeSuppressedUntil = performance.now() + 600
      overlay.remove()
    })
    document.body.appendChild(overlay)
  }
  qrWidget.addEventListener('pointerdown', (event) => {
    event.stopPropagation()
    showQrOverlay()
  })
  // The resistive touch mapping lands imprecisely around small targets, so
  // the whole bottom strip of the screen doubles as the QR trigger.
  document.getElementById('qr-hotzone')?.addEventListener('pointerdown', (event) => {
    event.stopPropagation()
    showQrOverlay()
  })

  socket.onConn = (up) => {
    connection.textContent = up ? 'ONLINE' : 'RECONNECTING'
    connection.dataset.state = up ? 'up' : 'down'
    if (up) {
      void refreshPhoneUrl()
      socket.send({ type: 'hello', client: 'kiosk' })
    }
  }
  socket.on('avatar', (event) => renderer.setExpression(expressionForAvatar(event.expression)))
  socket.on('character_active', (event) => swapCharacter(event.characterId))
  socket.on('audio_sink', (event) => {
    kioskAudioActive = forceKioskAudio || event.active
  })
  socket.on('display_rotation', (event) => {
    if (event.degrees === displayRotation) return
    displayRotation = event.degrees
    stage.dataset.rotation = String(event.degrees)
    window.cancelAnimationFrame(rotationFrame)
    rotationFrame = window.requestAnimationFrame(() => {
      renderer.dispose()
      renderer = mountRenderer(stage, character)
      renderer.setSpeaking(agentStatus === 'speaking')
    })
  })
  socket.on('agent_event', (event) => {
    const effect = () => {
      applyAgentEvent(renderer, event.event)
      const sting = stingForAgentEvent(event.event.kind)
      if (sting) stings.play(character.id, sting)
    }
    if (event.event.playbackCue === 'audio-boundary') boundaryQueue.enqueue(effect)
    else effect()
  })
  socket.on('status', (event) => {
    agentStatus = event.state
    if (event.state !== 'idle') pokeExpressionActive = false
    const idle = event.state === 'idle'
    qrWidget.toggleAttribute('hidden', !idle)
    renderer.setSpeaking(event.state === 'speaking')
    if (event.state === 'idle') renderer.setExpression('neutral')
    if (event.state === 'thinking') renderer.setExpression('smug')
    if (event.state === 'listening') renderer.setExpression('shock')
  })
  socket.on('token', (event) => {
    tokenText += event.text
  })
  socket.on('reply', (event) => {
    tokenText = event.say
    if (!pokeExpressionActive) renderer.setExpression(expressionForAvatar(event.emotion))
  })
  socket.on('tts_chunk', (event) => {
    fallbackActive = false
    window.speechSynthesis.cancel()
    renderer.setSpeaking(true)
    if (kioskAudioActive) audio.enqueue(event.data, event.sampleRate)
    else audio.enqueueEnvelope(event.data, event.sampleRate)
  })
  socket.on('notice', (event) => {
    if (event.message === 'tts_interrupt') {
      // Barge-in (e.g. a poke): kill buffered playback immediately so the
      // next TTS line starts on silence.
      window.speechSynthesis.cancel()
      fallbackActive = false
      audio.stop()
      renderer.setSpeaking(false)
      return
    }
    if (event.message !== 'tts_fallback:webspeech' || fallbackActive || !kioskAudioActive || !tokenText.trim()) return
    fallbackActive = true
    speakFallback(tokenText, renderer, () => boundaryQueue.flush())
  })
  socket.on('done', () => {
    tokenText = ''
  })
  socket.connect()

  stage.addEventListener('pointerdown', () => {
    if (document.getElementById('qr-overlay') || performance.now() < pokeSuppressedUntil) return
    pokeExpressionActive = true
    renderer.setExpression('angry')
    // Poke retaliation — Sahur lunges at the glass and swings the baton in
    // big furious arcs (a poke is the demo's physical-interaction beat,
    // subtlety defeats it).
    renderer.playAction('swipe', 3)
    socket.send({ type: 'poke' })
    window.clearTimeout(restorePokeExpression)
    restorePokeExpression = window.setTimeout(() => {
      if (agentStatus === 'idle') renderer.setExpression('neutral')
      pokeExpressionActive = false
    }, 2000)
  })

  if (deviceButton instanceof HTMLButtonElement) {
    const start = async () => {
      if (stopRecording) return
      if (deviceStatus) deviceStatus.textContent = 'LISTENING'
      stopRecording = await startDeviceRecording(socket, (message) => {
        if (deviceStatus) deviceStatus.textContent = message
      })
    }
    const stop = () => {
      stopRecording?.()
      stopRecording = null
      if (deviceStatus) deviceStatus.textContent = ''
    }
    deviceButton.addEventListener('pointerdown', () => void start())
    deviceButton.addEventListener('pointerup', stop)
    deviceButton.addEventListener('pointercancel', stop)
    deviceButton.addEventListener('pointerleave', stop)
  }

  window.addEventListener('pagehide', () => {
    window.clearInterval(phoneUrlInterval)
    window.clearTimeout(restorePokeExpression)
    window.cancelAnimationFrame(rotationFrame)
    audio.stop()
    renderer.dispose()
    socket.close()
  })
}

function applyAgentEvent(renderer: KioskRenderer, event: import('../shared/protocol.ts').AgentEvent): void {
  if (event.kind === 'expression' && typeof event.args.name === 'string') {
    renderer.setExpression(expressionForAvatar(event.args.name))
    return
  }
  const action = actionForAgentEvent(event)
  if (action) renderer.playAction(action.name, action.intensity)
}

function speakFallback(text: string, renderer: KioskRenderer, onBoundary: () => void): void {
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.rate = 1.08
  let closeMouthTimer = 0
  utterance.onstart = () => renderer.setSpeaking(true)
  utterance.onboundary = () => {
    renderer.setMouth(1)
    window.clearTimeout(closeMouthTimer)
    closeMouthTimer = window.setTimeout(() => renderer.setMouth(0.2), 95)
  }
  utterance.onend = () => {
    window.clearTimeout(closeMouthTimer)
    renderer.setMouth(0)
    renderer.setSpeaking(false)
    onBoundary()
  }
  window.speechSynthesis.speak(utterance)
}

async function renderPhoneUrl(widget: HTMLElement, hasDiscoveryInfo: boolean): Promise<string | null> {
  if (!hasDiscoveryInfo) widget.textContent = `PHONE: ${fallbackPhoneUrl()}`
  try {
    const response = await fetch('/info')
    const info: unknown = await response.json()
    if (isDiscoveryInfo(info)) {
      widget.textContent = `PHONE: ${info.phoneUrl}`
      return info.phoneUrl
    }
  } catch {
    // The heuristic stays available for local/dev servers without discovery.
  }
  return null
}

function fallbackPhoneUrl(): string {
  const secure = location.protocol === 'https:'
  const port = secure ? location.port : '8443'
  const portSuffix = port && port !== '443' ? `:${port}` : ''
  return `https://${location.hostname}${portSuffix}/phone`
}

function isDiscoveryInfo(value: unknown): value is { phoneUrl: string; mdnsUrl: string; port: number } {
  if (typeof value !== 'object' || value === null) return false
  const info = value as { phoneUrl?: unknown; mdnsUrl?: unknown; port?: unknown }
  return typeof info.phoneUrl === 'string' && typeof info.mdnsUrl === 'string' && typeof info.port === 'number'
}

function requiredElement(id: string): HTMLElement {
  const element = document.getElementById(id)
  if (!(element instanceof HTMLElement)) throw new Error(`missing kiosk element #${id}`)
  return element
}

function showRendererError(stage: HTMLElement): void {
  const error = document.createElement('output')
  error.className = 'renderer-badge'
  error.textContent = 'RENDERER ERROR — check GPU/WebGL'
  stage.replaceChildren(error)
}

void main().catch((error: unknown) => {
  console.error(error)
  const stage = document.getElementById('stage')
  if (stage) stage.textContent = 'Kiosk could not start'
})
