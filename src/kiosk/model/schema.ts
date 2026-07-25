// Runtime validation for the LOCKED character-bible bundle schema
// (docs/decisions.md "Character bible system LOCKED") and generic
// action-mapping resolution (docs/plan.md T9a) — both testable without a
// WebGL context, per this task's quality bar.

import type { ActionMapping, CharacterDef, ModelColors, ModelProportions, VoiceSeam } from './types.ts'

export class CharacterDefValidationError extends Error {}

function fail(message: string): never {
  throw new CharacterDefValidationError(message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) fail(`"${field}" must be a non-empty string`)
  return value
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`"${field}" must be a finite number`)
  return value
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') fail(`"${field}" must be a boolean`)
  return value
}

const COLOR_KEYS = ['body', 'mallet', 'foot', 'face', 'eye', 'outline', 'accent'] as const
const PROPORTION_KEYS = [
  'bodyWidth',
  'bodyHeight',
  'bodyDepth',
  'footWidth',
  'footHeight',
  'headHeight',
  'armLength',
  'malletHandleLength',
  'malletHeadSize'
] as const

function validateVoice(value: unknown): VoiceSeam {
  if (!isRecord(value)) fail('"voice" must be an object')
  return {
    backend: requireString(value.backend, 'voice.backend'),
    voiceId: requireString(value.voiceId, 'voice.voiceId'),
    placeholder: requireBoolean(value.placeholder, 'voice.placeholder')
  }
}

function validateColors(value: unknown): ModelColors {
  if (!isRecord(value)) fail('"model.colors" must be an object')
  const colors = {} as Record<(typeof COLOR_KEYS)[number], string>
  for (const key of COLOR_KEYS) colors[key] = requireString(value[key], `model.colors.${key}`)
  return colors
}

function validateProportions(value: unknown): ModelProportions {
  if (!isRecord(value)) fail('"model.proportions" must be an object')
  const proportions = {} as Record<(typeof PROPORTION_KEYS)[number], number>
  for (const key of PROPORTION_KEYS) proportions[key] = requireNumber(value[key], `model.proportions.${key}`)
  return proportions
}

function validateModel(value: unknown): CharacterDef['model'] {
  if (!isRecord(value)) fail('"model" must be an object')
  return {
    renderer: requireString(value.renderer, 'model.renderer'),
    colors: validateColors(value.colors),
    proportions: validateProportions(value.proportions)
  }
}

function validateActions(value: unknown): Record<string, ActionMapping> {
  if (!isRecord(value)) fail('"actions" must be an object')
  const actions: Record<string, ActionMapping> = {}
  for (const [name, mapping] of Object.entries(value)) {
    if (!isRecord(mapping)) fail(`"actions.${name}" must be an object`)
    const entry: ActionMapping = { animation: requireString(mapping.animation, `actions.${name}.animation`) }
    if (mapping.tiers !== undefined) entry.tiers = requireNumber(mapping.tiers, `actions.${name}.tiers`)
    actions[name] = entry
  }
  if (Object.keys(actions).length === 0) fail('"actions" must define at least one action')
  return actions
}

function validateEscalationFlavor(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) fail('"escalationFlavor" must be a non-empty array')
  return value.map((entry, i) => requireString(entry, `escalationFlavor[${i}]`))
}

// Validates an unknown value (e.g. JSON.parse of characters/<id>/character.json)
// against the LOCKED bible-bundle schema. Throws CharacterDefValidationError
// with a field-pointing message on the first violation.
export function validateCharacterDef(value: unknown): CharacterDef {
  if (!isRecord(value)) fail('character.json must be an object')
  return {
    id: requireString(value.id, 'id'),
    displayName: requireString(value.displayName, 'displayName'),
    voice: validateVoice(value.voice),
    model: validateModel(value.model),
    actions: validateActions(value.actions),
    escalationFlavor: validateEscalationFlavor(value.escalationFlavor)
  }
}

export interface ResolvedAction {
  animation: string
  tier: number
  flavor: string
}

// Resolves a generic action name (e.g. 'remind', 'escalate') plus a 1-based
// intensity against a character's action-mapping + escalationFlavor labels
// (docs/plan.md T9a: "remind:1..3 -> knock tiers, escalate -> posture/
// expression shift"). Intensity clamps into [1, tiers] (default: a single
// tier when the mapping doesn't declare `tiers`).
export function resolveAction(def: CharacterDef, actionName: string, intensity = 1): ResolvedAction {
  const mapping = def.actions[actionName]
  if (!mapping) fail(`unknown action "${actionName}" for character "${def.id}"`)
  const tiers = mapping.tiers ?? 1
  const tier = Math.min(Math.max(Math.round(intensity), 1), tiers)
  const flavor = def.escalationFlavor[tier - 1] ?? def.escalationFlavor[def.escalationFlavor.length - 1] ?? ''
  return { animation: mapping.animation, tier, flavor }
}
