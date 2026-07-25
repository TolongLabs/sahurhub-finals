// Generic tag->event grammar parser (docs/plan.md T11 item 4 + docs/trd.md
// §3.4). Ports the streaming-safe partial-tag-holdback pattern from
// LLaMaDesu's backend/app/agent/emotion.py (delimited `<|kind:args|>` tags,
// held back at a delta boundary so a tag split across streamed tokens never
// leaks into visible text/TTS) — generalized from a single `emotion` tag to
// the full tool-policy allowlist (docs/plan.md T11 item 1): remind, escalate,
// emotion, task, schedule. Every recognized tag (valid or malformed) is
// stripped from the output text; only a VALID tag produces a ParsedTagEvent.

export type TagKind = 'emotion' | 'remind' | 'escalate' | 'task' | 'task_done' | 'schedule'

export const ALLOWED_TAG_KINDS: ReadonlySet<TagKind> = new Set([
  'emotion',
  'remind',
  'escalate',
  'task',
  'task_done',
  'schedule'
])

export const KNOWN_EMOTIONS: ReadonlySet<string> = new Set(['neutral', 'happy', 'angry', 'surprised', 'smug'])

export const MAX_DURATION_MINUTES = 1440 // one day — bounded arg (tool policy)
export const MAX_TASK_NAME_LENGTH = 200

export interface ParsedTagEvent {
  kind: TagKind
  // Canonical re-serialization of the tag's (kind, args) — the per-turn
  // dedup key, so two identical tags in one generation only fire once.
  raw: string
  args: Record<string, unknown>
}

// Canonical `<|kind|>` / `<|kind:args|>` / `<|kind:args>` plus the common
// missing-opening-pipe drift `<kind:args|>`. `args` is captured lazily up to
// the closing `|?>` so a `task` tag's internal `name|duration` pipes survive.
const TAG_PATTERN = /<\s*\|?\s*([a-zA-Z_]+)\s*(?::\s*([^<>\r\n]*?)\s*)?\|?\s*>/g

// Defense in depth for text that reaches the reply path without being a
// parsable tool tag. A leading pipe is enough to identify a canonical tag;
// without it, require a colon so ordinary angle-bracket prose stays intact.
const TAG_ARTIFACT_PATTERN =
  /<\s*(?:\|\s*[a-zA-Z_][\w-]*(?:\s*:\s*[^<>\r\n]{0,240})?\s*\|?\s*>|[a-zA-Z_][\w-]*\s*:\s*[^<>\r\n]{0,240}\s*\|?\s*>)/g

// A possible partial tag at the very end of a streamed buffer: a lone "<" or
// an unterminated "<|..." run with no ">" yet — held back so it can complete
// on the next delta. Capped so a stray "<" in ordinary text can't hold the
// stream back forever.
const PARTIAL_TAIL_PATTERN = /<[^>]{0,64}$/

function parseTag(kindRaw: string, argStr: string | undefined): ParsedTagEvent | null {
  const kind = kindRaw.toLowerCase()
  if (!ALLOWED_TAG_KINDS.has(kind as TagKind)) return null

  switch (kind as TagKind) {
    case 'emotion': {
      const name = (argStr ?? '').trim().toLowerCase()
      if (!KNOWN_EMOTIONS.has(name)) return null
      return { kind: 'emotion', raw: `emotion:${name}`, args: { name } }
    }
    case 'remind': {
      const minutes = Number(argStr)
      if (!Number.isFinite(minutes) || minutes < 0.1 || minutes > MAX_DURATION_MINUTES) return null
      return { kind: 'remind', raw: `remind:${minutes}`, args: { minutes } }
    }
    case 'escalate':
      return { kind: 'escalate', raw: 'escalate', args: {} }
    case 'task': {
      const parts = (argStr ?? '').split('|')
      const name = parts[0]?.trim() ?? ''
      const duration = Number(parts[1])
      if (!name || name.length > MAX_TASK_NAME_LENGTH) return null
      if (!Number.isFinite(duration) || duration < 0.1 || duration > MAX_DURATION_MINUTES) return null
      return { kind: 'task', raw: `task:${name}|${duration}`, args: { name, duration } }
    }
    case 'task_done': {
      const name = (argStr ?? '').trim()
      if (!name || name.length > MAX_TASK_NAME_LENGTH) return null
      return { kind: 'task_done', raw: `task_done:${name}`, args: { name } }
    }
    case 'schedule': {
      const minutes = Number(argStr)
      if (!Number.isFinite(minutes) || minutes < 0.1 || minutes > MAX_DURATION_MINUTES) return null
      return { kind: 'schedule', raw: `schedule:${minutes}`, args: { minutes } }
    }
  }
}

