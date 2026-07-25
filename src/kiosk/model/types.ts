// Character-agnostic types shared by the T9a Three.js renderer module and
// every characters/<id>/character.json bundle (docs/decisions.md "Character
// bible system LOCKED"; docs/trd.md §3.7/§3.8). Only Sahur is built this
// iteration, but nothing here names Sahur — a future character preset drops
// in by shipping its own character.json against these same shapes.

export interface VoiceSeam {
  backend: string
  voiceId: string
  // true until a Spike A/T4-confirmed stock voice (or a promoted custom
  // voice-design/cloning seam) replaces this placeholder pick.
  placeholder: boolean
}

export interface ModelColors {
  body: string
  mallet: string
  foot: string
  face: string
  eye: string
  outline: string
  accent: string
}

export interface ModelProportions {
  bodyWidth: number
  bodyHeight: number
  bodyDepth: number
  footWidth: number
  footHeight: number
  headHeight: number
  armLength: number
  malletHandleLength: number
  malletHeadSize: number
}

export interface ModelParams {
  // Path to the renderer module that knows how to build this character's
  // primitive-composition model (docs/plan.md T9a Route A).
  renderer: string
  colors: ModelColors
  proportions: ModelProportions
}

export interface ActionMapping {
  // Built-in renderer animation this generic action name maps to (e.g.
  // 'knock', 'postureShift'). New characters may introduce new animation
  // names; the renderer no-ops (with a console warning) on one it doesn't
  // implement rather than throwing.
  animation: string
  // Escalation tier count for this action (e.g. remind:1..3 -> knock tiers).
  // Omitted means a single, non-escalating tier.
  tiers?: number
}

export interface CharacterDef {
  id: string
  displayName: string
  voice: VoiceSeam
  model: ModelParams
  actions: Record<string, ActionMapping>
  escalationFlavor: string[]
}

export type ExpressionName = 'neutral' | 'smug' | 'angry' | 'sulk' | 'shock' | 'sleep'

export const EXPRESSION_NAMES: readonly ExpressionName[] = ['neutral', 'smug', 'angry', 'sulk', 'shock', 'sleep']
