// Typed DAO over the bun:sqlite schema in ./index.ts. Kept minimal — the
// Agent Kernel (kernel/kernel.ts) owns validated state transitions; this
// module only persists rows and round-trips them, validating shapes at the
// DB boundary (AGENTS.md: validate at system boundaries).

import type { Database } from 'bun:sqlite'
import type { EscalationLevel, MessageKind, MessageRole, TaskStatus } from '../../shared/protocol.ts'

// --- conversations -----------------------------------------------------------

export interface ConversationRow {
  id: string
  title: string | null
  characterId: string
  createdAt: number
}

interface RawConversationRow {
  id: string
  title: string | null
  character_id: string
  created_at: number
}

function mapConversation(row: RawConversationRow): ConversationRow {
  return { id: row.id, title: row.title, characterId: row.character_id, createdAt: row.created_at }
}

export function createConversation(
  db: Database,
  opts: { id?: string; title?: string | null; characterId?: string } = {}
): ConversationRow {
  const id = opts.id ?? crypto.randomUUID()
  const now = Date.now()
  const row = db
    .query('INSERT INTO conversations (id, title, character_id, created_at) VALUES (?, ?, ?, ?) RETURNING *')
    .get(id, opts.title ?? null, opts.characterId ?? 'sahur', now) as RawConversationRow
  return mapConversation(row)
}

export function getConversation(db: Database, id: string): ConversationRow | null {
  const row = db.query('SELECT * FROM conversations WHERE id = ?').get(id) as RawConversationRow | null
  return row ? mapConversation(row) : null
}

export function listConversations(db: Database): ConversationRow[] {
  // rowid tie-breaks Date.now()-millisecond collisions between fast inserts.
  const rows = db
    .query('SELECT * FROM conversations ORDER BY created_at DESC, rowid DESC')
    .all() as RawConversationRow[]
  return rows.map(mapConversation)
}

export function updateConversationTitle(db: Database, id: string, title: string): ConversationRow {
  const row = db.query('UPDATE conversations SET title = ? WHERE id = ? RETURNING *').get(title, id) as
    | RawConversationRow
    | undefined
  if (!row) throw new Error(`conversation ${id} not found`)
  return mapConversation(row)
}

export function deleteConversation(db: Database, id: string): void {
  db.query('DELETE FROM messages WHERE conversation_id = ?').run(id)
  db.query('UPDATE tasks SET conversation_id = NULL WHERE conversation_id = ?').run(id)
  db.query('DELETE FROM conversations WHERE id = ?').run(id)
}

// --- messages ------------------------------------------------------------------

export interface MessageRow {
  id: string
  conversationId: string
  role: MessageRole
  content: string
  kind: MessageKind
  ts: number
}

interface RawMessageRow {
  id: string
  conversation_id: string
  role: string
  content: string
  kind: string
  ts: number
}

function mapMessage(row: RawMessageRow): MessageRow {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role as MessageRole,
    content: row.content,
    kind: row.kind as MessageKind,
    ts: row.ts
  }
}

export function insertMessage(
  db: Database,
  input: { conversationId: string; role: MessageRole; content: string; kind?: MessageKind; id?: string; ts?: number }
): MessageRow {
  const id = input.id ?? crypto.randomUUID()
  const ts = input.ts ?? Date.now()
  const kind = input.kind ?? 'text'
  const row = db
    .query(
      `INSERT INTO messages (id, conversation_id, role, content, kind, ts)
       VALUES (?, ?, ?, ?, ?, ?)
       RETURNING *`
    )
    .get(id, input.conversationId, input.role, input.content, kind, ts) as RawMessageRow
  return mapMessage(row)
}

export function listMessages(db: Database, conversationId: string, opts: { limit?: number } = {}): MessageRow[] {
  const limit = opts.limit
  const rows = (
    limit
      ? db.query('SELECT * FROM messages WHERE conversation_id = ? ORDER BY ts DESC LIMIT ?').all(conversationId, limit)
      : db.query('SELECT * FROM messages WHERE conversation_id = ? ORDER BY ts ASC').all(conversationId)
  ) as RawMessageRow[]
  const mapped = rows.map(mapMessage)
  return limit ? mapped.reverse() : mapped
}

export function countMessages(db: Database, conversationId: string): number {
  const row = db.query('SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ?').get(conversationId) as {
    n: number
  }
  return row.n
}

export function deleteMessages(db: Database, conversationId: string): void {
  db.query('DELETE FROM messages WHERE conversation_id = ?').run(conversationId)
}

