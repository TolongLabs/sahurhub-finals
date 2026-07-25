// Minimal PCM16LE-mono -> WAV container encoder. qwen3-tts-flash returns raw
// PCM (no header) per docs/trd.md-adjacent chained-backend code, so wrapping
// it ourselves is required to (a) save playable .wav files and (b) feed the
// same bytes back into ASR as a normal audio/wav upload.

export function pcm16ToWav(pcm: Uint8Array, sampleRate: number, channels = 1): Uint8Array {
  const byteRate = sampleRate * channels * 2
  const blockAlign = channels * 2
  const dataSize = pcm.length
  const buf = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buf)

  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i))
  }

  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true) // bits per sample
  writeStr(36, 'data')
  view.setUint32(40, dataSize, true)

  new Uint8Array(buf, 44).set(pcm)
  return new Uint8Array(buf)
}
