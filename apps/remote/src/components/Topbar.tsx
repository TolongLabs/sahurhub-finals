import { Hand, ListTodo, Menu } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ConnectionState } from '../types.ts'
import ConnectionPill from './ConnectionPill.tsx'

interface TopbarProps {
  title: string
  connection: ConnectionState
  taskCount: number
  onTitleChange: (title: string) => void
  onPoke: () => void
  onOpenSidebar: () => void
  onOpenTasks: () => void
}

// Static placeholder title, editable inline (docs/plan.md T10a) — the AI-
// generated title + persistence lands in T10b once T11's protocol exists.
export default function Topbar({
  title,
  connection,
  taskCount,
  onTitleChange,
  onPoke,
  onOpenSidebar,
  onOpenTasks
}: TopbarProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(title)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  useEffect(() => {
    if (!editing) setDraft(title)
  }, [editing, title])

  function commit() {
    setEditing(false)
    const trimmed = draft.trim()
    if (trimmed && trimmed !== title) onTitleChange(trimmed)
    else setDraft(title)
  }

  return (
    <header className="topbar">
      <button type="button" onClick={onOpenSidebar} aria-label="Open conversations" className="icon-button">
        <Menu size={18} aria-hidden="true" />
      </button>
      <div className="topbar-title-wrap">
        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') {
                setDraft(title)
                setEditing(false)
              }
            }}
            className="topbar-title-input"
          />
        ) : (
          <>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className={`topbar-title ${title === 'New conversation' ? 'is-placeholder' : ''}`}
            >
              {title}
            </button>
            <button type="button" onClick={onPoke} aria-label="Poke character" className="poke-button">
              <Hand size={15} aria-hidden="true" />
            </button>
          </>
        )}
      </div>
      <div className="topbar-actions">
        <button
          type="button"
          onClick={onOpenTasks}
          aria-label={`Open tasks (${taskCount})`}
          className="icon-button task-button"
        >
          <ListTodo size={18} aria-hidden="true" />
          {taskCount > 0 && <span className="task-count">{taskCount}</span>}
        </button>
        <ConnectionPill connection={connection} />
      </div>
    </header>
  )
}
