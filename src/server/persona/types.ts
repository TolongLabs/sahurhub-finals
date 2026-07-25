// The character bible bundle shape (docs/decisions.md "Character bible system
// LOCKED"; docs/trd.md §3.7): characters/<id>/character.json (machine
// contract) + bible.md (prose persona), compiled onto the 5-layer prompt
// (persona/prompt.ts). Sahur is the first (and only built) instance; the
// registry (persona/registry.ts) is the seam for future characters.

export interface CharacterVoiceSeam {
  backend: 'realtime' | 'tts-flash'
  voiceId: string
}

export interface CharacterModelRef {
  primary: string // Three.js model/scene reference (src/kiosk/model)
  spriteFallback: string // WebGL-failure fallback rung (assets/character/sprites)
}

// Generic reminder/escalation actions map per-character to an animation name
// (docs/trd.md §3.7 — Sahur: remind/escalate -> "tung").
export interface CharacterActionMap {
  remind: string
  escalate: string
}

export interface CharacterManifest {
  id: string
  name: string
  voice: CharacterVoiceSeam
  model: CharacterModelRef
  actionMap: CharacterActionMap
  escalationFlavor: string
}

// Identity / Voice & speech patterns / Comedy engine / Do's-and-Don'ts / Lore
// (docs/decisions.md) — compiled onto L1 (Identity+Voice+Comedy) and L3
// (Do-Don't+Lore, prefix-cacheable).
export interface CharacterBible {
  identity: string
  voice: string
  comedy: string
  doDont: string
  lore: string
}

export interface CharacterPreset {
  manifest: CharacterManifest
  bible: CharacterBible
}
