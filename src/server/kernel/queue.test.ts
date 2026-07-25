import { describe, expect, test } from 'bun:test'
import { SerializedEventQueue } from './queue.ts'

describe('SerializedEventQueue', () => {
  test('dequeues items in enqueue order (FIFO)', async () => {
    const queue = new SerializedEventQueue<string>()
    queue.enqueue('turn:1')
    queue.enqueue('tick:1')
    queue.enqueue('tool:1')

    expect(queue.size).toBe(3)
    expect(await queue.dequeue()).toBe('turn:1')
    expect(await queue.dequeue()).toBe('tick:1')
    expect(await queue.dequeue()).toBe('tool:1')
    expect(queue.size).toBe(0)
  })

  test('a dequeue() called before any enqueue() resolves once an item arrives', async () => {
    const queue = new SerializedEventQueue<number>()
    const pending = queue.dequeue()
    queue.enqueue(42)
    expect(await pending).toBe(42)
  })

  test('serializes interleaved producers into one consumption order', async () => {
    const queue = new SerializedEventQueue<string>()
    const consumed: string[] = []

    const consumer = (async () => {
      for (let i = 0; i < 4; i++) consumed.push(await queue.dequeue())
    })()

    queue.enqueue('a')
    queue.enqueue('b')
    await Promise.resolve()
    queue.enqueue('c')
    queue.enqueue('d')

    await consumer
    expect(consumed).toEqual(['a', 'b', 'c', 'd'])
  })

  test('enqueue throws after close()', () => {
    const queue = new SerializedEventQueue<string>()
    queue.close()
    expect(() => queue.enqueue('late')).toThrow('SerializedEventQueue is closed')
  })
})
