import { Fragment } from 'react'
import { type MarkdownSegment, parseMarkdown } from '../lib/markdown.ts'

function InlineSegments({ segments }: { segments: MarkdownSegment[] }) {
  return segments.map((segment, index) => {
    const key = `${segment.type}-${index}`
    if (segment.type === 'bold') return <strong key={key}>{segment.text}</strong>
    if (segment.type === 'italic') return <em key={key}>{segment.text}</em>
    if (segment.type === 'code') return <code key={key}>{segment.text}</code>
    return <Fragment key={key}>{segment.text}</Fragment>
  })
}

export default function MarkdownContent({ text }: { text: string }) {
  return (
    <div className="message-content markdown-content">
      {parseMarkdown(text).blocks.map((block) => {
        const blockKey = JSON.stringify(block)
        if (block.type === 'list') {
          const List = block.ordered ? 'ol' : 'ul'
          return (
            <List key={blockKey}>
              {block.items.map((item) => (
                <li key={JSON.stringify(item)}>
                  <InlineSegments segments={item} />
                </li>
              ))}
            </List>
          )
        }

        return (
          <p key={blockKey}>
            <InlineSegments segments={block.segments} />
          </p>
        )
      })}
    </div>
  )
}
