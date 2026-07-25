import { describe, expect, test } from 'bun:test'
import { extractJson } from './json-extract.ts'

describe('extractJson', () => {
  test('parses a clean JSON object directly', () => {
    expect(extractJson('{"title":"Wake-up plans"}')).toEqual({ title: 'Wake-up plans' })
  })

  test('strips a <think>...</think> block before parsing', () => {
    const content = '<think>let me consider titles</think>{"title":"Morning tasks"}'
    expect(extractJson(content)).toEqual({ title: 'Morning tasks' })
  })

  test('strips a <reasoning>...</reasoning> block before parsing', () => {
    const content = '<reasoning>thinking...</reasoning>{"title":"Evening plans"}'
    expect(extractJson(content)).toEqual({ title: 'Evening plans' })
  })

  test('strips a markdown ```json fence', () => {
    const content = '```json\n{"title":"Fenced"}\n```'
    expect(extractJson(content)).toEqual({ title: 'Fenced' })
  })

  test('falls back to a balanced-brace scan when there is trailing prose', () => {
    const content = 'Sure, here you go: {"title":"Balanced"} — hope that helps!'
    expect(extractJson(content)).toEqual({ title: 'Balanced' })
  })

  test('balanced-brace scan respects braces inside string values', () => {
    const content = 'noise {"title":"has a } brace inside"} trailing'
    expect(extractJson(content)).toEqual({ title: 'has a } brace inside' })
  })

  test('throws when no valid JSON object exists anywhere', () => {
    expect(() => extractJson('just some prose, no braces at all')).toThrow('no valid JSON object found')
  })
})
