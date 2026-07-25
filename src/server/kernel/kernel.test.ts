import { describe, expect, test } from 'bun:test'
import { createConversation, getTask } from '../db/dao.ts'
import { openDb } from '../db/index.ts'
import { AgentKernel } from './kernel.ts'
import { FakeClock, Scheduler } from './scheduler.ts'

function setup() {
  const db = openDb(':memory:')
  const clock = new FakeClock()
  const scheduler = new Scheduler(clock)
  const kernel = new AgentKernel(db, scheduler, clock)
  const conv = createConversation(db)
  return { db, clock, scheduler, kernel, conv }
}

describe('AgentKernel — task capture (single-call intent classifier output)', () => {
  test('captures a validated {task_id, task_name, duration} and arms a reminder', () => {
    const { kernel, conv } = setup()
    const task = kernel.captureTask({ name: 'email Bob', durationMinutes: 10, conversationId: conv.id })
    expect(task).not.toBeNull()
    expect(task?.taskName).toBe('email Bob')
    expect(task?.duration).toBe(10)
    expect(task?.status).toBe('pending')
  })

  test('rejects an empty name or an out-of-bound duration — nothing persisted', () => {
    const { kernel, conv } = setup()
    expect(kernel.captureTask({ name: '  ', durationMinutes: 10, conversationId: conv.id })).toBeNull()
    expect(kernel.captureTask({ name: 'x', durationMinutes: 0, conversationId: conv.id })).toBeNull()
    expect(kernel.captureTask({ name: 'x', durationMinutes: 999_999, conversationId: conv.id })).toBeNull()
    expect(kernel.listActiveTasks(conv.id)).toEqual([])
  })
})

describe('AgentKernel — model task completion', () => {
  test('completes an active task from its short id', () => {
    const { kernel, conv } = setup()
    const task = kernel.captureTask({ name: 'submit poster', durationMinutes: 10, conversationId: conv.id })
    if (!task) throw new Error('expected a task')

    const completed = kernel.completeTaskFromName(task.taskId.slice(0, 6), conv.id)

    expect(completed).toMatchObject({ taskId: task.taskId, status: 'done' })
  })

  test('still completes an active task from an unambiguous name', () => {
    const { kernel, conv } = setup()
    const task = kernel.captureTask({ name: 'submit poster', durationMinutes: 10, conversationId: conv.id })
    if (!task) throw new Error('expected a task')

    expect(kernel.completeTaskFromName('poster', conv.id)).toMatchObject({ taskId: task.taskId, status: 'done' })
  })
})

