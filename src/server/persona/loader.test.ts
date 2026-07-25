import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_SAHUR_PRESET } from './default-sahur.ts'
import { loadCharacter } from './loader.ts'

describe('loadCharacter', () => {
  test('falls back to the built-in default Sahur preset when no bundle exists yet', () => {
    const missingDir = join(tmpdir(), 'sahurhub-no-such-characters-dir')
    expect(loadCharacter('sahur', missingDir)).toEqual(DEFAULT_SAHUR_PRESET)
  })

  test('throws for an unknown non-sahur character with no bundle', () => {
    const missingDir = join(tmpdir(), 'sahurhub-no-such-characters-dir')
    expect(() => loadCharacter('nonexistent', missingDir)).toThrow(/unknown character/)
  })

  test('loads a real bundle (character.json + bible.md) and parses the bible sections', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sahurhub-characters-'))
    const charDir = join(dir, 'sahur')
    try {
      mkdirSync(charDir, { recursive: true })
      writeFileSync(
        join(charDir, 'character.json'),
        JSON.stringify({
          id: 'sahur',
          name: 'Sahur',
          voice: { backend: 'tts-flash', voiceId: 'v1' },
          model: { primary: 'src/kiosk/model/sahur', spriteFallback: 'assets/character/sprites/sahur' },
          actionMap: { remind: 'tung', escalate: 'tung' },
          escalationFlavor: 'louder each tier'
        })
      )
      writeFileSync(
        join(charDir, 'bible.md'),
        [
          '## Identity',
          'A wooden log with a baton.',
          '',
          '## Voice & speech patterns',
          'Warm but relentless.',
          '',
          '## Comedy engine',
          'Confidently wrong.',
          '',
          "## Do's and Don'ts",
          'Never political.',
          '',
          '## Lore',
          'Exists to remind you.'
        ].join('\n')
      )

      const preset = loadCharacter('sahur', dir)
      expect(preset.manifest.id).toBe('sahur')
      expect(preset.manifest.actionMap.remind).toBe('tung')
      expect(preset.bible.identity).toBe('A wooden log with a baton.')
      expect(preset.bible.voice).toBe('Warm but relentless.')
      expect(preset.bible.comedy).toBe('Confidently wrong.')
      expect(preset.bible.doDont).toBe('Never political.')
      expect(preset.bible.lore).toBe('Exists to remind you.')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('tolerates the real character.json shape (displayName/model.renderer/top-level spriteFallback/actions.*.animation/array escalationFlavor)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sahurhub-characters-real-shape-'))
    const charDir = join(dir, 'sahur')
    try {
      mkdirSync(charDir, { recursive: true })
      writeFileSync(
        join(charDir, 'character.json'),
        JSON.stringify({
          id: 'sahur',
          displayName: 'Sahur',
          voice: { backend: 'tts-flash', voiceId: 'ethan' },
          model: { renderer: 'src/kiosk/model' },
          spriteFallback: 'assets/character/manifest.json',
          actions: { remind: { animation: 'knock', tiers: 3 }, escalate: { animation: 'postureShift', tiers: 3 } },
          escalationFlavor: ['gentle', 'direct', 'blunt']
        })
      )
      writeFileSync(join(charDir, 'bible.md'), ['## Identity', 'A wooden log.', '', '## Lore', 'Knocks.'].join('\n'))

      const preset = loadCharacter('sahur', dir)
      expect(preset.manifest.name).toBe('Sahur')
      expect(preset.manifest.model.primary).toBe('src/kiosk/model')
      expect(preset.manifest.model.spriteFallback).toBe('assets/character/manifest.json')
      expect(preset.manifest.actionMap).toEqual({ remind: 'knock', escalate: 'postureShift' })
      expect(preset.manifest.escalationFlavor).toBe('gentle -> direct -> blunt')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('loads the actual committed characters/sahur/ bundle from the repo root', () => {
    const preset = loadCharacter('sahur', 'characters')
    expect(preset.manifest.id).toBe('sahur')
    expect(preset.manifest.name).toBe('Sahur')
    expect(preset.manifest.actionMap).toEqual({ remind: 'knock', escalate: 'postureShift' })
    expect(preset.bible.identity.length).toBeGreaterThan(0)
    expect(preset.bible.lore.length).toBeGreaterThan(0)
  })
})
