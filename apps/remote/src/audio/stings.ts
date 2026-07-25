// Discord-soundboard-style character stings: the first few seconds of the
// character's signature theme (assets/bgm/<id>-bgm.mp3, served at /bgm/),
// fired on demo beats and faded out before they can fight the TTS.

export interface StingOptions {
  volume?: number
  maxMs?: number
}

// One sting at a time, spaced out so back-to-back escalations don't turn the
// demo into a jukebox.
const MIN_GAP_MS = 6_000
const FADE_MS = 400

export class StingPlayer {
  private el: HTMLAudioElement | null = null
  private fadeTimer = 0
  private stopTimer = 0
  private lastPlayedAt = 0

  play(characterId: string, options: StingOptions = {}): void {
    const now = performance.now()
    if (now - this.lastPlayedAt < MIN_GAP_MS) return
    this.lastPlayedAt = now
    this.stop()
    const el = new Audio(`/bgm/${characterId}-bgm.mp3`)
    el.volume = options.volume ?? 0.55
    this.el = el
    void el.play().catch((error) => console.warn('[remote] sting playback failed', error))
    this.stopTimer = window.setTimeout(() => this.fadeOut(), Math.max(FADE_MS, (options.maxMs ?? 5_000) - FADE_MS))
  }

  private fadeOut(): void {
    const el = this.el
    if (!el) return
    const step = Math.max(0.02, el.volume / (FADE_MS / 50))
    this.fadeTimer = window.setInterval(() => {
      if (el.volume <= step) {
        this.stop()
        return
      }
      el.volume -= step
    }, 50)
  }

  stop(): void {
    window.clearTimeout(this.stopTimer)
    window.clearInterval(this.fadeTimer)
    if (this.el) {
      this.el.pause()
      this.el.src = ''
      this.el = null
    }
  }
}

// Which agent events earn a sting, and how loud/long. Escalation runs quieter
// and shorter so the knock line stays intelligible on top.
export function stingForAgentEvent(kind: string): StingOptions | null {
  if (kind === 'poke') return { volume: 0.6, maxMs: 5_000 }
  if (kind === 'escalate') return { volume: 0.4, maxMs: 3_000 }
  if (kind === 'task_done') return { volume: 0.5, maxMs: 5_000 }
  return null
}
