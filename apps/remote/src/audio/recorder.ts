// Push-to-talk mic capture. Ports the pattern from spikes/https-mic/index.html
// (MediaRecorder over getUserMedia, opus/webm chunks) rather than the plan
// prose's literal "16kHz PCM/WAV" — the spike itself never produces raw PCM
// either, and picking a codec the server decodes is T11's call at T13.
// Streams a chunk roughly every `TIMESLICE_MS` (docs/plan.md T10a: "sending
// audio frames + audio_end") instead of the spike's one-blob-on-stop.

const TIMESLICE_MS = 250

export interface RecorderController {
  stop(): Promise<void>
}

export interface RecorderCallbacks {
  onFrame: (data: ArrayBuffer) => void
  onLevel: (level: number) => void
  onError: (message: string) => void
}

export interface AudioLevel {
  rms: number
  peak: number
}

function pickMimeType(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']
  for (const candidate of candidates) {
    if (MediaRecorder.isTypeSupported(candidate)) return candidate
  }
  return ''
}

export async function startRecording(callbacks: RecorderCallbacks): Promise<RecorderController> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const mimeType = pickMimeType()
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
  const stopLevelMonitor = startLevelMonitor(stream, callbacks.onLevel)
  const pendingChunks = new Set<Promise<void>>()
  let stopPromise: Promise<void> | null = null

  recorder.ondataavailable = (event) => {
    if (event.data.size === 0) return
    const chunk = event.data
      .arrayBuffer()
      .then(callbacks.onFrame)
      .catch(() => callbacks.onError('failed to read recording chunk'))
      .finally(() => pendingChunks.delete(chunk))
    pendingChunks.add(chunk)
  }
  recorder.onerror = () => callbacks.onError('recording failed')

  recorder.start(TIMESLICE_MS)

  return {
    stop() {
      if (stopPromise) return stopPromise

      stopPromise = new Promise((resolve) => {
        const finish = () => {
          void Promise.all(pendingChunks).then(() => {
            stopLevelMonitor()
            for (const track of stream.getTracks()) track.stop()
            resolve()
          })
        }

        recorder.onstop = finish
        if (recorder.state === 'inactive') finish()
        else recorder.stop()
      })

      return stopPromise
    }
  }
}

export function calculateAudioLevel(samples: Uint8Array): AudioLevel {
  let peak = 0
  let sumOfSquares = 0

  for (const sample of samples) {
    const value = (sample - 128) / 128
    peak = Math.max(peak, Math.abs(value))
    sumOfSquares += value * value
  }

  return {
    peak,
    rms: Math.sqrt(sumOfSquares / samples.length)
  }
}

function startLevelMonitor(stream: MediaStream, onLevel: (level: number) => void): () => void {
  const context = new AudioContext()
  const source = context.createMediaStreamSource(stream)
  const analyser = context.createAnalyser()
  const samples = new Uint8Array(analyser.fftSize)
  let frameId = 0

  source.connect(analyser)
  if (context.state === 'suspended') void context.resume().catch(() => {})

  function measure() {
    analyser.getByteTimeDomainData(samples)
    const { rms, peak } = calculateAudioLevel(samples)
    onLevel(Math.max(rms, peak * 0.65))
    frameId = window.requestAnimationFrame(measure)
  }

  measure()

  return () => {
    window.cancelAnimationFrame(frameId)
    source.disconnect()
    analyser.disconnect()
    void context.close()
  }
}
