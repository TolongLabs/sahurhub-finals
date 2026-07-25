import { describe, expect, test } from 'bun:test'
import { parseMarkdown } from './markdown.ts'

describe('parseMarkdown', () => {
  test('parses bold text', () => {
    expect(parseMarkdown('**Sahur**').blocks).toEqual([
      { type: 'paragraph', segments: [{ type: 'bold', text: 'Sahur' }] }
    ])
  })

  test('parses italic text', () => {
    expect(parseMarkdown('*steady*').blocks).toEqual([
      { type: 'paragraph', segments: [{ type: 'italic', text: 'steady' }] }
    ])
  })

  test('parses unordered and ordered lists', () => {
    expect(parseMarkdown('- first\n* second\n\n1. one\n2. two').blocks).toEqual([
      {
        type: 'list',
        ordered: false,
        items: [[{ type: 'text', text: 'first' }], [{ type: 'text', text: 'second' }]]
      },
      {
        type: 'list',
        ordered: true,
        items: [[{ type: 'text', text: 'one' }], [{ type: 'text', text: 'two' }]]
      }
    ])
  })

  test('parses inline code', () => {
    expect(parseMarkdown('Say `sahur` now').blocks).toEqual([
      {
        type: 'paragraph',
        segments: [
          { type: 'text', text: 'Say ' },
          { type: 'code', text: 'sahur' },
          { type: 'text', text: ' now' }
        ]
      }
    ])
  })

  test('keeps junk input as text instead of HTML', () => {
    expect(parseMarkdown('<img src=x onerror=alert(1)> **unfinished').blocks).toEqual([
      {
        type: 'paragraph',
        segments: [{ type: 'text', text: '<img src=x onerror=alert(1)> **unfinished' }]
      }
    ])
  })
})
