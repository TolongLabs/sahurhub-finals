// Loads a character bundle from `characters/<id>/character.json` + `bible.md`
// (docs/decisions.md "Character bible system LOCKED"; docs/trd.md §3.7). Sahur
// falls back to the built-in DEFAULT_SAHUR_PRESET if the bundle files haven't
// landed yet — this task (T11) does not block on the character-art PG's
// output (docs/plan.md wave notes).
//
// Reconciliation note (T11, end-of-wave): decisions.md pins the bundle's
// CATEGORIES (id, voice seam, model ref + sprite-fallback ref, generic-action
// mapping, escalationFlavor) but not exact JSON key names. The real
// `characters/sahur/character.json` that landed uses `displayName` (not
// `name`), `model.renderer` (not `model.primary`), a top-level
// `spriteFallback` (not nested under `model`), `actions.<name>.animation`
// (not a flat `actionMap`), and an `escalationFlavor` array (not a string).
// `parseManifest` below tolerates both that real shape and this file's
// originally-assumed shape so neither side has to change field names.

import { existsSync, readFileSync } from 'node:fs'
import { DEFAULT_SAHUR_PRESET } from './default-sahur.ts'
import type { CharacterBible, CharacterManifest, CharacterPreset } from './types.ts'

function section(markdown: string, heading: RegExp): string {
  const match = new RegExp(`##\\s*(?:${heading.source})[^\\n]*\\n([\\s\\S]*?)(?=\\n##\\s|$)`, 'i').exec(markdown)
  return match?.[1]?.trim() ?? ''
}

function parseBible(markdown: string): CharacterBible {
  return {
    identity: section(markdown, /identity/),
    voice: section(markdown, /voice(?:\s*&\s*speech patterns)?/),
    comedy: section(markdown, /comedy(?:\s*engine)?/),
    doDont: section(markdown, /do'?s?[- ]?and[- ]?don'?ts?/),
    lore: section(markdown, /lore/)
  }
}

interface RawActionEntry {
  animation?: string
}

interface RawCharacterManifest {
  id: string
  name?: string
  displayName?: string
  voice: { backend: 'realtime' | 'tts-flash'; voiceId: string }
  model?: { primary?: string; renderer?: string; spriteFallback?: string }
  spriteFallback?: string
  actionMap?: { remind?: string; escalate?: string }
  actions?: { remind?: RawActionEntry; escalate?: RawActionEntry }
  escalationFlavor?: string | string[]
}

function parseManifest(raw: RawCharacterManifest): CharacterManifest {
  return {
    id: raw.id,
    name: raw.displayName ?? raw.name ?? raw.id,
    voice: raw.voice,
    model: {
      primary: raw.model?.renderer ?? raw.model?.primary ?? `src/kiosk/model/${raw.id}`,
      spriteFallback: raw.spriteFallback ?? raw.model?.spriteFallback ?? 'assets/character/manifest.json'
    },
    actionMap: {
      remind: raw.actions?.remind?.animation ?? raw.actionMap?.remind ?? 'tung',
      escalate: raw.actions?.escalate?.animation ?? raw.actionMap?.escalate ?? 'tung'
    },
    escalationFlavor: Array.isArray(raw.escalationFlavor)
      ? raw.escalationFlavor.join(' -> ')
      : (raw.escalationFlavor ?? '')
  }
}

export function loadCharacter(id: string, charactersDir = 'characters'): CharacterPreset {
  const dir = `${charactersDir}/${id}`
  const manifestPath = `${dir}/character.json`
  const biblePath = `${dir}/bible.md`

  if (!existsSync(manifestPath) || !existsSync(biblePath)) {
    if (id === 'sahur') return DEFAULT_SAHUR_PRESET
    throw new Error(`unknown character '${id}': no bundle found at ${dir}`)
  }

  const raw = JSON.parse(readFileSync(manifestPath, 'utf8')) as RawCharacterManifest
  const manifest = parseManifest(raw)
  const bible = parseBible(readFileSync(biblePath, 'utf8'))
  return { manifest, bible }
}
