// bun:sqlite store (docs/decisions.md: "native, zero-dep... no external DB").
// Persists BOTH the minimal task model {task_id, task_name, duration} and
// full multi-conversation history (`conversations` + `messages`), plus a
// small settings table for the active-conversation and selected-character
// pointers (docs/trd.md §3.5/§3.7). Long-term personality memory is out of
// scope.
//
// Schema note (docs/plan.md T8 addendum + T11 task body): supersedes T8's
// placeholder schema (`tasks` keyed on a free-text `description`, plus
// `escalation`/`history` tables) — this is the tracked, not-yet-closed
// evolution T8 flagged, not a contradiction of it. Escalation bookkeeping
// moves onto `tasks.escalation`; `history` is superseded by `messages`.

import { Database } from 'bun:sqlite'
import { stripTagArtifacts } from '../kernel/tags.ts'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  title TEXT,
  character_id TEXT NOT NULL DEFAULT 'sahur',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'text',
  ts INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, ts);

CREATE TABLE IF NOT EXISTS tasks (
  task_id TEXT PRIMARY KEY,
  task_name TEXT NOT NULL,
  duration INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  escalation INTEGER NOT NULL DEFAULT 0,
  conversation_id TEXT REFERENCES conversations(id),
  next_wake_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`

export function openDb(path = 'sahurhub.sqlite'): Database {
  const db = new Database(path)
  db.exec(SCHEMA)
  ensureConversationCharacterColumn(db)
  const scrubbed = scrubPersistedMessageTagArtifacts(db)
  if (scrubbed > 0) console.info(`Scrubbed ${scrubbed} persisted message row(s) with tag artifacts.`)
  return db
}

function ensureConversationCharacterColumn(db: Database): void {
  const columns = db.query('PRAGMA table_info(conversations)').all() as Array<{ name: string }>
  if (!columns.some((column) => column.name === 'character_id')) {
    db.exec("ALTER TABLE conversations ADD COLUMN character_id TEXT NOT NULL DEFAULT 'sahur'")
  }
  db.exec("UPDATE conversations SET character_id = 'sahur' WHERE character_id IS NULL OR character_id = ''")
}

export function scrubPersistedMessageTagArtifacts(db: Database): number {
  const rows = db.query("SELECT id, content FROM messages WHERE instr(content, '<') > 0").all() as {
    id: string
    content: string
  }[]
  const update = db.query('UPDATE messages SET content = ? WHERE id = ?')
  let scrubbed = 0

  for (const row of rows) {
    const clean = stripTagArtifacts(row.content)
    if (clean === row.content) continue
    update.run(clean, row.id)
    scrubbed++
  }

  return scrubbed
}