export interface TaskNameCandidate {
  taskId: string
  taskName: string
}

export type TaskNameResolution<T extends TaskNameCandidate> =
  | { kind: 'resolved'; task: T }
  | { kind: 'not_found' }
  | { kind: 'ambiguous' }

function normalizeTaskName(name: string): string {
  return name.trim().toLocaleLowerCase()
}

export function resolveTaskName<T extends TaskNameCandidate>(name: string, tasks: T[]): TaskNameResolution<T> {
  const normalized = normalizeTaskName(name)
  const exact = tasks.filter((task) => normalizeTaskName(task.taskName) === normalized)
  if (exact.length === 1 && exact[0]) return { kind: 'resolved', task: exact[0] }
  if (exact.length > 1) return { kind: 'ambiguous' }

  const substring = tasks.filter((task) => {
    const taskName = normalizeTaskName(task.taskName)
    return taskName.includes(normalized) || normalized.includes(taskName)
  })
  if (substring.length === 1 && substring[0]) return { kind: 'resolved', task: substring[0] }
  return { kind: substring.length === 0 ? 'not_found' : 'ambiguous' }
}

export function resolveTaskCompletion<T extends TaskNameCandidate>(
  reference: string,
  tasks: T[]
): TaskNameResolution<T> {
  const normalized = normalizeTaskName(reference)
  const exactId = tasks.filter((task) => normalizeTaskName(task.taskId) === normalized)
  if (exactId.length === 1 && exactId[0]) return { kind: 'resolved', task: exactId[0] }
  if (exactId.length > 1) return { kind: 'ambiguous' }

  if (normalized.length >= 4) {
    const prefix = tasks.filter((task) => normalizeTaskName(task.taskId).startsWith(normalized))
    if (prefix.length === 1 && prefix[0]) return { kind: 'resolved', task: prefix[0] }
    if (prefix.length > 1) return { kind: 'ambiguous' }
  }

  return resolveTaskName(reference, tasks)
}

// One-shot extraction over a complete (or already-held-back) chunk of text.
// Always strips every tag-shaped match, valid or not — a malformed/rejected
// tag never leaks into visible text or TTS (docs/trd.md §3.4).
export function extractTags(text: string): { clean: string; events: ParsedTagEvent[] } {
  const events: ParsedTagEvent[] = []
  const clean = text.replace(TAG_PATTERN, (_match, kind: string, args: string | undefined) => {
    const parsed = parseTag(kind, args)
    if (parsed) events.push(parsed)
    return ''
  })
  return { clean, events }
}

export function stripTagArtifacts(text: string): string {
  return text.replace(TAG_ARTIFACT_PATTERN, '').replace(/<\|[^>]*$/, '')
}

// Streaming-safe variant: process `pending` but hold back a trailing partial
// tag so it never leaks while the rest may still arrive on the next token
// delta. Call `extractTags` once at stream end to flush any leftover
// remainder as literal text (docs/plan.md T11 item 4 — "held-partial-tail
// logic kept").
export function splitStreaming(pending: string): { clean: string; events: ParsedTagEvent[]; remainder: string } {
  const match = PARTIAL_TAIL_PATTERN.exec(pending)
  const cut = match ? match.index : pending.length
  const head = pending.slice(0, cut)
  const remainder = pending.slice(cut)
  const { clean, events } = extractTags(head)
  return { clean, events, remainder }
}

const MAX_EVENTS_PER_TURN = 12

// Per-turn dedup + rate limit (docs/plan.md T11 item 1 tool policy: "bounded
// args; dedup per turn; rate limits"). One gate instance per turn/generation.
export class TagDedupeGate {
  private readonly seen = new Set<string>()
  private count = 0

  filter(events: ParsedTagEvent[]): ParsedTagEvent[] {
    const kept: ParsedTagEvent[] = []
    for (const event of events) {
      if (this.count >= MAX_EVENTS_PER_TURN) break
      if (this.seen.has(event.raw)) continue
      this.seen.add(event.raw)
      this.count++
      kept.push(event)
    }
    return kept
  }
}
