import { Mic } from 'lucide-react'
import { type CSSProperties, useEffect, useRef, useState } from 'react'
import { type RecorderController, startRecording } from '../audio/recorder.ts'
import type { AgentStatus, RecordingState } from '../types.ts'

const MIN_RECORDING_MS = 300
const STARTUP_TIMEOUT_MS = 700

interface RecordButtonProps {
  status: AgentStatus
  recording: RecordingState
  onBeginRecording: () => void
  onCommitRecording: () => void
  onFrame: (data: ArrayBuffer) => void
  onEndRecording: (sendAudio: boolean) => void
  onInterrupt: () => void
}

// Hold-to-talk mic button (docs/plan.md T10a). Holding while the agent is
// `speaking` is treated as barge-in: sends `interrupt` before recording.
export default function RecordButton({
  status,
  recording,
  onBeginRecording,
  onCommitRecording,
  onFrame,
  onEndRecording,
  onInterrupt
}: RecordButtonProps) {
  const controllerRef = useRef<RecorderController | null>(null)
  const pendingFramesRef = useRef<ArrayBuffer[]>([])
  const startupTimeoutRef = useRef<number | null>(null)
  const elapsedIntervalRef = useRef<number | null>(null)
  const pressedAtRef = useRef(0)
  const captureStartedAtRef = useRef(0)
  const hasFramesRef = useRef(false)
  const acceptingFramesRef = useRef(false)
  const endingRef = useRef(false)
  const lastLevelUpdateRef = useRef(0)
  const [micError, setMicError] = useState<string | null>(null)
  const [isCapturing, setIsCapturing] = useState(false)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [level, setLevel] = useState(0)

  useEffect(() => {
    return () => {
      acceptingFramesRef.current = false
      if (startupTimeoutRef.current !== null) window.clearTimeout(startupTimeoutRef.current)
      if (elapsedIntervalRef.current !== null) window.clearInterval(elapsedIntervalRef.current)
      void controllerRef.current?.stop()
    }
  }, [])

  function clearLiveFeedback() {
    if (startupTimeoutRef.current !== null) window.clearTimeout(startupTimeoutRef.current)
    if (elapsedIntervalRef.current !== null) window.clearInterval(elapsedIntervalRef.current)
    startupTimeoutRef.current = null
    elapsedIntervalRef.current = null
    setIsCapturing(false)
    setLevel(0)
  }

  function beginLiveFeedback() {
    if (hasFramesRef.current) return
    hasFramesRef.current = true
    if (startupTimeoutRef.current !== null) window.clearTimeout(startupTimeoutRef.current)
    startupTimeoutRef.current = null
    if (endingRef.current) return
    captureStartedAtRef.current = performance.now()
    setIsCapturing(true)
    elapsedIntervalRef.current = window.setInterval(() => {
      setElapsedMs(performance.now() - captureStartedAtRef.current)
    }, 100)
  }

  async function handleStart() {
    if (recording === 'recording') return
    if (status === 'speaking') onInterrupt()
    setMicError(null)
    clearLiveFeedback()
    setElapsedMs(0)
    hasFramesRef.current = false
    acceptingFramesRef.current = true
    endingRef.current = false
    pressedAtRef.current = performance.now()
    pendingFramesRef.current = []
    onBeginRecording()

    startupTimeoutRef.current = window.setTimeout(() => {
      void finishRecording("Mic didn't start — try again")
    }, STARTUP_TIMEOUT_MS)

    try {
      const controller = await startRecording({
        onFrame(data) {
          if (!acceptingFramesRef.current) return
          beginLiveFeedback()
          pendingFramesRef.current.push(data)
        },
        onLevel(nextLevel) {
          if (!hasFramesRef.current || endingRef.current) return
          const now = performance.now()
          if (now - lastLevelUpdateRef.current < 80) return
          lastLevelUpdateRef.current = now
          setLevel(nextLevel)
        },
        onError() {
          void finishRecording("Mic didn't start — try again")
        }
      })
      if (!acceptingFramesRef.current) {
        void controller.stop()
        return
      }
      controllerRef.current = controller
    } catch {
      await finishRecording("Mic didn't start — try again")
    }
  }

  function handleStop() {
    void finishRecording()
  }

  async function finishRecording(errorMessage?: string) {
    if (!acceptingFramesRef.current || endingRef.current) return
    endingRef.current = true
    clearLiveFeedback()
    if (errorMessage) setMicError(errorMessage)

    const controller = controllerRef.current
    if (controller) await controller.stop()

    const recordedForMs = performance.now() - pressedAtRef.current
    const sendAudio =
      !errorMessage && hasFramesRef.current && pendingFramesRef.current.length > 0 && recordedForMs >= MIN_RECORDING_MS
    acceptingFramesRef.current = false
    controllerRef.current = null

    if (sendAudio) {
      onCommitRecording()
      for (const frame of pendingFramesRef.current) onFrame(frame)
    }

    pendingFramesRef.current = []
    onEndRecording(sendAudio)
  }

  return (
    <div className="record-control">
      <button
        type="button"
        onPointerDown={handleStart}
        onPointerUp={handleStop}
        onPointerLeave={handleStop}
        onPointerCancel={handleStop}
        aria-label="Hold to talk"
        className={`composer-icon-button record-button ${isCapturing ? 'is-capturing' : ''}`}
      >
        <Mic size={18} aria-hidden="true" />
      </button>
      {isCapturing && (
        <div className="record-live-indicator" aria-live="polite">
          <span className="record-live-label">Listening… {formatElapsed(elapsedMs)}</span>
          <span className="record-level-meter" aria-label="Microphone level">
            <span className="record-level-fill" style={{ '--capture-level': level } as CSSProperties} />
          </span>
        </div>
      )}
      {micError && <p className="form-error">{micError}</p>}
    </div>
  )
}

function formatElapsed(milliseconds: number): string {
  return `${(milliseconds / 1000).toFixed(1)}s`
}
