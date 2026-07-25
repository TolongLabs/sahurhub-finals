import { useEffect, useRef } from 'react'
import type { AgentStatus, ChatMessage } from '../types.ts'
import MessageBubble from './MessageBubble.tsx'

const STATUS_LABEL: Record<AgentStatus, (characterName: string) => string> = {
  idle: () => '',
  listening: () => 'Listening…',
  thinking: (characterName) => `${characterName} is thinking…`,
  speaking: (characterName) => `${characterName} is speaking…`
}

interface ChatThreadProps {
  messages: ChatMessage[]
  status: AgentStatus
  characterName: string
  onStarter: (text: string) => void
}

export default function ChatThread({ messages, status, characterName, onStarter }: ChatThreadProps) {
  const endRef = useRef<HTMLDivElement>(null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll-to-bottom on every new message
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length])

  const statusLabel = STATUS_LABEL[status](characterName)

  return (
    <div className="chat-thread">
      <div className="chat-column">
        {messages.length === 0 && (
          <div className="empty-state">
            <div>
              <p className="empty-state-mark">{characterName} is ready.</p>
              <p className="empty-state-copy">Start with a little mischief, or make a very serious request.</p>
              <div className="starter-chips">
                <button
                  type="button"
                  className="starter-chip"
                  onClick={() => onStarter('Wake me up at 5:30 with drama')}
                >
                  Wake me up at 5:30 with drama
                </button>
                <button
                  type="button"
                  className="starter-chip"
                  onClick={() => onStarter('Give my sahur a heroic pep talk')}
                >
                  Give my sahur a heroic pep talk
                </button>
                <button
                  type="button"
                  className="starter-chip"
                  onClick={() => onStarter('Settle a friendly nasi lemak debate')}
                >
                  Settle a friendly nasi lemak debate
                </button>
              </div>
            </div>
          </div>
        )}
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
        {status === 'thinking' && <TypingIndicator />}
        {status !== 'thinking' && statusLabel && <p className="sr-only">{statusLabel}</p>}
        <div ref={endRef} />
      </div>
    </div>
  )
}

function TypingIndicator() {
  return (
    <div className="message-row is-assistant typing-row" aria-label="Sahur is thinking">
      <span className="assistant-avatar" aria-hidden="true">
        S
      </span>
      <div className="message-bubble typing-bubble" aria-hidden="true">
        <span className="typing-dot" />
        <span className="typing-dot" />
        <span className="typing-dot" />
      </div>
    </div>
  )
}
