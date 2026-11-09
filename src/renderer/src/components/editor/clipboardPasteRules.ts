import type { Editor } from '@tiptap/core'
import { Slice } from '@tiptap/pm/model'
import { Selection, TextSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { dropPoint } from '@tiptap/pm/transform'
import { hasProseMirrorSlice, isSingleImageSlice, shouldPreferClipboardHtml } from './clipboard'

/** Paragraphs and semantic structure make HTML authoritative. Styling-only
 *  terminal wrappers may still contain Markdown source. */
const STRUCTURED_RICH_HTML =
  /<(?:p|pre|h[1-6]|ul|ol|li|table|thead|tbody|tr|td|th|blockquote|img)\b/i
const INLINE_RICH_HTML = /<(?:a|strong|em|mark|code|b|i|u|s)\b/i

/** Markdown source copied from a terminal often arrives with an HTML flavor:
 *  ANSI styling becomes spans and detected URLs become anchors. An anchor
 *  alone must not make us treat the whole clipboard as rendered rich text,
 *  otherwise one URL near the end prevents every heading/list/quote above it
 *  from being parsed. Rendered browser content normally has no literal block
 *  markers in its text flavor, so explicit Markdown syntax is the reliable
 *  tie-breaker. */
const MARKDOWN_SOURCE_LINE =
  /^(?: {0,3}#{1,6}\s| {0,3}>| {0,3}(?:[-+*]|\d+[.)])\s| {0,3}(?:```|~~~)| {0,3}\|.*\|| {0,3}(?:-{3,}|\*{3,}|_{3,})\s*$)/

export function shouldUseRichClipboardHtml(html: string, text: string): boolean {
  // A real block structure is authoritative even when one of its text lines
  // happens to resemble Markdown source (for example a list item beginning
  // with a literal dash). The tie-breaker is only for inline-enriched terminal
  // HTML, most notably auto-linked URLs.
  if (STRUCTURED_RICH_HTML.test(html)) return true
  if (!INLINE_RICH_HTML.test(html)) return false
  const hasMarkdownSource = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .some((line) => MARKDOWN_SOURCE_LINE.test(line))
  return !hasMarkdownSource
}

/** A run of em dashes is commonly emitted as a visual divider by terminal
 *  tools, but is not Markdown syntax. Keep this one narrow compatibility
 *  conversion; other terminal formatting remains literal text. */
export function normalizePastedMarkdown(text: string): string {
  let openFence: { marker: '`' | '~'; length: number } | null = null

  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => {
      const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
      if (fence) {
        const marker = fence[1][0] as '`' | '~'
        if (!openFence) {
          openFence = { marker, length: fence[1].length }
        } else if (
          marker === openFence.marker &&
          fence[1].length >= openFence.length &&
          fence[2].trim() === ''
        ) {
          openFence = null
        }
        return line
      }
      if (openFence) return line

      // Four-space and tab-indented lines are code, not visual dividers.
      const divider = /^( {0,3})—{3,}\s*$/u.exec(line)
      return divider ? `${divider[1]}---` : line
    })
    .join('\n')
}

/** A line that starts (or is) a markdown block construct — heading, list
 *  item, quote, fence, table row, hr — or is blank. Used to decide where
 *  hard breaks may be inserted without disturbing block syntax. */
const BLOCK_LINE =
  /^(?:\s*$|#{1,6}\s|\s*(?:[-+*]|\d+[.)])\s|\s*>|\s*(?:```|~~~)|\s*\||(?:-{3,}|\*{3,}|_{3,})\s*$)/

/** Markdown's soft-wrap rule merges single-newline prose lines into one
 *  paragraph — pasting a poem or an address would collapse it. Append
 *  hard-break markers (two trailing spaces) between consecutive prose
 *  lines so line structure survives, matching Obsidian's default
 *  rendering. Fenced code and block constructs are left untouched. */
function preserveLineBreaks(text: string): string {
  const lines = text.split('\n')
  let inFence = false
  return lines
    .map((line, i) => {
      if (/^\s*(?:```|~~~)/.test(line)) {
        inFence = !inFence
        return line
      }
      if (inFence) return line
      const next = lines[i + 1]
      if (next === undefined) return line
      if (BLOCK_LINE.test(line) || BLOCK_LINE.test(next)) return line
      if (/(?:\s{2,}|\\)$/.test(line)) return line
      return line + '  '
    })
    .join('\n')
}

/** Parse clipboard text as markdown into a paste-ready Slice, or null when
 *  it can't be parsed (caller falls back to the default literal paste).
 *  maxOpen boundaries — same shape ProseMirror's own HTML paste produces —
 *  so replaceSelection merges edges naturally: a lone paragraph pastes
 *  inline mid-sentence, a leading heading doesn't bleed into the paragraph
 *  the caret sits in. */
export function markdownSlice(editor: Editor, text: string): Slice | null {
  try {
    if (!editor.markdown) return null
    const json = editor.markdown.parse(preserveLineBreaks(normalizePastedMarkdown(text)))
    const doc = editor.schema.nodeFromJSON(json)
    if (doc.childCount === 0) return null
    // Open boundaries only when the edge node is a paragraph: a pasted
    // sentence merges into the line at the caret, but a leading heading /
    // list / table keeps its block identity instead of bleeding its text
    // into the surrounding paragraph (maxOpen alone reproduces rich-HTML
    // paste semantics, which are wrong for markdown source).
    const max = Slice.maxOpen(doc.content)
    const openStart = doc.firstChild?.type.name === 'paragraph' ? max.openStart : 0
    const openEnd = doc.lastChild?.type.name === 'paragraph' ? max.openEnd : 0
    return new Slice(doc.content, openStart, openEnd)
  } catch {
    // Clipboard text is untrusted input — if the parser chokes, paste
    // must still work, just without markdown interpretation.
    return null
  }
}

export type ClipboardPasteAction = 'native' | 'files' | 'embedded-images' | 'markdown'

function hasEmbeddedImages(slice: Slice): boolean {
  let found = false
  slice.content.descendants((node) => {
    if (node.type.name === 'image' && /^data:image\//i.test(node.attrs.src as string)) found = true
    return !found
  })
  return found
}

export function chooseClipboardPaste(
  input: { html: string; text: string; hasImageFiles: boolean; plain: boolean; inCode: boolean },
  slice: Slice,
): ClipboardPasteAction {
  if (input.plain || input.inCode) return 'native'
  if (hasEmbeddedImages(slice)) return 'embedded-images'
  if (hasProseMirrorSlice(input.html)) return 'native'
  if (input.hasImageFiles) return shouldPreferClipboardHtml(input.html, slice) ? 'native' : 'files'
  if (
    input.html &&
    (shouldPreferClipboardHtml(input.html, slice) || isSingleImageSlice(slice)) &&
    shouldUseRichClipboardHtml(input.html, input.text)
  )
    return 'native'
  return input.text ? 'markdown' : 'native'
}

export function insertMarkdownPaste(view: EditorView, slice: Slice): void {
  const tr = view.state.tr
  // openStart 0 ⇔ the content leads with a block construct (see
  // markdownSlice). Pasting that into a non-empty top-level
  // textblock: split at the caret and insert the blocks between
  // the halves verbatim — replaceSelection would dissolve the
  // first block into the paragraph.
  const blockLeading = slice.openStart === 0
  tr.deleteSelection()
  const $pos = tr.selection.$from
  const midTextblock =
    blockLeading && $pos.depth === 1 && $pos.parent.isTextblock && $pos.parent.content.size > 0
  if (midTextblock) {
    let insertAt: number
    if ($pos.parentOffset === 0) {
      insertAt = $pos.before(1)
    } else if ($pos.parentOffset === $pos.parent.content.size) {
      insertAt = $pos.after(1)
    } else {
      tr.split(tr.selection.from)
      insertAt = tr.selection.$from.before(1)
    }
    tr.insert(insertAt, slice.content)
    tr.setSelection(TextSelection.near(tr.doc.resolve(insertAt + slice.content.size), -1))
  } else {
    tr.replaceSelection(slice)
  }
  view.dispatch(tr.scrollIntoView())
}

export function insertMarkdownDrop(view: EditorView, slice: Slice, pos: number): void {
  const tr = view.state.tr
  const at = dropPoint(tr.doc, pos, slice) ?? pos
  tr.replaceRange(at, at, slice)
  tr.setSelection(Selection.near(tr.doc.resolve(tr.mapping.map(at, 1)), -1))
  view.dispatch(tr.setMeta('uiEvent', 'drop').scrollIntoView())
}
