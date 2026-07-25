import { describe, expect, test } from 'bun:test'
import { TagDedupeGate, extractTags, resolveTaskCompletion, resolveTaskName, splitStreaming } from './tags.ts'

describe('extractTags', () => {
  test('parses a canonical emotion tag and strips it from the text', () => {
    const { clean, events } = extractTags('<|emotion:smug|>Wake up already.')
    expect(clean).toBe('Wake up already.')
    expect(events).toEqual([{ kind: 'emotion', raw: 'emotion:smug', args: { name: 'smug' } }])
  })

  test('tolerates the trailing-pipe-optional variant (model drift)', () => {
    const { clean, events } = extractTags('<|emotion:happy>hi')
    expect(clean).toBe('hi')
    expect(events).toEqual([{ kind: 'emotion', raw: 'emotion:happy', args: { name: 'happy' } }])
  })

  test('rejects an unknown emotion name — stripped, no event', () => {
    const { clean, events } = extractTags('<|emotion:furious|>calm down')
    expect(clean).toBe('calm down')
    expect(events).toEqual([])
  })

  test('parses remind:N within bounds', () => {
    const { events } = extractTags('<|remind:10|>')
    expect(events).toEqual([{ kind: 'remind', raw: 'remind:10', args: { minutes: 10 } }])
  })

  test('rejects remind with an out-of-bound duration', () => {
    const { clean, events } = extractTags('<|remind:99999|>ok')
    expect(clean).toBe('ok')
    expect(events).toEqual([])
  })

  test('parses a valueless escalate tag', () => {
    const { events } = extractTags('<|escalate|>enough excuses')
    expect(events).toEqual([{ kind: 'escalate', raw: 'escalate', args: {} }])
  })

  test('parses a task-capture tag with a pipe-separated name and duration', () => {
    const { clean, events } = extractTags('Got it. <|task:email Bob|10|>I will remind you.')
    expect(clean).toBe('Got it. I will remind you.')
    expect(events).toEqual([{ kind: 'task', raw: 'task:email Bob|10', args: { name: 'email Bob', duration: 10 } }])
  })

  test.each([
    '<task:take a shit|15>',
    '<|task:take a shit|15>',
    '<task:take a shit|15|>',
    '< | TASK : take a shit | 15 | >'
  ])('tolerates a malformed task tag variant: %s', (tag) => {
    const { clean, events } = extractTags(`Okay. ${tag} I will remind you.`)

    expect(clean).toBe('Okay.  I will remind you.')
    expect(events).toEqual([{ kind: 'task', raw: 'task:take a shit|15', args: { name: 'take a shit', duration: 15 } }])
  })

  test('rejects a task tag with an empty name or a non-numeric duration', () => {
    expect(extractTags('<|task:|10|>').events).toEqual([])
    expect(extractTags('<|task:email Bob|soon|>').events).toEqual([])
  })

  test.each(['<|task_done:submit poster|>', '<task_done:submit poster>', '< | TASK_DONE : submit poster | >'])(
    'tolerates a task-done tag variant: %s',
    (tag) => {
      const { clean, events } = extractTags(`Nice. ${tag} Moving on.`)

      expect(clean).toBe('Nice.  Moving on.')
      expect(events).toEqual([{ kind: 'task_done', raw: 'task_done:submit poster', args: { name: 'submit poster' } }])
    }
  )

  test('rejects a task-done tag with no task name', () => {
    expect(extractTags('<|task_done:|>').events).toEqual([])
  })

  test('rejects an out-of-allowlist tag kind — stripped, no event', () => {
    const { clean, events } = extractTags('<|inspect_camera|>look')
    expect(clean).toBe('look')
    expect(events).toEqual([])
  })

  test('parses schedule:N', () => {
    expect(extractTags('<|schedule:15|>').events).toEqual([
      { kind: 'schedule', raw: 'schedule:15', args: { minutes: 15 } }
    ])
  })

  test("a duplicate tag in one buffer produces two raw-identical events (dedup is the caller's job)", () => {
    const { events } = extractTags('<|emotion:happy|>a<|emotion:happy|>b')
    expect(events).toHaveLength(2)
  })
})

describe('resolveTaskName', () => {
  const tasks = [
    { taskId: 'poster', taskName: 'Submit Poster' },
    { taskId: 'slides', taskName: 'Finish Slides' }
  ]

  test('prefers a case-insensitive exact active-task match', () => {
    expect(resolveTaskName('submit poster', tasks)).toMatchObject({ kind: 'resolved', task: { taskId: 'poster' } })
  })

  test('accepts one unambiguous substring match', () => {
    expect(resolveTaskName('slides', tasks)).toMatchObject({ kind: 'resolved', task: { taskId: 'slides' } })
  })

  test('refuses an ambiguous substring match', () => {
    expect(
      resolveTaskName('submit', [
        { taskId: 'poster', taskName: 'Submit Poster' },
        { taskId: 'report', taskName: 'Submit Report' }
      ])
    ).toEqual({ kind: 'ambiguous' })
  })

  test('does not resolve a task name that is absent', () => {
    expect(resolveTaskName('groceries', tasks)).toEqual({ kind: 'not_found' })
  })
})

