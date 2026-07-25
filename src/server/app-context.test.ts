import { describe, expect, test } from 'bun:test'
import { createAppContext } from './app-context.ts'
import { MockVoiceBackend } from './llm/mock-backend.ts'

describe('createAppContext', () => {
  test('defaults to MockVoiceBackend and the Sahur character with no DASHSCOPE_API_KEY set', () => {
    const ctx = createAppContext({ dbPath: ':memory:', charactersDir: 'no/such/dir' })
    expect(ctx.backend).toBeInstanceOf(MockVoiceBackend)
    expect(ctx.characters.get('sahur').manifest.id).toBe('sahur')
  })

  test('accepts an injected backend for tests (never depends on a real API key)', () => {
    const injected = new MockVoiceBackend()
    const ctx = createAppContext({ dbPath: ':memory:', backend: injected })
    expect(ctx.backend).toBe(injected)
  })
})
