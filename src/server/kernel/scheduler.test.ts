import { describe, expect, test } from 'bun:test'
import { FakeClock, Scheduler } from './scheduler.ts'

describe('Scheduler (fake-timer driven)', () => {
  test('arm() fires onFire once the clock reaches fireAt', () => {
    const clock = new FakeClock()
    const scheduler = new Scheduler(clock)
    const fired: string[] = []
    scheduler.arm('task-1', 1000, (id) => fired.push(id))

    clock.advance(500)
    expect(fired).toEqual([])
    clock.advance(500)
    expect(fired).toEqual(['task-1'])
  })

  test('re-arming the same task id replaces the prior timer (no double-fire)', () => {
    const clock = new FakeClock()
    const scheduler = new Scheduler(clock)
    const fired: string[] = []
    scheduler.arm('task-1', 1000, (id) => fired.push(id))
    scheduler.arm('task-1', 2000, (id) => fired.push(id))

    clock.advance(1000)
    expect(fired).toEqual([]) // the first (1000ms) timer was replaced, not fired
    clock.advance(1000)
    expect(fired).toEqual(['task-1'])
  })

  test('cancel() removes an armed timer before it fires', () => {
    const clock = new FakeClock()
    const scheduler = new Scheduler(clock)
    const fired: string[] = []
    scheduler.arm('task-1', 1000, (id) => fired.push(id))
    scheduler.cancel('task-1')

    clock.advance(2000)
    expect(fired).toEqual([])
    expect(scheduler.has('task-1')).toBe(false)
  })

  test('multiple armed tasks fire independently in due-time order', () => {
    const clock = new FakeClock()
    const scheduler = new Scheduler(clock)
    const fired: string[] = []
    scheduler.arm('slow', 2000, (id) => fired.push(id))
    scheduler.arm('fast', 500, (id) => fired.push(id))

    clock.advance(2000)
    expect(fired).toEqual(['fast', 'slow'])
    expect(scheduler.armedCount).toBe(0)
  })

  test('a fireAt in the past fires on the very next advance (clamped delay)', () => {
    const clock = new FakeClock()
    const scheduler = new Scheduler(clock)
    const fired: string[] = []
    scheduler.arm('overdue', -500, (id) => fired.push(id))

    clock.advance(1)
    expect(fired).toEqual(['overdue'])
  })
})
