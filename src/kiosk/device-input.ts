import type { SahurSocket } from '../shared/ws-client.ts'

const CHUNK_MS = 250

export async function startDeviceRecording(
  socket: SahurSocket,
  onError: (message: string) => void
): Promise<() => void> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const recorder = new MediaRecorder(stream, preferredRecorderOptions())
    recorder.ondataavailable = (event) => {
      if (event.data.size === 0) return
      void event.data
        .arrayBuffer()
        .then((data) => socket.sendBinary(data))
        .catch(() => onError('could not read microphone data'))
    }
    recorder.onerror = () => onError('microphone recording failed')
    recorder.start(CHUNK_MS)
    return () => {
      if (recorder.state !== 'inactive') recorder.stop()
      for (const track of stream.getTracks()) track.stop()
      socket.send({ type: 'audio_end', source: 'device' })
    }
  } catch {
    onError('microphone permission denied')
    return () => undefined
  }
}

function preferredRecorderOptions(): MediaRecorderOptions | undefined {
  const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find(MediaRecorder.isTypeSupported)
  return mimeType ? { mimeType } : undefined
}
