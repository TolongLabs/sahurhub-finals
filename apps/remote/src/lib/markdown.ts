export type MarkdownSegment =
  | { type: 'text'; text: string }
  | { type: 'bold'; text: string }
  | { type: 'italic'; text: string }
  | { type: 'code'; text: string }

export type MarkdownBlock =
  | { type: 'paragraph'; segments: MarkdownSegment[] }
  | { type: 'list'; ordered: boolean; items: MarkdownSegment[][] }

export function parseMarkdown(text: string): { blocks: MarkdownBlock[] } {
  const blocks: MarkdownBlock[] = []
  const lines = text.split(/\r?\n/)
  let paragraph: string[] = []
  let list: { ordered: boolean; items: MarkdownSegment[][] } | null = null

  function flushParagraph() {
    if (paragraph.length === 0) return
    blocks.push({ type: 'paragraph', segments: parseInline(paragraph.join('\n')) })
    paragraph = []
  }

  function flushList() {
    if (!list) return
    blocks.push({ type: 'list', ...list })
    list = null
  }

  for (const line of lines) {
    const match = line.match(/^\s*(([-*])|(\d+)\.)\s+(.+)$/)
    if (match) {
      flushParagraph()
      const ordered = Boolean(match[3])
      if (!list || list.ordered !== ordered) {
        flushList()
        list = { ordered, items: [] }
      }
      list.items.push(parseInline(match[4] ?? ''))
      continue
    }

    flushList()
    if (!line.trim()) {
      flushParagraph()
      continue
    }
    paragraph.push(line)
  }

  flushParagraph()
  flushList()
  return { blocks }
}

function parseInline(text: string): MarkdownSegment[] {
  const segments: MarkdownSegment[] = []
  const matcher = /(`[^`]*`|\*\*[^*]+\*\*|\*[^*]+\*)/g
  let cursor = 0

  for (const match of text.matchAll(matcher)) {
    const index = match.index ?? 0
    if (index > cursor) segments.push({ type: 'text', text: text.slice(cursor, index) })

    const token = match[0]
    if (token.startsWith('`')) segments.push({ type: 'code', text: token.slice(1, -1) })
    else if (token.startsWith('**')) segments.push({ type: 'bold', text: token.slice(2, -2) })
    else segments.push({ type: 'italic', text: token.slice(1, -1) })
    cursor = index + token.length
  }

  if (cursor < text.length) segments.push({ type: 'text', text: text.slice(cursor) })
  return segments.length > 0 ? segments : [{ type: 'text', text }]
}
