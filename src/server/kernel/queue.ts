// The Agent-Kernel seam (docs/plan.md T8/T11): a serialized FIFO event queue.
// User turns, scheduler ticks, and tool results all enqueue here; the kernel
// (T11) is the single consumer that dequeues one event at a time, so nothing
// races the kernel's state machine. This module only defines the queue —
// the kernel logic that consumes it is T11's job.

export class SerializedEventQueue<T> {
  private readonly items: T[] = []
  private readonly waiters: Array<(value: T) => void> = []
  private closed = false

  enqueue(item: T): void {
    if (this.closed) throw new Error('SerializedEventQueue is closed')
    const waiter = this.waiters.shift()
    if (waiter) {
      waiter(item)
      return
    }
    this.items.push(item)
  }

  dequeue(): Promise<T> {
    const item = this.items.shift()
    if (item !== undefined) return Promise.resolve(item)
    return new Promise((resolve) => {
      this.waiters.push(resolve)
    })
  }

  get size(): number {
    return this.items.length
  }

  close(): void {
    this.closed = true
  }
}
