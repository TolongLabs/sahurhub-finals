// Hand-rolled client store (no Redux/Zustand — docs/plan.md T10a "lightweight
// ... client state"). Plain subscribe/getSnapshot behind `useSyncExternalStore`
// so components only re-render on the slice they select.

import type { DisplayRotation } from '@shared/protocol.ts'
import { useSyncExternalStore } from 'react'
import type {
  AgentStatus,
  AudioOutput,
  Character,
  ChatMessage,
  ConnectionState,
  Conversation,
  RecordingState,
  Task
} from '../types.ts'

export interface ChatState {
  connection: ConnectionState
  status: AgentStatus
  recording: RecordingState
  title: string
  messages: ChatMessage[]
  tasks: Task[]
  conversations: Conversation[]
  activeConversationId: string | null
  activeCharacterId: string
  characters: Character[]
  audioOutput: AudioOutput
  audioSinkActive: boolean
  displayRotation: DisplayRotation
}

const initialState: ChatState = {
  connection: 'connecting',
  status: 'idle',
  recording: 'idle',
  title: 'New conversation',
  messages: [],
  tasks: [],
  conversations: [],
  activeConversationId: null,
  activeCharacterId: 'sahur',
  characters: [{ id: 'sahur', displayName: 'Sahur' }],
  audioOutput: 'phone',
  audioSinkActive: true,
  displayRotation: 0
}

type Listener = () => void

let state: ChatState = initialState
const listeners = new Set<Listener>()

function setState(patch: Partial<ChatState> | ((prev: ChatState) => Partial<ChatState>)): void {
  const next = typeof patch === 'function' ? patch(state) : patch
  state = { ...state, ...next }
  for (const listener of listeners) listener()
}

function getSnapshot(): ChatState {
  return state
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useChatStore<T>(selector: (s: ChatState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(getSnapshot()))
}

function upsertMessage(id: string, patch: (existing: ChatMessage | undefined) => ChatMessage): void {
  setState((prev) => {
    const idx = prev.messages.findIndex((m) => m.id === id)
    if (idx === -1) return { messages: [...prev.messages, patch(undefined)] }
    const messages = prev.messages.slice()
    messages[idx] = patch(messages[idx])
    return { messages }
  })
}

export const chatActions = {
  isActiveConversation(conversationId: string): boolean {
    return state.activeConversationId === conversationId
  },
  setConnection(connection: ConnectionState): void {
    setState({ connection })
  },
  setStatus(status: AgentStatus): void {
    setState({ status })
  },
  setRecording(recording: RecordingState): void {
    setState({ recording })
  },
  setTitle(title: string): void {
    setState({ title })
  },
  setConversations(conversations: Conversation[]): void {
    setState((prev) => ({
      conversations,
      title: activeTitle(conversations, prev.activeConversationId) ?? prev.title
    }))
  },
  setActiveConversation(conversationId: string): void {
    setState((prev) => ({
      activeConversationId: conversationId,
      title: activeTitle(prev.conversations, conversationId) ?? 'New conversation',
      messages: [],
      tasks: []
    }))
  },
  setConversationTitle(conversationId: string, title: string): void {
    setState((prev) => {
      const conversations = prev.conversations.map((conversation) =>
        conversation.id === conversationId ? { ...conversation, title } : conversation
      )
      return {
        conversations,
        title: conversationId === prev.activeConversationId ? title : prev.title
      }
    })
  },
  editActiveTitle(title: string): void {
    setState((prev) => {
      if (!prev.activeConversationId) return { title }
      const conversations = prev.conversations.map((conversation) =>
        conversation.id === prev.activeConversationId ? { ...conversation, title } : conversation
      )
      return { conversations, title }
    })
  },
  setTasks(tasks: Task[]): void {
    setState({ tasks })
  },
  setActiveCharacter(activeCharacterId: string): void {
    setState({ activeCharacterId })
  },
  setCharacters(characters: Character[]): void {
    setState({ characters })
  },
  setAudioOutput(audioOutput: AudioOutput): void {
    setState({ audioOutput, audioSinkActive: audioOutput === 'phone' })
  },
  setAudioSink(audioOutput: AudioOutput, audioSinkActive: boolean): void {
    setState({ audioOutput, audioSinkActive })
  },
  setDisplayRotation(displayRotation: DisplayRotation): void {
    setState({ displayRotation })
  },
  addUserMessage(id: string, text: string, attachment?: ChatMessage['attachment']): void {
    setState((prev) => ({ messages: [...prev.messages, { id, role: 'user', text, streaming: false, attachment }] }))
  },
  // Voice ASR: begins a placeholder that fills in as `transcript` events arrive.
  beginVoicePlaceholder(id: string): void {
    setState((prev) => ({
      messages: [...prev.messages, { id, role: 'user', text: '', streaming: true }]
    }))
  },
  updateTranscript(id: string, text: string, final: boolean): void {
    upsertMessage(id, (existing) => ({
      id,
      role: 'user',
      text,
      streaming: !final,
      attachment: existing?.attachment
    }))
  },
  discardVoicePlaceholder(id: string): void {
    setState((prev) => ({ messages: prev.messages.filter((message) => message.id !== id) }))
  },
  appendAssistantToken(id: string, text: string): void {
    upsertMessage(id, (existing) => ({
      id,
      role: 'assistant',
      text: (existing?.text ?? '') + text,
      streaming: true
    }))
  },
  setAssistantReply(id: string, text: string): void {
    upsertMessage(id, () => ({ id, role: 'assistant', text, streaming: false }))
  },
  finalizeAssistant(id: string): void {
    upsertMessage(id, (existing) => ({
      id,
      role: 'assistant',
      text: existing?.text ?? '',
      streaming: false
    }))
  },
  setMessageHistory(messages: ChatMessage[]): void {
    setState({ messages })
  },
  addPersistedMessage(message: ChatMessage): void {
    upsertMessage(message.id, () => message)
  },
  resetHistory(): void {
    setState({ messages: [] })
  }
}

function activeTitle(conversations: Conversation[], conversationId: string | null): string | null {
  return conversations.find((conversation) => conversation.id === conversationId)?.title ?? null
}
