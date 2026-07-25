// Minimal gapless playback for streamed TTS chunks (docs/plan.md T10a "Audio
// playback seam"). ASSUMPTION (flag for T11): `TtsChunkEvent.data` is base64
// mono PCM16LE at `sampleRate` — the protocol only documents the field names,
// not the encoding; confirm against the real TTS lane at T13. Schedules each
// decoded chunk back-to-back on one AudioContext timeline for gapless output,
// same technique LLaMaDesu's audio player used.

export class TtsPlayer {
  private ctx: AudioContext | null = null
  private nextStartTime = 0
  private muted = false

  setMuted(muted: boolean): void {
    this.muted = muted
  }

  // Chunks arriving while the context is locked by the browser's autoplay
  // policy are dropped, not queued — replaying a stale backlog after the
  // first tap is worse than missing the line.
  enqueue(base64Data: string, sampleRate: number): void {
    if (this.muted) return
    const ctx = this.ensureContext()
    if (ctx.state === 'suspended') return
    const bytes = base64ToBytes(base64Data)
    const samples = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2))
    const buffer = ctx.createBuffer(1, samples.length, sampleRate)
    const channel = buffer.getChannelData(0)
    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i] ?? 0
      channel[i] = sample / 32768
    }
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(ctx.destination)
    const startAt = Math.max(ctx.currentTime, this.nextStartTime)
    source.start(startAt)
    this.nextStartTime = startAt + buffer.duration
  }

  stop(): void {
    this.nextStartTime = 0
    this.ctx?.close()
    this.ctx = null
  }

  isLocked(): boolean {
    return this.ensureContext().state === 'suspended'
  }

  async unlock(): Promise<boolean> {
    const ctx = this.ensureContext()
    if (ctx.state === 'suspended') await ctx.resume().catch(() => {})
    return ctx.state !== 'suspended'
  }

  private ensureContext(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext()
    return this.ctx
  }
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
