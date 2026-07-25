// Wires the shared SahurSocket's typed events into the hand-rolled chat store and
// exposes every outbound action the UI needs. One socket per app lifetime.

import type { DisplayRotation } from '@shared/protocol.ts'
import { SahurSocket } from '@shared/ws-client.ts'
import { useEffect, useRef, useState } from 'react'
import { StingPlayer, stingForAgentEvent } from '../audio/stings.ts'
import { chatActions } from '../store/chatStore.ts'
import type { ChatMessage } from '../types.ts'

export interface RemoteConnection {
  socket: SahurSocket
  sendText: (text: string) => void
  beginRecording: () => void
  commitRecording: () => void
  sendAudioFrame: (data: ArrayBuffer) => void
  endRecording: (sendAudio: boolean) => void
  sendInterrupt: () => void
  sendPoke: () => void
  sendReset: () => void
  sendTitleEdit: (title: string) => void
  sendTaskAction: (taskId: string, action: 'done' | 'discard') => void
  createConversation: (characterId: string) => void
  switchConversation: (conversationId: string) => void
  deleteConversation: (conversationId: string) => void
  selectAudioSink: (sink: 'phone' | 'device') => void
  selectDisplayRotation: (degrees: DisplayRotation) => void
}

export function useRemoteConnection(): RemoteConnection {
  const [socket] = useState(() => new SahurSocket())
  const activeAssistantId = useRef<string | null>(null)
  const activeVoiceId = useRef<string | null>(null)
  const stings = useRef(new StingPlayer())
  const stingCharacterId = useRef('sahur')
  const stingOnPhone = useRef(false)

  useEffect(() => {
    socket.onConn = (up) => {
      chatActions.setConnection(up ? 'connected' : 'disconnected')
      if (up) socket.send({ type: 'hello', client: 'remote' })
    }

    const unsubscribers = [
      socket.on('status', (event) => chatActions.setStatus(event.state)),
      socket.on('transcript', (event) => {
        if (!chatActions.isActiveConversation(event.conversationId)) return
        if (!activeVoiceId.current) return
        chatActions.updateTranscript(activeVoiceId.current, event.text, event.final)
        if (event.final) activeVoiceId.current = null
      }),
      socket.on('token', (event) => {
        if (!chatActions.isActiveConversation(event.conversationId)) return
        if (!activeAssistantId.current) activeAssistantId.current = crypto.randomUUID()
        chatActions.appendAssistantToken(activeAssistantId.current, event.text)
      }),
      socket.on('reply', (event) => {
        if (!chatActions.isActiveConversation(event.conversationId)) return
        if (!activeAssistantId.current) activeAssistantId.current = crypto.randomUUID()
        chatActions.setAssistantReply(activeAssistantId.current, event.say)
      }),
      socket.on('done', (event) => {
        if (!chatActions.isActiveConversation(event.conversationId)) return
        if (activeAssistantId.current) chatActions.finalizeAssistant(activeAssistantId.current)
        activeAssistantId.current = null
      }),
      socket.on('conversation_list', (event) => chatActions.setConversations(event.conversations)),
      socket.on('conversation_active', (event) => {
        activeAssistantId.current = null
        activeVoiceId.current = null
        chatActions.setActiveConversation(event.conversationId)
      }),
      socket.on('message_history', (event) => {
        if (!chatActions.isActiveConversation(event.conversationId)) return
        chatActions.setMessageHistory(event.messages.map(toChatMessage))
      }),
      socket.on('message', (event) => {
        if (!chatActions.isActiveConversation(event.message.conversationId)) return
        chatActions.addPersistedMessage(toChatMessage(event.message))
      }),
      socket.on('title', (event) => chatActions.setConversationTitle(event.conversationId, event.title)),
      socket.on('task_list', (event) => {
        if (!chatActions.isActiveConversation(event.conversationId)) return
        chatActions.setTasks(event.tasks)
      }),
      socket.on('character_active', (event) => {
        stingCharacterId.current = event.characterId
        chatActions.setActiveCharacter(event.characterId)
      }),
      socket.on('character_list', (event) => chatActions.setCharacters(event.characters)),
      socket.on('audio_sink', (event) => {
        stingOnPhone.current = event.sink === 'phone'
        chatActions.setAudioSink(event.sink, event.active)
      }),
      socket.on('agent_event', (event) => {
        if (!stingOnPhone.current) return
        const sting = stingForAgentEvent(event.event.kind)
        if (sting) stings.current.play(stingCharacterId.current, sting)
      }),
      socket.on('display_rotation', (event) => chatActions.setDisplayRotation(event.degrees)),
      socket.on('notice', (event) => {
        if (!chatActions.isActiveConversation(event.conversationId) || event.message !== 'asr_failed') return
        if (!activeVoiceId.current) return
        chatActions.discardVoicePlaceholder(activeVoiceId.current)
        activeVoiceId.current = null
      })
    ]

    socket.connect()

    return () => {
      for (const off of unsubscribers) off()
      stings.current.stop()
      socket.close()
    }
  }, [socket])

  return {
    socket,
    sendText(text: string) {
      const id = crypto.randomUUID()
      chatActions.addUserMessage(id, text)
      socket.send({ type: 'text', text, id, source: 'phone' })
    },
    beginRecording() {
      chatActions.setRecording('recording')
    },
    commitRecording() {
      const id = crypto.randomUUID()
      activeVoiceId.current = id
      chatActions.beginVoicePlaceholder(id)
    },
    sendAudioFrame(data: ArrayBuffer) {
      socket.sendBinary(data)
    },
    endRecording(sendAudio: boolean) {
      if (sendAudio) socket.send({ type: 'audio_end', source: 'phone' })
      chatActions.setRecording('idle')
    },
    sendInterrupt() {
      socket.send({ type: 'interrupt' })
    },
    sendPoke() {
      socket.send({ type: 'poke' })
    },
    sendReset() {
      socket.send({ type: 'reset' })
      chatActions.resetHistory()
    },
    sendTitleEdit(title: string) {
      chatActions.editActiveTitle(title)
      socket.send({ type: 'title_edit', title })
    },
    sendTaskAction(taskId: string, action: 'done' | 'discard') {
      socket.send({ type: 'task_action', taskId, action })
    },
    createConversation(characterId: string) {
      socket.send({ type: 'conversation_new', characterId })
    },
    switchConversation(conversationId: string) {
      socket.send({ type: 'conversation_switch', conversationId })
    },
    deleteConversation(conversationId: string) {
      socket.send({ type: 'conversation_delete', conversationId })
    },
    selectAudioSink(sink: 'phone' | 'device') {
      socket.send({ type: 'audio_sink', sink })
    },
    selectDisplayRotation(degrees: DisplayRotation) {
      socket.send({ type: 'display_rotate', degrees })
    }
  }
}

function toChatMessage(message: {
  id: string
  role: 'user' | 'assistant'
  content: string
  kind: 'text' | 'upload-text' | 'upload-image'
}): ChatMessage {
  const attachment =
    message.kind === 'text'
      ? undefined
      : {
          name: message.kind === 'upload-image' ? 'Image upload' : 'Text upload',
          mime: '',
          kind: message.kind === 'upload-image' ? ('image' as const) : ('text' as const)
        }

  return { id: message.id, role: message.role, text: message.content, streaming: false, attachment }
}
