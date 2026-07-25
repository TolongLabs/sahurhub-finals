import type { CharacterSummary, ConversationSummary, TaskSummary } from '@shared/protocol.ts'

export type ConnectionState = 'connecting' | 'connected' | 'disconnected'
export type RecordingState = 'idle' | 'recording'
export type AgentStatus = 'idle' | 'listening' | 'thinking' | 'speaking'

export interface Attachment {
  name: string
  mime: string
  kind: 'text' | 'image'
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  streaming: boolean
  attachment?: Attachment
}

export type Conversation = ConversationSummary
export type Task = TaskSummary
export type Character = CharacterSummary
export type AudioOutput = 'phone' | 'device'
