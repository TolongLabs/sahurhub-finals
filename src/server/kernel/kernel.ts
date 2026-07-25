// The Agent Kernel (docs/plan.md T11 item 1; docs/trd.md §3.3): the single
// authority over task + escalation state. NO LLM calls happen inside this
// module — it only validates tags already parsed by kernel/tags.ts, applies
// clamped/validated state transitions, and drives the scheduler. The prompt
// layer (persona/prompt.ts) reads the kernel's state; it never writes it.
//
// Task lifecycle: pending -> reminding -> escalated -> done | missed.
// Escalation counter: reset on user action; clamp(min(2, +1)) on an ignored
// reminder tick (ported from Kawan's `pipeline.py` L162-164 counter, and
// `state.py`'s "only the kernel/state module writes status" discipline).

import type { Database } from 'bun:sqlite'
import {
  type TaskRow,
  getTask,
  insertTask,
  latestActiveTaskForConversation,
  listActiveTasks,
  listArmedTasks,
  updateTaskState
} from '../db/dao.ts'
import { type Clock, Scheduler, realClock } from './scheduler.ts'
import { MAX_DURATION_MINUTES, MAX_TASK_NAME_LENGTH, resolveTaskCompletion } from './tags.ts'

export type ReminderHandler = (task: TaskRow) => void

export interface CaptureTaskInput {
  name: string
  durationMinutes: number
  conversationId: string | null
}

function isValidTaskCapture(input: CaptureTaskInput): boolean {
  const name = input.name.trim()
  if (!name || name.length > MAX_TASK_NAME_LENGTH) return false
  if (!Number.isFinite(input.durationMinutes)) return false
  if (input.durationMinutes < 0.1 || input.durationMinutes > MAX_DURATION_MINUTES) return false
  return true
}

const TERMINAL_STATUSES = new Set<TaskRow['status']>(['done', 'dismissed', 'missed'])

export class AgentKernel {
  private reminderHandler: ReminderHandler | null = null

  constructor(
    private readonly db: Database,
    private readonly scheduler: Scheduler = new Scheduler(),
    // Same clock the scheduler was built with (tests inject a shared
    // `FakeClock`) so `nextWakeAt` timestamps and the scheduler's own delay
    // math agree — see docs/test.md if this drifts.
    private readonly clock: Clock = realClock
  ) {}

  setReminderHandler(handler: ReminderHandler): void {
    this.reminderHandler = handler
  }

  // Re-arm every still-active task's timer from persisted state — safe
  // across a server restart (docs/plan.md T11 item 1: "timers rebuild from
  // sqlite on boot").
  rebuild(): void {
    for (const task of listArmedTasks(this.db)) {
      this.armReminder(task)
    }
  }

  // The single-call intent classifier's validated output (docs/trd.md §3.2):
  // returns null (no persistence) if the tag's args fail validation.
  captureTask(input: CaptureTaskInput): TaskRow | null {
    if (!isValidTaskCapture(input)) return null
    // Sub-minute durations are legal (0.17 ≈ 10s demo default) — keep two
    // decimals instead of rounding to whole minutes.
    const duration = Math.round(input.durationMinutes * 100) / 100
    const task = insertTask(this.db, {
      taskName: input.name.trim(),
      duration,
      conversationId: input.conversationId,
      nextWakeAt: this.clock.now() + duration * 60_000
    })
    this.armReminder(task)
    return task
  }

  private armReminder(task: TaskRow): void {
    if (task.nextWakeAt === null || TERMINAL_STATUSES.has(task.status)) return
    this.scheduler.arm(task.taskId, task.nextWakeAt, (taskId) => this.fireReminder(taskId))
  }

  private fireReminder(taskId: string): void {
    const task = getTask(this.db, taskId)
    if (!task || TERMINAL_STATUSES.has(task.status)) return

    const followUpAt = this.clock.now() + task.duration * 60_000

    if (task.status === 'pending') {
      const updated = updateTaskState(this.db, taskId, {
        status: 'reminding',
        escalation: 0,
        nextWakeAt: followUpAt
      })
      this.reminderHandler?.(updated)
      this.armReminder(updated)
      return
    }

    // reminding | escalated, and this tick means the previous reminder went
    // ignored: clamp-increment escalation, or give up once already maxed.
    if (task.escalation >= 2) {
      const updated = updateTaskState(this.db, taskId, { status: 'missed', nextWakeAt: null })
      this.reminderHandler?.(updated)
      return
    }

    const nextEscalation = Math.min(2, task.escalation + 1) as TaskRow['escalation']
    const updated = updateTaskState(this.db, taskId, {
      status: 'escalated',
      escalation: nextEscalation,
      nextWakeAt: followUpAt
    })
    this.reminderHandler?.(updated)
    this.armReminder(updated)
  }

  // Any user action referencing a task resets its escalation counter — the
  // kernel owns this truth, never the prompt (docs/trd.md §3.3).
  onUserAction(taskId: string): TaskRow | null {
    const task = getTask(this.db, taskId)
    if (!task || TERMINAL_STATUSES.has(task.status)) return null
    return updateTaskState(this.db, taskId, { escalation: 0 })
  }

  markDone(taskId: string): TaskRow | null {
    const task = getTask(this.db, taskId)
    if (!task || TERMINAL_STATUSES.has(task.status)) return null
    this.scheduler.cancel(taskId)
    return updateTaskState(this.db, taskId, { status: 'done', nextWakeAt: null })
  }

  dismissTask(taskId: string): TaskRow | null {
    const task = getTask(this.db, taskId)
    if (!task || TERMINAL_STATUSES.has(task.status)) return null
    this.scheduler.cancel(taskId)
    return updateTaskState(this.db, taskId, { status: 'dismissed', nextWakeAt: null })
  }

  completeTaskFromName(name: string, conversationId: string): TaskRow | null {
    const resolution = resolveTaskCompletion(name, this.listActiveTasks(conversationId))
    if (resolution.kind !== 'resolved') {
      console.warn(`task completion ignored (${resolution.kind}): ${name}`)
      return null
    }
    return this.markDone(resolution.task.taskId)
  }

  // The remote's explicit "Escalate" control (protocol.ts EscalateMessage):
  // fires the next reminder tier immediately for the conversation's most
  // recent active task, bypassing the scheduler's wait.
  forceEscalate(conversationId: string): TaskRow | null {
    const task = latestActiveTaskForConversation(this.db, conversationId)
    if (!task) return null
    this.scheduler.cancel(task.taskId)
    this.fireReminder(task.taskId)
    return getTask(this.db, task.taskId)
  }

  listActiveTasks(conversationId?: string): TaskRow[] {
    return listActiveTasks(this.db, conversationId)
  }

  // Overall escalation for the reply envelope's `escalation` wire field
  // (docs/trd.md §3.11) — the highest active-task escalation in scope, or 0.
  currentEscalation(conversationId: string): 0 | 1 | 2 {
    const tasks = listActiveTasks(this.db, conversationId)
    return tasks.reduce<0 | 1 | 2>((max, t) => (t.escalation > max ? t.escalation : max), 0)
  }
}
