import { Fragment, useMemo, type ReactNode } from 'react'
import { MarkdownManager } from '@tiptap/markdown'
import { StarterKit } from '@tiptap/starter-kit'
import type { JSONContent } from '@tiptap/core'

const markdown = new MarkdownManager({ extensions: [StarterKit] })

// Release text is remote content. Only these passive elements are rendered;
// links, images and raw HTML cannot load resources or execute actions.
function renderNode(node: JSONContent, key: number): ReactNode {
  const children = node.content?.map(renderNode)
  if (node.type === 'text') {
    let text: ReactNode = node.text
    for (const mark of node.marks ?? []) {
      if (mark.type === 'bold') text = <strong>{text}</strong>
      else if (mark.type === 'italic') text = <em>{text}</em>
      else if (mark.type === 'code') text = <code>{text}</code>
    }
    return <Fragment key={key}>{text}</Fragment>
  }
  switch (node.type) {
    case 'heading':
      return <h2 key={key}>{children}</h2>
    case 'paragraph':
      return <p key={key}>{children}</p>
    case 'bulletList':
      return <ul key={key}>{children}</ul>
    case 'orderedList':
      return <ol key={key}>{children}</ol>
    case 'listItem':
      return <li key={key}>{children}</li>
    case 'hardBreak':
      return <br key={key} />
    case 'codeBlock':
      return (
        <pre key={key}>
          <code>{children}</code>
        </pre>
      )
    default:
      return <Fragment key={key}>{children}</Fragment>
  }
}

export function ReleaseNotes({ notes }: { notes: string }) {
  const content = useMemo(() => markdown.parse(notes.replace(/^• /gm, '- ')), [notes])
  return <>{content.content?.map(renderNode)}</>
}
