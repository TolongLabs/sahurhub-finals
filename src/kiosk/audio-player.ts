export interface KioskAudioPlayerOptions {
  onAmplitude: (amount: number) => void
  onPlaybackBoundary: () => void
}

export class KioskAudioPlayer {
  private ctx: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private nextStartTime = 0
  private amplitudeFrame = 0
  private activeSources = 0
  private envelopeUntil = 0

  constructor(private readonly options: KioskAudioPlayerOptions) {}

  enqueue(base64Data: string, sampleRate: number): void {
    const ctx = this.ensureContext()
    const buffer = decodePcm16(ctx, base64Data, sampleRate)
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(this.analyser ?? ctx.destination)
    const startAt = Math.max(ctx.currentTime, this.nextStartTime)
    this.nextStartTime = startAt + buffer.duration
    this.activeSources += 1
    source.onended = () => {
      this.activeSources -= 1
      if (this.activeSources === 0) this.stopAmplitudeLoop()
      this.options.onAmplitude(0)
      this.options.onPlaybackBoundary()
    }
    source.start(startAt)
    void ctx.resume().catch(() => undefined)
    this.startAmplitudeLoop()
  }

  // The protocol broadcasts raw chunks to both clients but currently has no
  // sink-selection or amplitude field. This lightweight envelope preserves
  // visible lip-sync while the phone owns audible playback.
  enqueueEnvelope(base64Data: string, sampleRate: number): void {
    const durationMs = pcmDurationMs(base64Data, sampleRate)
    if (durationMs <= 0) return
    const startAt = Math.max(performance.now(), this.envelopeUntil)
    this.envelopeUntil = startAt + durationMs
    window.setTimeout(() => this.runEnvelope(startAt, this.envelopeUntil), Math.max(0, startAt - performance.now()))
    window.setTimeout(() => this.options.onPlaybackBoundary(), Math.max(0, this.envelopeUntil - performance.now()))
  }

  stop(): void {
    cancelAnimationFrame(this.amplitudeFrame)
    this.amplitudeFrame = 0
    this.activeSources = 0
    this.nextStartTime = 0
    this.options.onAmplitude(0)
    void this.ctx?.close()
    this.ctx = null
    this.analyser = null
  }

  private ensureContext(): AudioContext {
    if (this.ctx && this.analyser) return this.ctx
    const ctx = new AudioContext()
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 512
    analyser.connect(ctx.destination)
    this.ctx = ctx
    this.analyser = analyser
    return ctx
  }

  private startAmplitudeLoop(): void {
    if (this.amplitudeFrame) return
    const samples = new Uint8Array(this.analyser?.fftSize ?? 512)
    const tick = () => {
      if (!this.analyser || this.activeSources === 0) {
        this.amplitudeFrame = 0
        return
      }
      this.analyser.getByteTimeDomainData(samples)
      let total = 0
      for (const sample of samples) total += Math.abs(sample - 128)
      this.options.onAmplitude(Math.min(1, (total / samples.length / 40) * 1.6))
      this.amplitudeFrame = requestAnimationFrame(tick)
    }
    this.amplitudeFrame = requestAnimationFrame(tick)
  }

  private stopAmplitudeLoop(): void {
    cancelAnimationFrame(this.amplitudeFrame)
    this.amplitudeFrame = 0
  }

  private runEnvelope(startAt: number, endAt: number): void {
    const tick = () => {
      const now = performance.now()
      if (now >= endAt) {
        this.options.onAmplitude(0)
        return
      }
      const progress = Math.max(0, (now - startAt) / Math.max(1, endAt - startAt))
      this.options.onAmplitude(0.25 + Math.abs(Math.sin(progress * Math.PI * 10)) * 0.7)
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }
}

function decodePcm16(ctx: AudioContext, base64Data: string, sampleRate: number): AudioBuffer {
  const bytes = base64ToBytes(base64Data)
  const sampleCount = Math.floor(bytes.byteLength / 2)
  const buffer = ctx.createBuffer(1, sampleCount, sampleRate)
  const channel = buffer.getChannelData(0)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let index = 0; index < sampleCount; index += 1) channel[index] = view.getInt16(index * 2, true) / 32768
  return buffer
}

function pcmDurationMs(base64Data: string, sampleRate: number): number {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) return 0
  return (base64ToBytes(base64Data).byteLength / 2 / sampleRate) * 1000
}

function base64ToBytes(base64Data: string): Uint8Array {
  const binary = atob(base64Data)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}
