import { describe, expect, test } from 'bun:test'
import { audioSinkForClient, isClientActiveAudioSink } from './audio-sink.ts'

describe('audio sink routing', () => {
  test('maps the kiosk to device audio and the remote to phone audio', () => {
    expect(audioSinkForClient('kiosk')).toBe('device')
    expect(audioSinkForClient('remote')).toBe('phone')
  })

  test('activates exactly the client that owns the selected sink', () => {
    expect(isClientActiveAudioSink('kiosk', 'device')).toBe(true)
    expect(isClientActiveAudioSink('remote', 'device')).toBe(false)
    expect(isClientActiveAudioSink('kiosk', 'phone')).toBe(false)
    expect(isClientActiveAudioSink('remote', 'phone')).toBe(true)
  })
})
