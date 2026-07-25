// WebSocket wire contract between the kiosk/phone clients and the Bun server.
// Client<->server event shapes port LLaMaDesu's protocol.ts/protocol.py; the
// server->client `ReplyEvent` follows Kawan's hub envelope `{type, say, emotion,
// escalation}` so the escalation level rides the wire (docs/decisions.md,
// 2026-07-15 "Agent layer"). Raw audio travels as **binary** WS frames on the
// hot path; everything else here is JSON.
//
// T11 is the SOLE author of this file this wave (docs/plan.md T11) — it adds
// the remote-webapp messages (conversation CRUD, titles, tasks-sync, settings/
// character hot-swap), the file-upload message kind, and the `source:
// 'phone'|'device'` dual-interaction-mode field, so T9b/T10a/T10b consume one
// coherent contract with no wave collision.

export type EscalationLevel = 0 | 1 | 2

// Dual interaction mode (docs/decisions.md 2026-07-15 "Dual interaction mode"):
// every input-originating message is tagged with its source; the kernel stays
// source-agnostic (one serialized queue, latest-source-wins is an arbitration
// note for post-MVP — not enforced here).
export type InputSource = 'phone' | 'device'
export type AudioSink = 'phone' | 'device'
export type DisplayRotation = 0 | 90 | 180 | 270

// --- client -> server --------------------------------------------------------

export interface HelloMessage {
  type: 'hello'
  client?: string
}

export interface TextMessage {
  type: 'text'
  text: string
  // client-assigned turn id, echoed back on every event of this turn so the
  // client can drop stragglers from a turn it has already superseded.
  id?: string
  source?: InputSource
}

export interface AudioEndMessage {
  type: 'audio_end'
  source?: InputSource
}

export interface InterruptMessage {
  type: 'interrupt'
}

export interface PokeMessage {
  type: 'poke'
}

export interface AudioSinkMessage {
  type: 'audio_sink'
  sink: AudioSink
}

export interface DisplayRotateMessage {
  type: 'display_rotate'
  degrees: DisplayRotation
}

// --- remote-webapp messages (T11, 2026-07-15 "Remote-control webapp spec") --

export interface ConversationNewMessage {
  type: 'conversation_new'
  characterId: string
}

export interface ConversationSwitchMessage {
  type: 'conversation_switch'
  conversationId: string
}

export interface ConversationDeleteMessage {
  type: 'conversation_delete'
  conversationId: string
}

// Clears the ACTIVE conversation's messages without creating a new turn.
export interface ResetMessage {
  type: 'reset'
}

// Deprecated global-character message retained for older clients. New
// conversations choose their character once through `conversation_new`.
export interface CharacterSelectMessage {
  type: 'character_select'
  characterId: string
}

// The remote's explicit "Escalate" control (T10a) — drives the kernel's
// escalation trigger for the active conversation's most recent task directly,
// distinct from a scheduler tick or a repeated ignored reminder.
export interface EscalateMessage {
  type: 'escalate'
}

export interface TaskActionMessage {
  type: 'task_action'
  taskId: string
  action: 'done' | 'discard'
}

// Inline title override (T10a/T10b topbar edit) — persists over whatever the
// async title-generation call produced for the active conversation.
export interface TitleEditMessage {
  type: 'title_edit'
  title: string
}

// `[FAKE-OK]` camera stub (A3, docs/plan.md T10a): emits a canned "look at
// me" reaction with no real vision, off the async `inspect_camera`/vision
// lane's normal image path. Promotable to a real capture without a wire
// change if camera vision is promoted from Should/Could.
export interface CameraStubMessage {
  type: 'camera_stub'
}

export type ClientMessage =
  | HelloMessage
  | TextMessage
  | AudioEndMessage
  | InterruptMessage
  | PokeMessage
  | AudioSinkMessage
  | DisplayRotateMessage
  | ConversationNewMessage
  | ConversationSwitchMessage
  | ConversationDeleteMessage
  | ResetMessage
  | CharacterSelectMessage
  | EscalateMessage
  | TaskActionMessage
  | TitleEditMessage
  | CameraStubMessage

