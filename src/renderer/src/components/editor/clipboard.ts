import type { JSONContent, TextSerializer } from '@tiptap/core'
import type { MarkdownManager } from '@tiptap/markdown'
import { getListMarker } from '@tiptap/extension-list/ordered-list'
import type { Node as PMNode, ResolvedPos, Slice } from '@tiptap/pm/model'

export function hasProseMirrorSlice(html: string): boolean {
  return /<[a-z][^>]*\sdata-pm-slice\s*=/i.test(html)
}

/** A bitmap can be an alternative rendering of an entire HTML table or selection. */
export function shouldPreferClipboardHtml(html: string, slice: Slice): boolean {
  if (!html) return false
  if (hasProseMirrorSlice(html)) return true
  let images = 0
  let otherContent = false
  slice.content.descendants((node) => {
    if (node.type.name === 'image') images++
    else if (node.isText) otherContent ||= Boolean(node.text?.trim())
    else if (node.type.name !== 'paragraph' && node.type.name !== 'hardBreak') otherContent = true
    return !otherContent
  })
  return otherContent || images > 1
}

export function isSingleImageSlice(slice: Slice): boolean {
  let images = 0
  let otherContent = false
  slice.content.descendants((node) => {
    if (node.type.name === 'image') images++
    else if (node.isText) otherContent ||= Boolean(node.text?.trim())
    else if (node.isLeaf && node.type.name !== 'hardBreak') otherContent = true
    return !otherContent
  })
  return images === 1 && !otherContent
}

export const GENERIC_CLIPBOARD_NODES = new Set([
  'doc',
  'text',
  'paragraph',
  'heading',
  'blockquote',
  'codeBlock',
  'bulletList',
  'orderedList',
  'listItem',
  'taskList',
  'taskItem',
  'table',
  'tableRow',
  'tableCell',
  'tableHeader',
  'horizontalRule',
  'hardBreak',
])

/** The Slice already excludes unselected text; block structure needs its own text form. */
export function sliceToPlainText(slice: Slice, from?: ResolvedPos): string {
  const partialStart = Boolean(from?.parent.isTextblock && from.parentOffset > 0)
  const listOffsets: number[] = []
  if (from) {
    for (let depth = 1; depth <= from.depth; depth++) {
      if (from.node(depth).type.name === 'orderedList') listOffsets.push(from.index(depth))
    }
  }
  const root = slice.content.firstChild?.type.schema.topNodeType.create(null, slice.content)
  if (!root) return ''
  const range = { from: 0, to: root.content.size }
  const render = (
    node: PMNode,
    first: boolean,
    pos: number,
    parent: PMNode,
    index: number,
  ): string => {
    if (node.isText) return node.text ?? ''
    if (node.isLeaf || !GENERIC_CLIPBOARD_NODES.has(node.type.name)) {
      const toText = node.type.spec.toText as TextSerializer | undefined
      return toText?.({ node, pos, parent, index, range }) ?? ''
    }
    const children: string[] = []
    node.forEach((child, offset, index) =>
      children.push(render(child, first && index === 0, pos + 1 + offset, node, index)),
    )
    switch (node.type.name) {
      case 'table':
        return children.join('\n')
      case 'tableRow':
        return children.join('\t')
      case 'bulletList':
      case 'orderedList':
      case 'taskList': {
        const offset = first && node.type.name === 'orderedList' ? (listOffsets.pop() ?? 0) : 0
        return children
          .map((text, index) => {
            const item = node.child(index)
            // Open list items can contain only their nested list: the parent
            // paragraph/marker belongs to the unselected Slice context.
            if (
              first &&
              index === 0 &&
              slice.openStart > 0 &&
              item.firstChild?.type.name !== 'paragraph'
            )
              return text
            const marker =
              node.type.name === 'orderedList'
                ? getListMarker(
                    node.attrs.type as string | null,
                    Number(node.attrs.start ?? 1) + offset + index - 1,
                  )
                : node.type.name === 'taskList'
                  ? item.attrs.checked
                    ? '☑ '
                    : '☐ '
                  : '• '
            const lines = text.split('\n')
            return lines
              .map((line, lineIndex) => {
                if (lineIndex > 0) return `  ${line}`
                return first && index === 0 && partialStart ? line : marker + line
              })
              .join('\n')
          })
          .join('\n')
      }
      case 'paragraph':
      case 'heading':
      case 'codeBlock':
        return children.join('')
      case 'listItem':
      case 'taskItem':
        return children.join('\n')
      default:
        return children.join('\n\n')
    }
  }
  const parts: string[] = []
  root.forEach((node, offset, index) => parts.push(render(node, index === 0, offset, root, index)))
  const inline = slice.content.firstChild?.isInline
  const rows = slice.content.firstChild?.type.name === 'tableRow'
  return parts.join(inline ? '' : rows ? '\n' : '\n\n')
}

/** Inline fragments and partial table rows need their document containers for Markdown. */
export function sliceToMarkdown(manager: MarkdownManager, slice: Slice): string | null {
  let content = slice.content.toJSON() as JSONContent[] | null
  if (!content?.length) return null
  const inlineOnly = slice.content.firstChild?.isInline ?? false
  if (!inlineOnly) {
    // Consecutive empty paragraphs serialize as &nbsp; placeholders —
    // our own file round-trip convention, meaningless to other apps.
    // Clipboard markdown follows standard semantics instead: blank
    // runs collapse, trailing blanks go.
    const isEmptyParagraph = (n: JSONContent) => n.type === 'paragraph' && !n.content?.length
    content = content.filter(
      (n, i, arr) => !(isEmptyParagraph(n) && (i === 0 || isEmptyParagraph(arr[i - 1]))),
    )
    while (content.length && isEmptyParagraph(content[content.length - 1])) content.pop()
    if (!content.length) return null
    // A partial table selection (CellSelection) copies bare tableRow
    // nodes; the serializer only knows whole tables — wrap them back.
    if (content.every((n) => n.type === 'tableRow')) {
      content = [{ type: 'table', content }]
    }
  }
  const json = inlineOnly
    ? { type: 'doc', content: [{ type: 'paragraph', content }] }
    : { type: 'doc', content }
  const md = manager.serialize(json)
  return md ? md.replace(/\n+$/, '') : null
}
