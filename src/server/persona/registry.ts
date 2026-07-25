// The character-preset registry (docs/plan.md T11 item 4; docs/trd.md §3.7):
// a swappable-preset seam. Multi-character is an architecture seam only this
// iteration — `register()` lets a stub second preset be added without
// touching kernel logic, but only Sahur ships. Conversations persist the
// selected preset ID in `bun:sqlite`.

import { existsSync, readdirSync } from 'node:fs'
import type { CharacterSummary } from '../../shared/protocol.ts'
import { loadCharacter } from './loader.ts'
import type { CharacterPreset } from './types.ts'

export const DEFAULT_CHARACTER_ID = 'sahur'

const POKE_LINES: Readonly<Record<string, readonly string[]>> = {
  sahur: [
    'TUNG. I felt that poke in my grain. Your task heard it too.',
    'Tok tok. The deadline blinked. I blinked back harder.',
    'Poke logged. I am standing inside your to-do list spiritually.',
    'Easy. My splinters are taking attendance.',
    'You tapped the log. The calendar is nervous.',
    'Bold. You rang the task goblin made of lumber.',
    'Another poke and I whisper your due date to every spreadsheet.',
    'The wood remembers. Mostly your unfinished checkbox.',
    'Poke received. Your task just sat up in its little chair.',
    'Careful. I am one knock from narrating your procrastination.'
  ],
  tralala: [
    'Tap logged. Your deadline just heard sneakers approaching.',
    'Boop accepted. I am jogging around your unfinished task.',
    'You tapped a shark. The to-do list is doing laps now.',
    'Again? Fine. I will commentate your next checkbox live.',
    'Fin swagger activated. Your reminder is warming up.',
    'That poke gave your deadline a tiny pair of sneakers.',
    'Tralalero, tralala. Was that a tap or a starting pistol?',
    'Careful. I circle schedules, not people. Very professional.',
    'Poke received. Your task is now losing a race to me.',
    'One more tap and I make your calendar wear a sweatband.'
  ]
}

// Shuffle-bag per character: every line plays once before any repeats, and
// the reshuffle never leads with the line that just played.
const pokeBags = new Map<string, string[]>()
const lastPokeLine = new Map<string, string>()

// Test-only: clears the shuffle-bag state so draws start from a fresh cycle.
export function resetPokeLineState(): void {
  pokeBags.clear()
  lastPokeLine.clear()
}

export function pickPokeLine(preset: CharacterPreset): string {
  const lines = POKE_LINES[preset.manifest.id]
  if (!lines?.length) return `${preset.manifest.name} acknowledges the poke.`
  let bag = pokeBags.get(preset.manifest.id)
  if (!bag?.length) {
    bag = [...lines]
    for (let i = bag.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[bag[i], bag[j]] = [bag[j] as string, bag[i] as string]
    }
    if (bag.length > 1 && bag[bag.length - 1] === lastPokeLine.get(preset.manifest.id)) {
      ;[bag[bag.length - 1], bag[0]] = [bag[0] as string, bag[bag.length - 1] as string]
    }
    pokeBags.set(preset.manifest.id, bag)
  }
  const line = bag.pop() ?? lines[0] ?? `${preset.manifest.name} acknowledges the poke.`
  lastPokeLine.set(preset.manifest.id, line)
  return line
}

export class CharacterRegistry {
  private readonly cache = new Map<string, CharacterPreset>()

  constructor(private readonly charactersDir = 'characters') {}

  // Registers/overrides a preset directly (the "a stub second preset can be
  // registered without touching kernel logic" seam, docs/plan.md T11 item 4).
  register(id: string, preset: CharacterPreset): void {
    this.cache.set(id, preset)
  }

  get(id: string): CharacterPreset {
    const cached = this.cache.get(id)
    if (cached) return cached
    const loaded = loadCharacter(id, this.charactersDir)
    this.cache.set(id, loaded)
    return loaded
  }

  list(): CharacterSummary[] {
    const ids = new Set<string>([DEFAULT_CHARACTER_ID, ...this.cache.keys()])
    if (existsSync(this.charactersDir)) {
      for (const entry of readdirSync(this.charactersDir, { withFileTypes: true })) {
        const characterDir = `${this.charactersDir}/${entry.name}`
        if (
          entry.isDirectory() &&
          existsSync(`${characterDir}/character.json`) &&
          existsSync(`${characterDir}/bible.md`)
        ) {
          ids.add(entry.name)
        }
      }
    }
    return [...ids]
      .map((id) => {
        const preset = this.get(id)
        return { id: preset.manifest.id, displayName: preset.manifest.name }
      })
      .sort((left, right) => left.id.localeCompare(right.id))
  }
}
