import type { SahurSocket } from '@shared/ws-client.ts'
import { useEffect, useRef, useState } from 'react'
import { chatActions } from '../store/chatStore.ts'
import { TtsPlayer } from './player.ts'

export interface TtsPlaybackHandle {
  // Sink-select (Device/Phone, docs/decisions.md "MVP audio output") is a
  // Settings toggle finished in T10b; this app only ever plays on the phone,
  // so mute is the seam T10b's toggle can call into.
  setMuted: (muted: boolean) => void
  // True until the browser's autoplay policy is satisfied by a user gesture.
  soundLocked: boolean
}

export function useTtsPlayer(socket: SahurSocket | undefined): TtsPlaybackHandle {
  const playerRef = useRef<TtsPlayer>(new TtsPlayer())
  const fallbackTextRef = useRef('')
  const fallbackActiveRef = useRef(false)
  const mutedRef = useRef(false)
  const [soundLocked, setSoundLocked] = useState(() => playerRef.current.isLocked())

  useEffect(() => {
    if (!soundLocked) return
    const tryUnlock = () => {
      void playerRef.current.unlock().then((unlocked) => {
        if (unlocked) setSoundLocked(false)
      })
    }
    window.addEventListener('pointerdown', tryUnlock)
    return () => window.removeEventListener('pointerdown', tryUnlock)
  }, [soundLocked])

  useEffect(() => {
    if (!socket) return
    const unsubscribers = [
      socket.on('token', (event) => {
        if (!chatActions.isActiveConversation(event.conversationId)) return
        fallbackTextRef.current += event.text
      }),
      socket.on('reply', (event) => {
        if (!chatActions.isActiveConversation(event.conversationId)) return
        fallbackTextRef.current = event.say
      }),
      socket.on('notice', (event) => {
        if (!chatActions.isActiveConversation(event.conversationId)) return
        if (event.message === 'tts_interrupt') {
          window.speechSynthesis.cancel()
          fallbackActiveRef.current = false
          playerRef.current.stop()
          return
        }
        if (
          event.message !== 'tts_fallback:webspeech' ||
          fallbackActiveRef.current ||
          mutedRef.current ||
          !fallbackTextRef.current.trim()
        ) {
          return
        }
        fallbackActiveRef.current = true
        window.speechSynthesis.speak(new SpeechSynthesisUtterance(fallbackTextRef.current))
      }),
      socket.on('tts_chunk', (event) => {
        if (!chatActions.isActiveConversation(event.conversationId)) return
        fallbackActiveRef.current = false
        window.speechSynthesis.cancel()
        playerRef.current.enqueue(event.data, event.sampleRate)
      }),
      socket.on('done', (event) => {
        if (!chatActions.isActiveConversation(event.conversationId)) return
        fallbackTextRef.current = ''
      })
    ]
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe()
    }
  }, [socket])

  useEffect(
    () => () => {
      playerRef.current.stop()
    },
    []
  )

  return {
    setMuted: (muted: boolean) => {
      mutedRef.current = muted
      playerRef.current.setMuted(muted)
      if (muted) window.speechSynthesis.cancel()
    },
    soundLocked
  }
}
