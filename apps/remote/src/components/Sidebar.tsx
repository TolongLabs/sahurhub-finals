import { Plus, Settings, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Conversation } from '../types.ts'
import ConfirmDialog from './ConfirmDialog.tsx'

interface SidebarProps {
  open: boolean
  conversations: Conversation[]
  activeConversationId: string | null
  onClose: () => void
  onCreate: () => void
  onSwitch: (conversationId: string) => void
  onDelete: (conversationId: string) => void
  onOpenSettings: () => void
}

export default function Sidebar({
  open,
  conversations,
  activeConversationId,
  onClose,
  onCreate,
  onSwitch,
  onDelete,
  onOpenSettings
}: SidebarProps) {
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const drawerRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!open) return
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!drawerRef.current?.contains(event.target as Node)) onClose()
    }
    window.addEventListener('pointerdown', closeOnOutsidePress)
    return () => window.removeEventListener('pointerdown', closeOnOutsidePress)
  }, [onClose, open])

  return (
    <>
      {open && <div aria-hidden="true" className="drawer-scrim" />}
      <aside ref={drawerRef} aria-hidden={!open} className={`drawer sidebar-drawer ${open ? 'is-open' : 'is-closed'}`}>
        <div className="drawer-header">
          <h2 className="drawer-heading">Conversations</h2>
          <button type="button" onClick={onClose} aria-label="Close conversations" className="icon-button">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <button
          type="button"
          onClick={() => {
            onCreate()
          }}
          className="primary-button drawer-new-chat"
        >
          <Plus size={16} aria-hidden="true" />
          New Chat
        </button>
        <nav className="conversation-list">
          {conversations.map((conversation) => {
            const active = conversation.id === activeConversationId
            return (
              <div key={conversation.id} className={`conversation-row ${active ? 'is-active' : ''}`}>
                <button
                  type="button"
                  onClick={() => {
                    onSwitch(conversation.id)
                    onClose()
                  }}
                  className="conversation-select"
                >
                  {conversation.title ?? 'New conversation'}
                </button>
                <button
                  type="button"
                  aria-label={`Delete conversation: ${conversation.title ?? 'New conversation'}`}
                  onClick={() => setDeleteId(conversation.id)}
                  className="icon-button conversation-delete"
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </div>
            )
          })}
        </nav>
        <div className="drawer-footer">
          <button
            type="button"
            onClick={() => {
              onOpenSettings()
              onClose()
            }}
            className="secondary-button settings-link"
          >
            <Settings size={16} aria-hidden="true" />
            Settings
          </button>
        </div>
      </aside>
      <ConfirmDialog
        open={deleteId !== null}
        message="Delete this conversation and its messages? This can't be undone."
        confirmLabel="Delete"
        onConfirm={() => {
          if (deleteId) onDelete(deleteId)
          setDeleteId(null)
        }}
        onCancel={() => setDeleteId(null)}
      />
    </>
  )
}
