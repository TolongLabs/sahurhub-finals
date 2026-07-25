import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_SAHUR_PRESET } from './default-sahur.ts'
import { CharacterRegistry, pickPokeLine, resetPokeLineState } from './registry.ts'
import type { CharacterPreset } from './types.ts'

describe('CharacterRegistry', () => {
  test('defaults to Sahur (falls back to the built-in preset)', () => {
    const registry = new CharacterRegistry('no/such/dir')
    expect(registry.get('sahur')).toEqual(DEFAULT_SAHUR_PRESET)
  })

  test('register() adds a stub preset without touching kernel logic', () => {
    const registry = new CharacterRegistry('no/such/dir')
    const stub: CharacterPreset = {
      manifest: {
        id: 'stub',
        name: 'Stub',
        voice: { backend: 'tts-flash', voiceId: 'stub-voice' },
        model: { primary: 'src/kiosk/model/stub', spriteFallback: 'assets/character/sprites/stub' },
        actionMap: { remind: 'wave', escalate: 'wave' },
        escalationFlavor: 'waves harder'
      },
      bible: { identity: 'stub', voice: 'stub', comedy: 'stub', doDont: 'stub', lore: 'stub' }
    }
    registry.register('stub', stub)
    expect(registry.get('stub')).toEqual(stub)
  })

  test('get() caches a loaded preset (register() and get() share one cache)', () => {
    const registry = new CharacterRegistry('no/such/dir')
    const first = registry.get('sahur')
    const second = registry.get('sahur')
    expect(first).toBe(second)
  })

  test('lists the built-in default plus character bundles from disk', () => {
    const charactersDir = mkdtempSync(join(tmpdir(), 'sahurhub-characters-'))
    const dawnDir = join(charactersDir, 'dawn')
    mkdirSync(dawnDir)
    writeFileSync(
      join(dawnDir, 'character.json'),
      JSON.stringify({
        id: 'dawn',
        displayName: 'Dawn',
        voice: { backend: 'tts-flash', voiceId: 'dawn-voice' }
      })
    )
    writeFileSync(join(dawnDir, 'bible.md'), '## Identity\nDawn')

    try {
      expect(new CharacterRegistry(charactersDir).list()).toEqual([
        { id: 'dawn', displayName: 'Dawn' },
        { id: 'sahur', displayName: 'Sahur' }
      ])
    } finally {
      rmSync(charactersDir, { recursive: true, force: true })
    }
  })
})

describe('pickPokeLine', () => {
  test('exhausts the whole pool before repeating and never repeats back-to-back', () => {
    resetPokeLineState()
    const poolSize = 10
    const rounds = 3
    const seen: string[] = []
    for (let i = 0; i < poolSize * rounds; i += 1) seen.push(pickPokeLine(DEFAULT_SAHUR_PRESET))
    for (let round = 0; round < rounds; round += 1) {
      const slice = seen.slice(round * poolSize, (round + 1) * poolSize)
      expect(new Set(slice).size).toBe(poolSize)
    }
    for (let i = 1; i < seen.length; i += 1) expect(seen[i]).not.toBe(seen[i - 1])
  })
})
