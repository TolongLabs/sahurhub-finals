import type { AudioSink } from '../shared/protocol.ts'

export function audioSinkForClient(client: string | undefined): AudioSink {
  return client === 'kiosk' ? 'device' : 'phone'
}

export function isClientActiveAudioSink(client: string | undefined, sink: AudioSink): boolean {
  return audioSinkForClient(client) === sink
}
