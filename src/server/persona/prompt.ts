// The 5-layer prompt compiler (docs/plan.md T11 item 3; docs/trd.md §3.6).
// Structural reference: the SolarSim prompt substrate (fixed stable->volatile
// order, prefix caching). L0-L3 are byte-identical across calls for the same
// character (cacheable); L4 is always volatile and always last, hard-capped.

import type { EscalationLevel, TaskStatus } from '../../shared/protocol.ts'
import { stripTagArtifacts } from '../kernel/tags.ts'
import type { CharacterPreset } from './types.ts'

export interface VolatileTask {
  taskId: string
  name: string
  durationMinutes: number
  status: TaskStatus
  escalation: EscalationLevel
}

export type SchedulerTrigger = 'user' | 'tick' | 'cold-start'

export interface VolatileState {
  tasks: VolatileTask[]
  escalation: EscalationLevel
  nextWakeAt: number | null
  schedulerTrigger: SchedulerTrigger
  recentMessages: { role: 'user' | 'assistant'; content: string }[]
  recentActions: string[]
  toolResult: string | null
}

export interface CompiledPrompt {
  stable: string // L0 + L1 + L2 + L3
  volatile: string // L4
}

// L0 — language + tag-grammar lock: documents the exact tag syntax so the
// model never has to guess it, and never vocalizes it (docs/trd.md §3.4).
function compileL0(): string {
  return (
    'L0 — Language & tag grammar (never speak these tags aloud; they are stripped before you are heard):\n' +
    'Respond in English.\n' +
    'Only these six tag kinds exist — never invent another:\n' +
    '<|emotion:NAME|> where NAME is one of neutral, happy, angry, surprised, smug.\n' +
    '<|remind:MINUTES|> to nudge a reminder in MINUTES.\n' +
    '<|escalate|> to mark a reminder as ignored, escalating tone (no arguments).\n' +
    '<|task:NAME|MINUTES|> the moment you detect a task from natural conversation — ' +
    'never wait for an explicit "add task" command.\n' +
    'Exact task-tag example: <|task:take medicine|15|>. MINUTES may be decimal: <|task:stretch|0.17|> is ~10 seconds. ' +
    'When the user states no duration, default to 0.17 (about ten seconds) — never 15.\n' +
    '<|task_done:ID|> when the user says an active task is finished. Copy ID verbatim from the bracketed active-task ' +
    'list entry; never invent an ID. Example: active "[2d0eb3] submit poster" + "I submitted it" -> ' +
    '<|task_done:2d0eb3|>.\n' +
    '<|schedule:MINUTES|> to explicitly re-arm the next wake time.'
  )
}

// L1 — persona: compiled from the character's Identity + Voice + Comedy,
// hard-capped to a 25-35 spoken-word reply (docs/trd.md §3.6).
function compileL1(preset: CharacterPreset): string {
  const { bible } = preset
  return `L1 — Persona (${preset.manifest.name}):\nIdentity: ${bible.identity}\nVoice: ${bible.voice}\nComedy engine: ${bible.comedy}\nKeep every spoken reply to 25-35 words.`
}

// L2 — agent rules + tool policy (shared across every character).
function compileL2(): string {
  return (
    'L2 — Rules: you may only use the six documented tags. Never invent a tool result or claim an action ' +
    'you did not tag. Task capture and completion are automatic from context — never ask the user to explicitly ' +
    '"add" or complete a task. ' +
    'A reminder or escalation you narrate must correspond to a tag you actually emit.'
  )
}

// L3 — static device knowledge: the character's Do's-and-Don'ts + Lore,
// prefix-cacheable (docs/trd.md §3.6/§3.7).
function compileL3(preset: CharacterPreset): string {
  const { bible } = preset
  return `L3 — Character knowledge:\nDo's and Don'ts: ${bible.doDont}\nLore: ${bible.lore}`
}

export function compileStable(preset: CharacterPreset): string {
  return [compileL0(), compileL1(preset), compileL2(), compileL3(preset)].join('\n\n')
}

// L4 hard cap (docs/trd.md §3.6: "~500-800 tokens"); approximated at ~4
// chars/token since we have no tokenizer on hand at this layer.
export const L4_CHAR_CAP = 3200

function taskLine(task: VolatileTask): string {
  return `- [${task.taskId.slice(0, 6)}] ${task.name} (${task.durationMinutes}m, status=${task.status}, escalation=${task.escalation})`
}

// L4 — volatile state, always last, windowed so the recent-conversation tail
// shrinks to fit the hard cap rather than overflowing it.
export function compileVolatile(state: VolatileState): string {
  const header: string[] = [
    'L4 — Volatile state:',
    `Scheduler trigger: ${state.schedulerTrigger}`,
    `Escalation level: ${state.escalation}`,
    `Next scheduled wake: ${state.nextWakeAt ? new Date(state.nextWakeAt).toISOString() : 'none'}`,
    state.tasks.length ? 'Current tasks:' : 'Current tasks: none',
    ...state.tasks.map(taskLine)
  ]
  if (state.schedulerTrigger === 'tick') {
    header.push(
      'This is a scheduler tick, not a new user message. Give a fresh reminder from the current task state; do not repeat a historical reply or emit a task tag.'
    )
  }
  if (state.recentActions.length) header.push(`Recent actions: ${state.recentActions.join(', ')}`)
  if (state.toolResult) header.push(`Tool result: ${state.toolResult}`)

  const headerText = header.join('\n')
  const budget = Math.max(0, L4_CHAR_CAP - headerText.length - 32)

  // Window the most-recent-first, keeping only what fits, then restore order.
  const windowed: string[] = []
  let used = 0
  for (let i = state.recentMessages.length - 1; i >= 0; i--) {
    const message = state.recentMessages[i]
    if (!message) continue
    const line = `${message.role}: ${stripTagArtifacts(message.content)}`
    if (used + line.length + 1 > budget) break
    windowed.unshift(line)
    used += line.length + 1
  }

  const parts = [headerText]
  if (windowed.length) parts.push('Recent conversation:', ...windowed)
  const volatile = parts.join('\n')
  return volatile.length > L4_CHAR_CAP ? volatile.slice(0, L4_CHAR_CAP) : volatile
}

export function compilePrompt(preset: CharacterPreset, state: VolatileState): CompiledPrompt {
  return { stable: compileStable(preset), volatile: compileVolatile(state) }
}