describe('resolveTaskCompletion', () => {
  const tasks = [
    { taskId: '2d0eb3a1-aaaa-bbbb-cccc-000000000001', taskName: 'Submit Poster' },
    { taskId: '7f1c9d22-aaaa-bbbb-cccc-000000000002', taskName: 'Finish Slides' }
  ]

  test('resolves a case-insensitive exact task id before task names', () => {
    expect(resolveTaskCompletion('2D0EB3A1-AAAA-BBBB-CCCC-000000000001', tasks)).toMatchObject({
      kind: 'resolved',
      task: { taskId: '2d0eb3a1-aaaa-bbbb-cccc-000000000001' }
    })
  })

  test('resolves an unambiguous task-id prefix of at least four characters', () => {
    expect(resolveTaskCompletion('7F1C9D', tasks)).toMatchObject({
      kind: 'resolved',
      task: { taskId: '7f1c9d22-aaaa-bbbb-cccc-000000000002' }
    })
  })

  test('ignores an ambiguous task-id prefix', () => {
    expect(
      resolveTaskCompletion('abcd', [
        { taskId: 'abcd1111-aaaa-bbbb-cccc-000000000001', taskName: 'Write Report' },
        { taskId: 'abcd2222-aaaa-bbbb-cccc-000000000002', taskName: 'Book Venue' }
      ])
    ).toEqual({ kind: 'ambiguous' })
  })

  test('falls back to the existing name resolution for name-emitting models', () => {
    expect(resolveTaskCompletion('slides', tasks)).toMatchObject({
      kind: 'resolved',
      task: { taskId: '7f1c9d22-aaaa-bbbb-cccc-000000000002' }
    })
  })
})

describe('splitStreaming (partial-tag holdback)', () => {
  test('holds back a lone trailing "<" so it never leaks as visible text', () => {
    const result = splitStreaming('hello <')
    expect(result.clean).toBe('hello ')
    expect(result.remainder).toBe('<')
    expect(result.events).toEqual([])
  })

  test('holds back an unterminated "<|emotion:" mid-tag', () => {
    const result = splitStreaming('hi <|emotion:')
    expect(result.clean).toBe('hi ')
    expect(result.remainder).toBe('<|emotion:')
  })

  test('reassembling a tag split across two deltas parses cleanly', () => {
    const first = splitStreaming('<|emo')
    expect(first.clean).toBe('')
    expect(first.remainder).toBe('<|emo')

    const second = splitStreaming(`${first.remainder}tion:smug|>hi`)
    expect(second.clean).toBe('hi')
    expect(second.events).toEqual([{ kind: 'emotion', raw: 'emotion:smug', args: { name: 'smug' } }])
    expect(second.remainder).toBe('')
  })

  test('a complete tag with trailing prose is not held back', () => {
    const result = splitStreaming('<|emotion:happy|>all done here')
    expect(result.clean).toBe('all done here')
    expect(result.remainder).toBe('')
  })

  test('a stray "<" with more text already following it in the SAME buffer still flushes once a later ">" appears', () => {
    const result = splitStreaming('2 < 3 is true, <|emotion:happy|> right?')
    expect(result.clean).toBe('2 < 3 is true,  right?')
    expect(result.events).toEqual([{ kind: 'emotion', raw: 'emotion:happy', args: { name: 'happy' } }])
  })

  test('a stray unterminated "<" at true stream end is held back, then flushes as literal text on extractTags', () => {
    const result = splitStreaming('2 < 3 is true')
    expect(result.clean).toBe('2 ')
    expect(result.remainder).toBe('< 3 is true')
    const flushed = extractTags(result.remainder)
    expect(flushed.clean).toBe('< 3 is true')
    expect(flushed.events).toEqual([])
  })
})

describe('TagDedupeGate', () => {
  test('drops a repeated tag (same raw key) within one turn', () => {
    const gate = new TagDedupeGate()
    const { events } = extractTags('<|emotion:happy|>a<|emotion:happy|>b')
    expect(gate.filter(events)).toHaveLength(1)
  })

  test('keeps distinct tags and dedups across multiple filter() calls in the same turn', () => {
    const gate = new TagDedupeGate()
    const first = gate.filter(extractTags('<|emotion:happy|>').events)
    const second = gate.filter(extractTags('<|emotion:happy|><|escalate|>').events)
    expect(first).toHaveLength(1)
    expect(second).toEqual([{ kind: 'escalate', raw: 'escalate', args: {} }])
  })

  test('rate-limits to a bounded number of events per turn', () => {
    const gate = new TagDedupeGate()
    const many = Array.from({ length: 20 }, (_, i) => `<|remind:${i + 1}|>`).join('')
    const { events } = extractTags(many)
    expect(gate.filter(events).length).toBeLessThanOrEqual(12)
  })
})
