// The Agent-Kernel seam (docs/plan.md T8/T11): the kernel state-snapshot shape.
// T11 owns the validated transitions (clamp/increment/snooze/reset) on top of
// this shape; T8 only defines what a snapshot looks like and its resting state.

import type { EscalationLevel } from '../../shared/protocol.ts'

export type KernelStatus = 'idle' | 'listening' | 'thinking' | 'speaking'

export interface KernelStateSnapshot {
  task: string | null
  status: KernelStatus
  escalation: EscalationLevel
  nextWakeAt: number | null // epoch ms; null = no scheduled wake
  lastActionIds: string[]
}

export function initialKernelState(): KernelStateSnapshot {
  return {
    task: null,
    status: 'idle',
    escalation: 0,
    nextWakeAt: null,
    lastActionIds: []
  }
}
