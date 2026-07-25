import type { AgentEvent } from '../shared/protocol.ts'

export interface RendererAction {
  name: string
  intensity: number
}

const EXPRESSION_ALIASES: Record<string, string> = {
  happy: 'smug',
  surprised: 'shock',
  surprised_face: 'shock',
  sad: 'sulk',
  sleeping: 'sleep'
}

export function expressionForAvatar(expression: string): string {
  const normalized = expression.trim().toLowerCase()
  const alias = EXPRESSION_ALIASES[normalized]
  if (alias) return alias
  return ['neutral', 'smug', 'angry', 'sulk', 'shock', 'sleep'].includes(normalized) ? normalized : 'neutral'
}

export function actionForAgentEvent(event: Pick<AgentEvent, 'kind' | 'args' | 'animation'>): RendererAction | null {
  const intensity = boundedIntensity(event.args.tier ?? event.args.level ?? event.args.intensity)
  if (event.animation) return { name: event.animation, intensity }
  if (event.kind === 'tung' || event.kind === 'remind') return { name: 'remind', intensity }
  if (event.kind === 'escalate' || event.kind === 'schedule') return { name: 'escalate', intensity }
  return null
}

export class PlaybackBoundaryQueue {
  private pending: Array<() => void> = []

  enqueue(effect: () => void): void {
    this.pending.push(effect)
  }

  flush(): void {
    const effects = this.pending
    this.pending = []
    for (const effect of effects) effect()
  }
}

function boundedIntensity(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(1, Math.min(3, Math.round(value))) : 1
}