const CLIENT_MESSAGE_TYPES: ReadonlySet<ClientMessage['type']> = new Set([
  'hello',
  'text',
  'audio_end',
  'interrupt',
  'poke',
  'audio_sink',
  'display_rotate',
  'conversation_new',
  'conversation_switch',
  'conversation_delete',
  'reset',
  'character_select',
  'escalate',
  'task_action',
  'title_edit',
  'camera_stub'
])

// --- Agent Kernel event seam --------------------------------------------------

// Known semantic tag->event kinds (docs/plan.md T11). Character animation
// names ride separately on `animation`, so the wire remains generic while a
// renderer can use the selected character's resolved binding.
export const KNOWN_AGENT_EVENT_KINDS = ['tung', 'remind', 'escalate', 'schedule', 'expression'] as const
export type KnownAgentEventKind = (typeof KNOWN_AGENT_EVENT_KINDS)[number]
export type AgentEventKind = KnownAgentEventKind | (string & {})

export interface AgentEvent {
  id: string
  kind: AgentEventKind
  args: Record<string, unknown>
  animation?: string
  // When the event's physical effect should fire. Effects sync to the audio
  // playback boundary, not parse time (docs/decisions.md "Agent layer").
  playbackCue: 'immediate' | 'audio-boundary'
}

// --- minimal task model + multi-conversation shapes (wire summaries) --------

// docs/decisions.md 2026-07-15 "Task model minimal": exactly
// {task_id, task_name, duration}; status is kernel bookkeeping riding the wire
// so the remote's Tasks island can render lifecycle without a second fetch.
export type TaskStatus = 'pending' | 'reminding' | 'escalated' | 'done' | 'dismissed' | 'missed'

export interface TaskSummary {
  taskId: string
  taskName: string
  duration: number // minutes; drives scheduling (docs/decisions.md)
  status: TaskStatus
  escalation: EscalationLevel
  nextWakeAt: number | null
}

export interface ConversationSummary {
  id: string
  title: string | null
  createdAt: number
}

export interface CharacterSummary {
  id: string
  displayName: string
}

export type MessageKind = 'text' | 'upload-text' | 'upload-image'
export type MessageRole = 'user' | 'assistant'

export interface MessageSummary {
  id: string
  conversationId: string
  role: MessageRole
  content: string
  kind: MessageKind
  ts: number
}

// --- server -> client ----------------------------------------------------------

export interface TranscriptEvent {
  type: 'transcript'
  conversationId: string
  text: string
  final: boolean
}

export interface TokenEvent {
  type: 'token'
  conversationId: string
  text: string
}

export interface AvatarEvent {
  type: 'avatar'
  conversationId: string
  expression: string
}

// `data` is base64-encoded **mono PCM16LE** at `sampleRate` (confirmed
// against apps/remote/src/audio/player.ts's decode assumption — T10a
// flagged this for T11 to confirm; it's correct, keep it if this changes).
export interface TtsChunkEvent {
  type: 'tts_chunk'
  conversationId: string
  data: string
  sampleRate: number
}

export interface AudioSinkEvent {
  type: 'audio_sink'
  sink: AudioSink
  active: boolean
}

export interface DisplayRotationEvent {
  type: 'display_rotation'
  degrees: DisplayRotation
}

export interface StatusEvent {
  type: 'status'
  state: 'idle' | 'listening' | 'thinking' | 'speaking'
}

export interface ErrorEvent {
  type: 'error'
  message: string
}

export interface NoticeEvent {
  type: 'notice'
  conversationId: string
  message: string
}

export interface DoneEvent {
  type: 'done'
  conversationId: string
}

// The Agent Kernel's post-parse turn summary — Kawan's `{say, emotion,
// escalate}` hub envelope, with escalation riding the wire as its own level.
export interface ReplyEvent {
  type: 'reply'
  conversationId: string
  say: string
  emotion: string
  escalation: EscalationLevel
}

// An ordered AgentEvent (drum/expression/effect) delivered to the client.
export interface AgentEventMessage {
  type: 'agent_event'
  conversationId: string
  event: AgentEvent
}

// --- remote-webapp push events (T11) -----------------------------------------