// --- tasks (minimal model: {task_id, task_name, duration}) ---------------------

export interface TaskRow {
  taskId: string
  taskName: string
  duration: number
  status: TaskStatus
  escalation: EscalationLevel
  conversationId: string | null
  nextWakeAt: number | null
  createdAt: number
}

interface RawTaskRow {
  task_id: string
  task_name: string
  duration: number
  status: string
  escalation: number
  conversation_id: string | null
  next_wake_at: number | null
  created_at: number
}

function toEscalationLevel(value: number): EscalationLevel {
  if (value === 0 || value === 1 || value === 2) return value
  throw new Error(`invalid escalation level from DB: ${value}`)
}

function mapTask(row: RawTaskRow): TaskRow {
  return {
    taskId: row.task_id,
    taskName: row.task_name,
    duration: row.duration,
    status: row.status as TaskStatus,
    escalation: toEscalationLevel(row.escalation),
    conversationId: row.conversation_id,
    nextWakeAt: row.next_wake_at,
    createdAt: row.created_at
  }
}

export function insertTask(
  db: Database,
  input: {
    taskName: string
    duration: number
    conversationId: string | null
    taskId?: string
    nextWakeAt?: number | null
  }
): TaskRow {
  const taskId = input.taskId ?? crypto.randomUUID()
  const now = Date.now()
  const nextWakeAt = input.nextWakeAt === undefined ? now + input.duration * 60_000 : input.nextWakeAt
  const row = db
    .query(
      `INSERT INTO tasks (task_id, task_name, duration, status, escalation, conversation_id, next_wake_at, created_at)
       VALUES (?, ?, ?, 'pending', 0, ?, ?, ?)
       RETURNING *`
    )
    .get(taskId, input.taskName, input.duration, input.conversationId, nextWakeAt, now) as RawTaskRow
  return mapTask(row)
}

export function getTask(db: Database, taskId: string): TaskRow | null {
  const row = db.query('SELECT * FROM tasks WHERE task_id = ?').get(taskId) as RawTaskRow | null
  return row ? mapTask(row) : null
}

export interface TaskStatePatch {
  status?: TaskStatus
  escalation?: EscalationLevel
  nextWakeAt?: number | null
}

export function updateTaskState(db: Database, taskId: string, patch: TaskStatePatch): TaskRow {
  const current = db.query('SELECT * FROM tasks WHERE task_id = ?').get(taskId) as RawTaskRow | null
  if (!current) throw new Error(`task ${taskId} not found`)

  const status = patch.status ?? current.status
  const escalation = patch.escalation ?? current.escalation
  const nextWakeAt = patch.nextWakeAt === undefined ? current.next_wake_at : patch.nextWakeAt

  const row = db
    .query('UPDATE tasks SET status = ?, escalation = ?, next_wake_at = ? WHERE task_id = ? RETURNING *')
    .get(status, escalation, nextWakeAt, taskId) as RawTaskRow
  return mapTask(row)
}

const ACTIVE_STATUSES: ReadonlySet<TaskStatus> = new Set(['pending', 'reminding', 'escalated'])

export function listActiveTasks(db: Database, conversationId?: string): TaskRow[] {
  const rows = (
    conversationId
      ? db
          .query("SELECT * FROM tasks WHERE conversation_id = ? AND status IN ('pending','reminding','escalated')")
          .all(conversationId)
      : db.query("SELECT * FROM tasks WHERE status IN ('pending','reminding','escalated')").all()
  ) as RawTaskRow[]
  return rows.map(mapTask).filter((t) => ACTIVE_STATUSES.has(t.status))
}

export function listArmedTasks(db: Database): TaskRow[] {
  const rows = db
    .query("SELECT * FROM tasks WHERE next_wake_at IS NOT NULL AND status IN ('pending','reminding','escalated')")
    .all() as RawTaskRow[]
  return rows.map(mapTask)
}

export function latestActiveTaskForConversation(db: Database, conversationId: string): TaskRow | null {
  const row = db
    .query(
      "SELECT * FROM tasks WHERE conversation_id = ? AND status IN ('pending','reminding','escalated') ORDER BY created_at DESC, rowid DESC LIMIT 1"
    )
    .get(conversationId) as RawTaskRow | null
  return row ? mapTask(row) : null
}

// --- settings (active-conversation + selected-character pointers) --------------

export function getSetting(db: Database, key: string): string | null {
  const row = db.query('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | null
  return row?.value ?? null
}

export function setSetting(db: Database, key: string, value: string): void {
  db.query('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    key,
    value
  )
}
