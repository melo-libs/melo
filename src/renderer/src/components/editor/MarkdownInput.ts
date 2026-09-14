import {
  Extension,
  InputRule,
  wrappingInputRule,
  type Editor,
  type JSONContent,
} from '@tiptap/core'
import { Slice, type NodeType } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { safeExternalUrl } from '../../lib/url'

/* ============================================================
   Markdown typing support beyond the built-in input rules:
   [text](url) → link, ![alt](url) → image, and a `| a | b |` + Enter
   table row conversion. The official markdown extension is a file
   serializer only — it ships none of these (verified against 3.28).
   ============================================================ */

/** `| a | b |` + Enter → table. One header row from the typed cells plus an
 *  empty body row, caret in the first body cell. A single row is enough to
 *  trigger deliberately: demanding markdown's `|---|` delimiter line would
 *  mean typing a second raw-syntax line with no feedback (the Typora
 *  complaint). Undo restores the literal text in one step. */
function convertTableRow(editor: Editor): boolean {
  const { state } = editor
  const { $from, empty } = state.selection
  if (!empty) return false
  const parent = $from.parent
  if ($from.depth !== 1 || parent.type.name !== 'paragraph') return false
  if ($from.parentOffset !== parent.content.size) return false

  const m = /^\s*\|(.+)\|\s*$/.exec(parent.textContent)
  if (!m) return false
  // Split on unescaped pipes only; `\|` stays a literal pipe in the cell.
  // Cell text goes into the table verbatim — GFM has no notion of inline
  // delimiter syntax inside a header row, so nothing gets stripped.
  const cells = m[1].split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim())
  if (cells.length < 2) return false
  if (cells.every((c) => !c)) return false
  // A pure delimiter row (`|---|---|`, `|-|-|`) is not a header — skip.
  if (cells.every((c) => /^[-:]+$/.test(c))) return false

  const nodes = state.schema.nodes as Record<string, NodeType | undefined>
  const { table, tableRow, tableHeader, tableCell, paragraph } = nodes
  if (!table || !tableRow || !tableHeader || !tableCell || !paragraph) return false

  const headerRow = tableRow.create(
    null,
    cells.map((c) =>
      tableHeader.create(null, paragraph.create(null, c ? state.schema.text(c) : undefined)),
    ),
  )
  const bodyRow = tableRow.create(
    null,
    cells.map(() => tableCell.create(null, paragraph.create())),
  )

  const start = $from.before(1)
  const tr = state.tr.replaceWith(start, $from.after(1), table.create(null, [headerRow, bodyRow]))
  // start +1 enters the table, +headerRow skips it, +1 +1 +1 walks into
  // row → cell → paragraph of the first body cell.
  tr.setSelection(TextSelection.near(tr.doc.resolve(start + headerRow.nodeSize + 4)))
  editor.view.dispatch(tr.scrollIntoView())
  return true
}

/** Clipboard HTML that carries real document structure. Copies from
 *  browsers, VS Code, terminals — and TextEdit, whose RTF flavor wraps
 *  every line in a bare <p> — are still plain text in markup clothing.
 *  Only semantic tags (headings, lists, links, emphasis…) mean genuine
 *  rich content that should keep the default HTML path; paragraphs and
 *  styling wrappers alone don't qualify. */
