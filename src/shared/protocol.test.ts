import { describe, expect, test } from 'bun:test'
import { isClientMessage, isServerMessage } from './protocol.ts'

describe('isClientMessage', () => {
  test('round-trips a character-bound conversation creation message', () => {
    const original = { type: 'conversation_new', characterId: 'sahur' } as const
    expect(isClientMessage(JSON.parse(JSON.stringify(original)))).toBe(true)
  })

  test('accepts every known client message tag', () => {
    expect(isClientMessage({ type: 'hello' })).toBe(true)
    expect(isClientMessage({ type: 'text', text: 'wake up', source: 'phone' })).toBe(true)
    expect(isClientMessage({ type: 'audio_end', source: 'device' })).toBe(true)
    expect(isClientMessage({ type: 'interrupt' })).toBe(true)
    expect(isClientMessage({ type: 'poke' })).toBe(true)
    expect(isClientMessage({ type: 'conversation_new', characterId: 'sahur' })).toBe(true)
    expect(isClientMessage({ type: 'conversation_switch', conversationId: 'c1' })).toBe(true)
    expect(isClientMessage({ type: 'conversation_delete', conversationId: 'c1' })).toBe(true)
    expect(isClientMessage({ type: 'reset' })).toBe(true)
    expect(isClientMessage({ type: 'character_select', characterId: 'sahur' })).toBe(true)
    expect(isClientMessage({ type: 'escalate' })).toBe(true)
    expect(isClientMessage({ type: 'task_action', taskId: 'task-1', action: 'done' })).toBe(true)
    expect(isClientMessage({ type: 'task_action', taskId: 'task-1', action: 'discard' })).toBe(true)
    expect(isClientMessage({ type: 'title_edit', title: 'Wake-up plans' })).toBe(true)
    expect(isClientMessage({ type: 'camera_stub' })).toBe(true)
    expect(isClientMessage({ type: 'audio_sink', sink: 'device' })).toBe(true)
    expect(isClientMessage({ type: 'display_rotate', degrees: 270 })).toBe(true)
  })

  test('rejects an unknown or malformed type', () => {
    expect(isClientMessage({ type: 'agent_event' })).toBe(false)
    expect(isClientMessage({ type: 'text' })).toBe(false)
    expect(isClientMessage({ type: 'text', text: 42 })).toBe(false)
    expect(isClientMessage({ type: 'audio_sink', sink: 'speaker' })).toBe(false)
    expect(isClientMessage({ type: 'display_rotate', degrees: 45 })).toBe(false)
    expect(isClientMessage({ type: 'title_edit' })).toBe(false)
    expect(isClientMessage({ type: 'conversation_switch' })).toBe(false)
    expect(isClientMessage({ type: 'conversation_new' })).toBe(false)
    expect(isClientMessage({ type: 'task_action', taskId: 'task-1', action: 'snooze' })).toBe(false)
    expect(isClientMessage({ type: 'task_action', action: 'done' })).toBe(false)
    expect(isClientMessage({ type: 42 })).toBe(false)
    expect(isClientMessage(null)).toBe(false)
    expect(isClientMessage('hello')).toBe(false)
    expect(isClientMessage(undefined)).toBe(false)
  })
})

describe('isServerMessage', () => {
  test('accepts every known server message tag, including the Kawan-shaped reply envelope', () => {
    expect(isServerMessage({ type: 'transcript', conversationId: 'c1', text: 'hi', final: true })).toBe(true)
    expect(
      isServerMessage({ type: 'reply', conversationId: 'c1', say: 'wake up', emotion: 'smug', escalation: 1 })
    ).toBe(true)
    expect(
      isServerMessage({
        type: 'agent_event',
        conversationId: 'c1',
        event: { id: '1', kind: 'tung', args: { count: 3 }, playbackCue: 'audio-boundary' }
      })
    ).toBe(true)
  })

  test('rejects an unknown or malformed type', () => {
    expect(isServerMessage({ type: 'hello' })).toBe(false)
    expect(isServerMessage({})).toBe(false)
    expect(isServerMessage([])).toBe(false)
  })

  test('accepts every remote-webapp push event (T11)', () => {
    expect(isServerMessage({ type: 'conversation_list', conversations: [] })).toBe(true)
    expect(isServerMessage({ type: 'conversation_active', conversationId: 'c1' })).toBe(true)
    expect(isServerMessage({ type: 'title', conversationId: 'c1', title: 'Wake-up plans' })).toBe(true)
    expect(isServerMessage({ type: 'task_list', conversationId: 'c1', tasks: [] })).toBe(true)
    expect(
      isServerMessage({
        type: 'message',
        message: { id: 'm1', conversationId: 'c1', role: 'user', content: 'hi', kind: 'text', ts: 0 }
      })
    ).toBe(true)
    expect(isServerMessage({ type: 'message_history', conversationId: 'c1', messages: [] })).toBe(true)
    expect(isServerMessage({ type: 'character_active', characterId: 'sahur' })).toBe(true)
    expect(isServerMessage({ type: 'audio_sink', sink: 'phone', active: true })).toBe(true)
    expect(isServerMessage({ type: 'display_rotation', degrees: 90 })).toBe(true)
    expect(isServerMessage({ type: 'character_list', characters: [{ id: 'sahur', displayName: 'Sahur' }] })).toBe(true)
  })
})
