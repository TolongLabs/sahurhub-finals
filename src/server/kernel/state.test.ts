import { describe, expect, test } from 'bun:test'
import { initialKernelState } from './state.ts'

describe('initialKernelState', () => {
  test('is idle, unescalated, with no task or scheduled wake', () => {
    expect(initialKernelState()).toEqual({
      task: null,
      status: 'idle',
      escalation: 0,
      nextWakeAt: null,
      lastActionIds: []
    })
  })

  test('returns a fresh object each call (no shared mutable state)', () => {
    const a = initialKernelState()
    const b = initialKernelState()
    a.lastActionIds.push('x')
    expect(b.lastActionIds).toEqual([])
  })
})
