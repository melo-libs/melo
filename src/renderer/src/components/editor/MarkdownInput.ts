import { Extension, InputRule, wrappingInputRule, type Editor } from '@tiptap/core'
import type { NodeType } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
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
        find: /(!?)\[([^[\]]*)\]\(((?:[^()\s]|\([^()\s]*\))+)\)$/,
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
})