const STRUCTURED_RICH_HTML = /<(?:h[1-6]|ul|ol|li|table|thead|tbody|tr|td|th|blockquote|img)\b/i
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
function markdownSlice(editor: Editor, text: string): Slice | null {
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

/** Serialize a copied Slice to markdown, or null to let the core fall
 *  back to plain textBetween. An inline-only fragment (selection within
 *  one textblock) is wrapped in a paragraph for the serializer; block
 *  fragments serialize as-is. */
function sliceToMarkdown(editor: Editor, slice: Slice): string | null {
  try {
    const manager = editor.storage.markdown?.manager
    if (!manager) return null
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
  } catch {
    return null
  }
}

export const MarkdownInput = Extension.create({
  name: 'markdownInput',
  // Above the default 100 so our Enter handler runs before StarterKit's
  // paragraph split.
  priority: 1000,

  addInputRules() {
    return [
      // GFM's second ordered-list marker: `1)` — the built-in rule only
      // recognizes `1.`.
      wrappingInputRule({
        find: /^(\d+)\)\s$/,
        type: this.editor.schema.nodes.orderedList,
        getAttributes: (match) => ({ start: +match[1] }),
      }),
      // One rule for both syntaxes — the optional leading `!` decides
      // between image and link, and keeps the two patterns from racing.
      new InputRule({
        // URL part allows one level of balanced parens (CommonMark), so
        // wiki-style links like …/Function_(mathematics) convert too.
        find: /(!?)\[([^\[\]]*)\]\(((?:[^()\s]|\([^()\s]*\))+)\)$/,
        handler: ({ state, range, match }) => {
          const [, bang, text, rawUrl] = match
          const url = safeExternalUrl(rawUrl)
          if (!url) return
          if (bang) {
            // Images: remote http(s) sources only — a mailto: image is
            // nonsense and local paths come in via drag/paste, not typing.
            if (!/^https?:/.test(url)) return
            const image = state.schema.nodes.image
            if (!image) return
            state.tr.replaceWith(range.from, range.to, image.create({ src: url, alt: text }))
          } else {
            if (!text) return
            const link = state.schema.marks.link
            if (!link) return
            state.tr
              .insertText(text, range.from, range.to)
              .addMark(range.from, range.from + text.length, link.create({ href: url }))
              .removeStoredMark(link)
          }
        },
      }),
    ]
  },

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => convertTableRow(editor),
    }
  },

  addProseMirrorPlugins() {
    const { editor } = this
    // Shift state for handlePaste — the core consults its own tracker only
    // on the clipboardTextParser path (as `plain`), not in handlePaste.
    let shiftDown = false
    return [
      new Plugin({
        key: new PluginKey('markdownPaste'),
        props: {
          handleDOMEvents: {
            keydown: (_view, event) => {
              shiftDown = event.shiftKey
              return false
            },
            keyup: (_view, event) => {
              shiftDown = event.shiftKey
              return false
            },
          },
          // Paste model (mirrors Obsidian and tiptap-markdown): the
          // document IS markdown, so plain clipboard text is parsed as
          // markdown — no "does it look like markdown" guessing.
          //
          // clipboardTextParser is ProseMirror's own hook for text pastes;
          // the core already routes here only when appropriate (no HTML
          // flavor on the clipboard), handles code blocks literally before
          // us, and sets `plain` on Shift+⌘V so literal paste is native.
          // Copy/cut: the text/plain clipboard slot carries markdown while
          // the core keeps writing text/html — one copy serves both rich
          // targets (Word, Notion) and plain ones (code editors, chat).
          // The core falls back to textBetween on a falsy return.
          clipboardTextSerializer: (slice) => {
            return sliceToMarkdown(editor, slice) as string
          },
          // Drag-drop of external text still goes through the core's text
          // path — parse it as markdown there too. (Paste never reaches
          // this: handlePaste below intercepts it first.)
          clipboardTextParser: (text, _$context, plain) => {
            // The prop's type says Slice, but the core explicitly falls
            // back to the default text paste on a falsy return (`if
            // (parsed)` in parseFromClipboard) — same contract
            // tiptap-markdown relies on.
            const slice = plain ? null : markdownSlice(editor, text)
            return slice as Slice
          },
          // All markdown-text pastes are handled here because insertion
          // needs control the clipboardTextParser hook can't give:
          // replaceRange's fitting treats slice depths as hints and merges
          // a leading heading/list's text into the paragraph at the caret.
          // Genuinely rich HTML (semantic tags) falls through to the
          // default path; Shift+paste and code blocks stay literal.
          handlePaste: (view, event) => {
            if (shiftDown) return false
            const data = event.clipboardData
            if (!data) return false
            const html = data.getData('text/html')
            const text = data.getData('text/plain')
            if (!text) return false
            if (html && shouldUseRichClipboardHtml(html, text)) return false
            if (view.state.selection.$from.parent.type.spec.code) return false
            const slice = markdownSlice(editor, text)
            if (!slice) return false

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
              blockLeading &&
              $pos.depth === 1 &&
              $pos.parent.isTextblock &&
              $pos.parent.content.size > 0
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
            return true
          },
        },
      }),
    ]
  },
})