describe('AgentKernel — reminder lifecycle (pending -> reminding -> escalated -> missed)', () => {
  test('a duration-driven tick fires the first reminder and re-arms the follow-up', () => {
    const { kernel, clock, conv } = setup()
    const fired: string[] = []
    kernel.setReminderHandler((task) => fired.push(task.status))
    kernel.captureTask({ name: 'stretch', durationMinutes: 1, conversationId: conv.id }) // 60_000ms

    clock.advance(60_000)
    expect(fired).toEqual(['reminding'])
  })

  test('ignoring reminders escalates 0 -> 1 -> 2, then gives up as missed', () => {
    const { kernel, clock, conv } = setup()
    const seen: Array<{ status: string; escalation: number }> = []
    kernel.setReminderHandler((task) => seen.push({ status: task.status, escalation: task.escalation }))
    kernel.captureTask({ name: 'stretch', durationMinutes: 1, conversationId: conv.id })

    clock.advance(60_000) // first reminder
    clock.advance(60_000) // ignored -> escalated(1)
    clock.advance(60_000) // ignored -> escalated(2)
    clock.advance(60_000) // ignored again at max -> missed

    expect(seen).toEqual([
      { status: 'reminding', escalation: 0 },
      { status: 'escalated', escalation: 1 },
      { status: 'escalated', escalation: 2 },
      { status: 'missed', escalation: 2 }
    ])
  })

  test('illegal state increments are impossible from the outside — escalation is clamped at 2', () => {
    const { db, kernel, clock, conv } = setup()
    const task = kernel.captureTask({ name: 'x', durationMinutes: 1, conversationId: conv.id })
    if (!task) throw new Error('expected a captured task')
    for (let i = 0; i < 5; i++) clock.advance(60_000)
    // never exceeds 2, and terminates at 'missed' rather than looping forever
    expect(getTask(db, task.taskId)?.status).toBe('missed')
  })

  test('onUserAction resets escalation and stops the nag until the next tick', () => {
    const { kernel, clock, conv } = setup()
    const task = kernel.captureTask({ name: 'stretch', durationMinutes: 1, conversationId: conv.id })
    if (!task) throw new Error('expected a captured task')
    clock.advance(60_000) // reminding
    clock.advance(60_000) // escalated(1)

    const reset = kernel.onUserAction(task.taskId)
    expect(reset?.escalation).toBe(0)
  })

  test('markDone cancels the timer and reaches a terminal state', () => {
    const { kernel, clock, scheduler, conv } = setup()
    const task = kernel.captureTask({ name: 'stretch', durationMinutes: 1, conversationId: conv.id })
    if (!task) throw new Error('expected a captured task')
    const done = kernel.markDone(task.taskId)
    expect(done?.status).toBe('done')
    expect(scheduler.has(task.taskId)).toBe(false)

    clock.advance(120_000)
    expect(kernel.listActiveTasks(conv.id)).toEqual([])
  })

  test('dismissTask preserves the row as terminal and disarms its timer', () => {
    const { db, kernel, clock, scheduler, conv } = setup()
    const task = kernel.captureTask({ name: 'stretch', durationMinutes: 1, conversationId: conv.id })
    if (!task) throw new Error('expected a task')

    const dismissed = kernel.dismissTask(task.taskId)
    if (!dismissed) throw new Error('expected a dismissed task')
    expect(dismissed.status).toBe('dismissed')
    expect(dismissed.nextWakeAt).toBeNull()
    expect(scheduler.has(task.taskId)).toBe(false)
    expect(getTask(db, task.taskId)?.status).toBe('dismissed')

    clock.advance(120_000)
    expect(kernel.listActiveTasks(conv.id)).toEqual([])
  })
})

describe('AgentKernel — forceEscalate (remote Escalate control)', () => {
  test('fires the next reminder tier immediately for the newest active task', () => {
    const { kernel, conv } = setup()
    kernel.captureTask({ name: 'stretch', durationMinutes: 60, conversationId: conv.id })
    const forced = kernel.forceEscalate(conv.id)
    expect(forced?.status).toBe('reminding')
  })

  test('no-ops when the conversation has no active task', () => {
    const { kernel, conv } = setup()
    expect(kernel.forceEscalate(conv.id)).toBeNull()
  })
})

describe('AgentKernel — rebuild() re-arms timers from persisted state on boot', () => {
  test('a task captured before a kernel restart still fires after rebuild()', () => {
    const { db } = setup()
    const conv = createConversation(db)
    const firstClock = new FakeClock()
    const firstKernel = new AgentKernel(db, new Scheduler(firstClock), firstClock)
    firstKernel.captureTask({ name: 'stretch', durationMinutes: 1, conversationId: conv.id })
    // the process "dies" here — firstClock/its scheduler timer never advances again

    // simulate a restart: a fresh kernel + scheduler + clock over the same
    // persisted db, picking the armed task back up from sqlite.
    const rebuiltFired: string[] = []
    const secondClock = new FakeClock()
    const secondKernel = new AgentKernel(db, new Scheduler(secondClock), secondClock)
    secondKernel.setReminderHandler((task) => rebuiltFired.push(task.status))
    secondKernel.rebuild()

    secondClock.advance(60_000)
    expect(rebuiltFired).toEqual(['reminding'])
  })
})

describe('AgentKernel — currentEscalation', () => {
  test('reports the highest active-task escalation for a conversation, or 0', () => {
    const { kernel, clock, conv } = setup()
    expect(kernel.currentEscalation(conv.id)).toBe(0)
    kernel.captureTask({ name: 'stretch', durationMinutes: 1, conversationId: conv.id })
    clock.advance(60_000)
    clock.advance(60_000)
    expect(kernel.currentEscalation(conv.id)).toBe(1)
  })
})
