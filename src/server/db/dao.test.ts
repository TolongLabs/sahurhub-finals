import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  countMessages,
  createConversation,
  deleteConversation,
  deleteMessages,
  getConversation,
  getSetting,
  getTask,
  insertMessage,
  insertTask,
  latestActiveTaskForConversation,
  listActiveTasks,
  listConversations,
  listMessages,
  setSetting,
  updateConversationTitle,
  updateTaskState
} from './dao.ts'
import { openDb } from './index.ts'

describe('bun:sqlite DAO', () => {
  test('opens an in-memory DB with the schema ready', () => {
    const db = openDb(':memory:')
    expect(listConversations(db)).toEqual([])
  })

  test('a conversation round-trips and can be renamed', () => {
    const db = openDb(':memory:')
    const conv = createConversation(db)
    expect(conv.title).toBeNull()
    expect(conv.characterId).toBe('sahur')
    expect(getConversation(db, conv.id)).toEqual(conv)

    const renamed = updateConversationTitle(db, conv.id, 'Wake-up plans')
    expect(renamed.title).toBe('Wake-up plans')
    expect(getConversation(db, conv.id)?.title).toBe('Wake-up plans')
  })

  test('listConversations returns newest first', () => {
    const db = openDb(':memory:')
    const a = createConversation(db)
    const b = createConversation(db, { title: 'second' })
    const ids = listConversations(db).map((c) => c.id)
    expect(ids).toEqual([b.id, a.id])
  })

  test('backfills Sahur as the character for conversations from the previous schema', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sahurhub-conversation-migration-'))
    const path = join(dir, 'history.sqlite')
    const legacy = new Database(path)
    legacy.exec(`
      CREATE TABLE conversations (
        id TEXT PRIMARY KEY,
        title TEXT,
        created_at INTEGER NOT NULL
      );
      INSERT INTO conversations (id, title, created_at) VALUES ('legacy', 'Old chat', 1);
    `)
    legacy.close()

    try {
      const db = openDb(path)
      expect(getConversation(db, 'legacy')).toMatchObject({ id: 'legacy', characterId: 'sahur' })
      db.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('messages round-trip under a conversation, in ts order', () => {
    const db = openDb(':memory:')
    const conv = createConversation(db)
    insertMessage(db, { conversationId: conv.id, role: 'user', content: 'wake me in 10 minutes', ts: 1 })
    insertMessage(db, { conversationId: conv.id, role: 'assistant', content: 'got it', kind: 'text', ts: 2 })

    const messages = listMessages(db, conv.id)
    expect(messages).toHaveLength(2)
    expect(messages[0]?.role).toBe('user')
    expect(messages[1]?.role).toBe('assistant')
    expect(countMessages(db, conv.id)).toBe(2)
  })

  test('listMessages with a limit returns the most recent N in chronological order', () => {
    const db = openDb(':memory:')
    const conv = createConversation(db)
    for (let i = 0; i < 5; i++) {
      insertMessage(db, { conversationId: conv.id, role: 'user', content: `turn ${i}`, ts: i })
    }
    const recent = listMessages(db, conv.id, { limit: 2 })
    expect(recent.map((m) => m.content)).toEqual(['turn 3', 'turn 4'])
  })

  test('deleteMessages clears a conversation thread without deleting the conversation', () => {
    const db = openDb(':memory:')
    const conv = createConversation(db)
    insertMessage(db, { conversationId: conv.id, role: 'user', content: 'hi' })
    deleteMessages(db, conv.id)
    expect(countMessages(db, conv.id)).toBe(0)
    expect(getConversation(db, conv.id)).not.toBeNull()
  })

  test('deleteConversation cascades its messages and orphans its tasks', () => {
    const db = openDb(':memory:')
    const conv = createConversation(db)
    insertMessage(db, { conversationId: conv.id, role: 'user', content: 'hi' })
    const task = insertTask(db, { taskName: 'submit poster', duration: 30, conversationId: conv.id })

    deleteConversation(db, conv.id)

    expect(getConversation(db, conv.id)).toBeNull()
    expect(countMessages(db, conv.id)).toBe(0)
    expect(getTask(db, task.taskId)?.conversationId).toBeNull()
  })

  test('a task round-trips as the minimal {task_id, task_name, duration} model', () => {
    const db = openDb(':memory:')
    const conv = createConversation(db)
    const task = insertTask(db, { taskName: 'email Bob', duration: 10, conversationId: conv.id })
    expect(task.taskName).toBe('email Bob')
    expect(task.duration).toBe(10)
    expect(task.status).toBe('pending')
    expect(task.escalation).toBe(0)
    expect(task.nextWakeAt).toBeGreaterThan(task.createdAt)

    const updated = updateTaskState(db, task.taskId, { status: 'escalated', escalation: 1 })
    expect(updated.status).toBe('escalated')
    expect(updated.escalation).toBe(1)
    expect(getTask(db, task.taskId)).toEqual(updated)
  })

  test('updateTaskState rejects an unknown task id', () => {
    const db = openDb(':memory:')
    expect(() => updateTaskState(db, 'nope', { status: 'done' })).toThrow('task nope not found')
  })

  test('listActiveTasks excludes done/missed and scopes by conversation', () => {
    const db = openDb(':memory:')
    const conv = createConversation(db)
    const other = createConversation(db)
    const active = insertTask(db, { taskName: 'active', duration: 5, conversationId: conv.id })
    const done = insertTask(db, { taskName: 'done', duration: 5, conversationId: conv.id })
    updateTaskState(db, done.taskId, { status: 'done' })
    insertTask(db, { taskName: 'other conv', duration: 5, conversationId: other.id })

    const activeForConv = listActiveTasks(db, conv.id)
    expect(activeForConv.map((t) => t.taskId)).toEqual([active.taskId])
  })

  test('latestActiveTaskForConversation returns the newest active task or null', () => {
    const db = openDb(':memory:')
    const conv = createConversation(db)
    expect(latestActiveTaskForConversation(db, conv.id)).toBeNull()
    insertTask(db, { taskName: 'first', duration: 5, conversationId: conv.id })
    const second = insertTask(db, { taskName: 'second', duration: 5, conversationId: conv.id })
    expect(latestActiveTaskForConversation(db, conv.id)?.taskId).toBe(second.taskId)
  })

  test('settings round-trip and upsert', () => {
    const db = openDb(':memory:')
    expect(getSetting(db, 'active_conversation_id')).toBeNull()
    setSetting(db, 'active_conversation_id', 'c1')
    expect(getSetting(db, 'active_conversation_id')).toBe('c1')
    setSetting(db, 'active_conversation_id', 'c2')
    expect(getSetting(db, 'active_conversation_id')).toBe('c2')
  })

  test('startup scrubs poisoned tag artifacts once, leaving a second startup as a no-op', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sahurhub-scrub-'))
    const path = join(dir, 'history.sqlite')
    const originalInfo = console.info
    const logs: unknown[][] = []
    console.info = (...args: unknown[]) => logs.push(args)

    try {
      let db = openDb(path)
      const conv = createConversation(db)
      insertMessage(db, { conversationId: conv.id, role: 'assistant', content: 'Old reply <task:ghost task|15>' })
      insertMessage(db, { conversationId: conv.id, role: 'user', content: 'Clean message' })
      db.close()

      db = openDb(path)
      expect(listMessages(db, conv.id).map((message) => message.content)).toEqual(['Old reply ', 'Clean message'])
      db.close()

      db = openDb(path)
      expect(listMessages(db, conv.id).map((message) => message.content)).toEqual(['Old reply ', 'Clean message'])
      db.close()

      expect(logs).toEqual([['Scrubbed 1 persisted message row(s) with tag artifacts.']])
    } finally {
      console.info = originalInfo
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
