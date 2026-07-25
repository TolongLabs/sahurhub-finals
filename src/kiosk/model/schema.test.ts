// Schema validation + action-mapping resolution tests (docs/plan.md T9a
// quality bar: "unit-test what's testable without WebGL"). No 'three' import
// here — WebGL rendering itself is verified via the harness screenshot.

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { CharacterDefValidationError, resolveAction, validateCharacterDef } from './schema.ts'
import type { CharacterDef } from './types.ts'

const SAHUR_CHARACTER_PATH = `${import.meta.dir}/../../../characters/sahur/character.json`

function loadRawSahurCharacter(): unknown {
  return JSON.parse(readFileSync(SAHUR_CHARACTER_PATH, 'utf8'))
}

function validSahurDef(): CharacterDef {
  return validateCharacterDef(loadRawSahurCharacter())
}

describe('validateCharacterDef', () => {
  test('accepts the committed characters/sahur/character.json bundle', () => {
    const def = validSahurDef()
    expect(def.id).toBe('sahur')
    expect(def.displayName).toBe('Sahur')
    expect(def.voice).toEqual({ backend: 'tts-flash', voiceId: 'ethan', placeholder: true })
    expect(def.actions.remind).toEqual({ animation: 'knock', tiers: 3 })
    expect(def.actions.escalate).toEqual({ animation: 'postureShift', tiers: 3 })
    expect(def.escalationFlavor).toEqual(['gentle', 'direct', 'blunt'])
  })

  test('rejects a non-object value', () => {
    expect(() => validateCharacterDef('sahur')).toThrow(CharacterDefValidationError)
    expect(() => validateCharacterDef(null)).toThrow(CharacterDefValidationError)
    expect(() => validateCharacterDef([])).toThrow(CharacterDefValidationError)
  })

  test('rejects a missing required field', () => {
    const raw = loadRawSahurCharacter() as Record<string, unknown>
    const { displayName, ...withoutDisplayName } = raw
    expect(() => validateCharacterDef(withoutDisplayName)).toThrow(/displayName/)
  })

  test('rejects an incomplete model.colors', () => {
    const raw = loadRawSahurCharacter() as Record<string, unknown>
    const model = raw.model as Record<string, unknown>
    const colors = model.colors as Record<string, unknown>
    const { body, ...withoutBody } = colors
    expect(() => validateCharacterDef({ ...raw, model: { ...model, colors: withoutBody } })).toThrow(
      /model\.colors\.body/
    )
  })

  test('rejects a non-finite proportion', () => {
    const raw = loadRawSahurCharacter() as Record<string, unknown>
    const model = raw.model as Record<string, unknown>
    const proportions = model.proportions as Record<string, unknown>
    expect(() =>
      validateCharacterDef({ ...raw, model: { ...model, proportions: { ...proportions, bodyHeight: Number.NaN } } })
    ).toThrow(/model\.proportions\.bodyHeight/)
  })

  test('rejects an empty actions map', () => {
    const raw = loadRawSahurCharacter() as Record<string, unknown>
    expect(() => validateCharacterDef({ ...raw, actions: {} })).toThrow(/actions/)
  })

  test('rejects an empty escalationFlavor array', () => {
    const raw = loadRawSahurCharacter() as Record<string, unknown>
    expect(() => validateCharacterDef({ ...raw, escalationFlavor: [] })).toThrow(/escalationFlavor/)
  })
})

describe('resolveAction', () => {
  test('resolves remind at tier 1..3 to knock with the matching flavor', () => {
    const def = validSahurDef()
    expect(resolveAction(def, 'remind', 1)).toEqual({ animation: 'knock', tier: 1, flavor: 'gentle' })
    expect(resolveAction(def, 'remind', 2)).toEqual({ animation: 'knock', tier: 2, flavor: 'direct' })
    expect(resolveAction(def, 'remind', 3)).toEqual({ animation: 'knock', tier: 3, flavor: 'blunt' })
  })

  test('clamps out-of-range intensity into [1, tiers]', () => {
    const def = validSahurDef()
    expect(resolveAction(def, 'remind', 0)).toEqual({ animation: 'knock', tier: 1, flavor: 'gentle' })
    expect(resolveAction(def, 'remind', 99)).toEqual({ animation: 'knock', tier: 3, flavor: 'blunt' })
  })

  test('resolves escalate to postureShift', () => {
    const def = validSahurDef()
    expect(resolveAction(def, 'escalate', 2)).toEqual({ animation: 'postureShift', tier: 2, flavor: 'direct' })
  })

  test('defaults to intensity 1 when omitted', () => {
    const def = validSahurDef()
    expect(resolveAction(def, 'remind')).toEqual({ animation: 'knock', tier: 1, flavor: 'gentle' })
  })

  test('throws on an action the character does not define', () => {
    const def = validSahurDef()
    expect(() => resolveAction(def, 'juggle')).toThrow(/unknown action "juggle"/)
  })
})