export interface ConversationListEvent {
  type: 'conversation_list'
  conversations: ConversationSummary[]
}

export interface ConversationActiveEvent {
  type: 'conversation_active'
  conversationId: string
}

// Fills the topbar's editable title after the async post-first-exchange Qwen
// call (docs/decisions.md — distinct from the single-call intent classifier).
export interface TitleEvent {
  type: 'title'
  conversationId: string
  title: string
}

export interface TaskListEvent {
  type: 'task_list'
  conversationId: string
  tasks: TaskSummary[]
}

// A persisted `messages` row echoed to clients — used for upload echoes, the
// async vision-lane reaction, and (later) any assistant line delivered
// out-of-band from the streaming `reply` envelope of its own turn.
export interface MessageEvent {
  type: 'message'
  message: MessageSummary
}

// The full message history of a conversation, pushed on switch/reset so the
// client repaints the thread without a separate fetch round-trip.
export interface MessageHistoryEvent {
  type: 'message_history'
  conversationId: string
  messages: MessageSummary[]
}

export interface CharacterActiveEvent {
  type: 'character_active'
  characterId: string
}

export interface CharacterListEvent {
  type: 'character_list'
  characters: CharacterSummary[]
}

export type ServerMessage =
  | TranscriptEvent
  | TokenEvent
  | AvatarEvent
  | TtsChunkEvent
  | AudioSinkEvent
  | DisplayRotationEvent
  | StatusEvent
  | ErrorEvent
  | NoticeEvent
  | DoneEvent
  | ReplyEvent
  | AgentEventMessage
  | ConversationListEvent
  | ConversationActiveEvent
  | TitleEvent
  | TaskListEvent
  | MessageEvent
  | MessageHistoryEvent
  | CharacterActiveEvent
  | CharacterListEvent

const SERVER_MESSAGE_TYPES: ReadonlySet<ServerMessage['type']> = new Set([
  'transcript',
  'token',
  'avatar',
  'tts_chunk',
  'audio_sink',
  'display_rotation',
  'status',
  'error',
  'notice',
  'done',
  'reply',
  'agent_event',
  'conversation_list',
  'conversation_active',
  'title',
  'task_list',
  'message',
  'message_history',
  'character_active',
  'character_list'
])

function hasStringType(value: unknown): value is { type: string } {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function hasOptionalString(value: Record<string, unknown>, key: string): boolean {
  return value[key] === undefined || typeof value[key] === 'string'
}

function hasOptionalInputSource(value: Record<string, unknown>): boolean {
  return value.source === undefined || value.source === 'phone' || value.source === 'device'
}

export function isClientMessage(value: unknown): value is ClientMessage {
  if (
    !isRecord(value) ||
    typeof value.type !== 'string' ||
    !CLIENT_MESSAGE_TYPES.has(value.type as ClientMessage['type'])
  ) {
    return false
  }

  switch (value.type) {
    case 'hello':
      return hasOptionalString(value, 'client')
    case 'text':
      return typeof value.text === 'string' && hasOptionalString(value, 'id') && hasOptionalInputSource(value)
    case 'audio_end':
      return hasOptionalInputSource(value)
    case 'audio_sink':
      return value.sink === 'phone' || value.sink === 'device'
    case 'display_rotate':
      return value.degrees === 0 || value.degrees === 90 || value.degrees === 180 || value.degrees === 270
    case 'conversation_new':
      return typeof value.characterId === 'string'
    case 'conversation_switch':
    case 'conversation_delete':
      return typeof value.conversationId === 'string'
    case 'character_select':
      return typeof value.characterId === 'string'
    case 'title_edit':
      return typeof value.title === 'string'
    case 'task_action':
      return typeof value.taskId === 'string' && (value.action === 'done' || value.action === 'discard')
    case 'interrupt':
    case 'poke':
    case 'reset':
    case 'escalate':
    case 'camera_stub':
      return true
    default:
      return false
  }
}

export function isServerMessage(value: unknown): value is ServerMessage {
  return hasStringType(value) && SERVER_MESSAGE_TYPES.has(value.type as ServerMessage['type'])
}
