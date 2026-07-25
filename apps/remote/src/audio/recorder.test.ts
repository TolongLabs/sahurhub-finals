import { expect, test } from 'bun:test'
import { calculateAudioLevel } from './recorder.ts'

test('derives RMS and peak levels from live audio samples', () => {
  const level = calculateAudioLevel(new Uint8Array([128, 255, 1, 128]))

  expect(level.peak).toBeCloseTo(0.992, 3)
  expect(level.rms).toBeCloseTo(0.702, 3)
})
