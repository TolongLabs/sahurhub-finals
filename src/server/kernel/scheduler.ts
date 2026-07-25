// Duration-driven follow-up scheduler (docs/plan.md T11 item 1; timing model
// adapted from Kawan's backend/app/scheduler.py — real jobs keyed by id,
// rebuilt from the DB on boot so a restart mid-reminder is safe). Timers are
// injectable via a `Clock` so kernel tests drive them deterministically
// instead of racing real `setTimeout`s (docs/plan.md T11 quality bar:
// "scheduler timing w/ fake timers").

export interface Clock {
  now(): number
  setTimer(fn: () => void, delayMs: number): unknown
  clearTimer(handle: unknown): void
}

export const realClock: Clock = {
  now: () => Date.now(),
  setTimer: (fn, delayMs) => setTimeout(fn, delayMs),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
}

// A deterministic clock for tests: `advance(ms)` fires every timer whose due
// time has been reached, in due-time order — no real waiting required.
export class FakeClock implements Clock {
  private time = 0
  private nextId = 1
  private readonly timers = new Map<number, { at: number; fn: () => void }>()

  now(): number {
    return this.time
  }

  setTimer(fn: () => void, delayMs: number): unknown {
    const id = this.nextId++
    this.timers.set(id, { at: this.time + Math.max(0, delayMs), fn })
    return id
  }

  clearTimer(handle: unknown): void {
    this.timers.delete(handle as number)
  }

  advance(ms: number): void {
    this.time += ms
    const due = [...this.timers.entries()].filter(([, t]) => t.at <= this.time).sort((a, b) => a[1].at - b[1].at)
    for (const [id, timer] of due) {
      this.timers.delete(id)
      timer.fn()
    }
  }

  get pendingCount(): number {
    return this.timers.size
  }
}

// One timer per task id — arming replaces any prior timer for that id.
export class Scheduler {
  private readonly handles = new Map<string, unknown>()

  constructor(private readonly clock: Clock = realClock) {}

  arm(taskId: string, fireAt: number, onFire: (taskId: string) => void): void {
    this.cancel(taskId)
    const delay = Math.max(0, fireAt - this.clock.now())
    const handle = this.clock.setTimer(() => {
      this.handles.delete(taskId)
      onFire(taskId)
    }, delay)
    this.handles.set(taskId, handle)
  }

  cancel(taskId: string): void {
    const handle = this.handles.get(taskId)
    if (handle === undefined) return
    this.clock.clearTimer(handle)
    this.handles.delete(taskId)
  }

  has(taskId: string): boolean {
    return this.handles.has(taskId)
  }

  get armedCount(): number {
    return this.handles.size
  }
}
