import { describe, expect, test } from 'bun:test'
import { DEFAULT_SAHUR_PRESET } from './default-sahur.ts'
import { L4_CHAR_CAP, type VolatileState, compilePrompt, compileStable, compileVolatile } from './prompt.ts'

const emptyState: VolatileState = {
  tasks: [],
  escalation: 0,
  nextWakeAt: null,
  schedulerTrigger: 'cold-start',
  recentMessages: [],
  recentActions: [],
  toolResult: null
}

describe('compileStable (L0-L3)', () => {
  test('is byte-identical across calls for the same character, regardless of volatile state', () => {
    const a = compileStable(DEFAULT_SAHUR_PRESET)
    const b = compileStable(DEFAULT_SAHUR_PRESET)
    expect(a).toBe(b)
  })

  test('documents the exact tag grammar and the character persona', () => {
    const stable = compileStable(DEFAULT_SAHUR_PRESET)
    expect(stable).toContain('<|emotion:NAME|>')
    expect(stable).toContain('<|remind:MINUTES|>')
    expect(stable).toContain('<|escalate|>')
    expect(stable).toContain('<|task:NAME|MINUTES|>')
    expect(stable).toContain('<|task:take medicine|15|>')
    expect(stable).toContain('<|task_done:ID|>')
    expect(stable).toContain('<|task_done:2d0eb3|>')
    expect(stable).toContain('<|schedule:MINUTES|>')
    expect(stable).toContain(DEFAULT_SAHUR_PRESET.bible.identity)
  })

  test('changing volatile state never changes the stable prefix', () => {
    const stableForEmpty = compilePrompt(DEFAULT_SAHUR_PRESET, emptyState).stable
    const busyState: VolatileState = {
      ...emptyState,
      tasks: [{ taskId: '2d0eb3a1', name: 'email Bob', durationMinutes: 10, status: 'reminding', escalation: 1 }],
      escalation: 1,
      schedulerTrigger: 'tick'
    }
    const stableForBusy = compilePrompt(DEFAULT_SAHUR_PRESET, busyState).stable
    expect(stableForBusy).toBe(stableForEmpty)
  })
})

describe('compileVolatile (L4)', () => {
  test('renders the task list, escalation, and scheduler trigger', () => {
    const state: VolatileState = {
      ...emptyState,
      tasks: [{ taskId: '2d0eb3a1', name: 'email Bob', durationMinutes: 10, status: 'reminding', escalation: 1 }],
      escalation: 1,
      schedulerTrigger: 'tick',
      nextWakeAt: 1_700_000_000_000
    }
    const volatile = compileVolatile(state)
    expect(volatile).toContain('email Bob')
    expect(volatile).toMatch(/^- \[2d0eb3\] email Bob \(10m, status=reminding, escalation=1\)$/m)
    expect(volatile).toContain('Escalation level: 1')
    expect(volatile).toContain('Scheduler trigger: tick')
  })

  test('renders "no tasks" and no scheduled wake cleanly', () => {
    const volatile = compileVolatile(emptyState)
    expect(volatile).toContain('Current tasks: none')
    expect(volatile).toContain('Next scheduled wake: none')
  })

  test('stays within the hard cap even with a huge recent-message history', () => {
    const hugeHistory: VolatileState = {
      ...emptyState,
      recentMessages: Array.from({ length: 500 }, (_, i) => ({
        role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
        content: `turn number ${i} with some padding text to make it longer`
      }))
    }
    const volatile = compileVolatile(hugeHistory)
    expect(volatile.length).toBeLessThanOrEqual(L4_CHAR_CAP)
  })

  test('windows to the MOST RECENT messages, dropping the oldest first', () => {
    const state: VolatileState = {
      ...emptyState,
      recentMessages: Array.from({ length: 200 }, (_, i) => ({
        role: 'user' as const,
        content: `turn ${i} `.repeat(5)
      }))
    }
    const volatile = compileVolatile(state)
    expect(volatile).toContain('turn 199')
    expect(volatile).not.toContain('turn 0 ')
  })

  test('strips tag artifacts from both roles before rendering recent-history context', () => {
    const volatile = compileVolatile({
      ...emptyState,
      recentMessages: [
        { role: 'assistant', content: 'I remember <task:take a shit|15> from earlier.' },
        { role: 'user', content: 'What did <|emotion:smug|> I say?' }
      ]
    })

    expect(volatile).toContain('I remember  from earlier.')
    expect(volatile).toContain('What did  I say?')
    expect(volatile).not.toContain('<task:take a shit|15>')
    expect(volatile).not.toContain('<|emotion:smug|>')
  })
})
