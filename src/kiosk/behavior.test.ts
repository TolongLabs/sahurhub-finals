import { expect, test } from 'bun:test'
import { PlaybackBoundaryQueue, actionForAgentEvent, expressionForAvatar } from './behavior.ts'

test('maps server avatar aliases and known agent effects to renderer calls', () => {
  expect(expressionForAvatar('happy')).toBe('smug')
  expect(expressionForAvatar('surprised')).toBe('shock')
  expect(expressionForAvatar('unknown')).toBe('neutral')
  expect(actionForAgentEvent({ kind: 'tung', args: { tier: 3 } })).toEqual({ name: 'remind', intensity: 3 })
  expect(actionForAgentEvent({ kind: 'escalate', args: { level: 2 } })).toEqual({ name: 'escalate', intensity: 2 })
  expect(actionForAgentEvent({ kind: 'remind', args: { minutes: 10 }, animation: 'knock' })).toEqual({
    name: 'knock',
    intensity: 1
  })
})

test('holds audio-boundary effects until playback completes', () => {
  const queue = new PlaybackBoundaryQueue()
  const fired: string[] = []

  queue.enqueue(() => fired.push('boundary'))
  expect(fired).toEqual([])
  queue.flush()
  expect(fired).toEqual(['boundary'])
})
