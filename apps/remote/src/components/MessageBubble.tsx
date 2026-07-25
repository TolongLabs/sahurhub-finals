import { Paperclip } from 'lucide-react'
import type { ChatMessage } from '../types.ts'
import MarkdownContent from './MarkdownContent.tsx'

export default function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'

  return (
    <div className={`message-row ${isUser ? 'is-user' : 'is-assistant'}`}>
      {!isUser && (
        <span className="assistant-avatar" aria-label="Sahur">
          S
        </span>
      )}
      <div className={`message-bubble ${isUser ? 'is-user' : ''}`}>
        {message.attachment && (
          <p className="attachment-label">
            <Paperclip size={13} aria-hidden="true" />
            {message.attachment.name} ({message.attachment.kind})
          </p>
        )}
        {isUser ? (
          <p className="message-content">{message.text.trim() || (message.streaming ? '...' : '')}</p>
        ) : (
          <MarkdownContent text={message.text.trim() || (message.streaming ? '...' : '')} />
        )}
      </div>
    </div>
  )
}
