import { Paragraph } from '@tiptap/extension-paragraph'
import type { JSONContent } from '@tiptap/core'

/* ============================================================
   Paragraph with round-trip-safe markdown serialization.

   @tiptap/markdown escapes inline tokens (*, [, ]) but not LINE-LEADING
   block tokens: a paragraph whose text is "## x" serializes verbatim and
   turns into a heading on the next load. WYSIWYG demands "reopen looks
   identical", so leading block tokens get backslash-escaped per line
   (hard breaks inside a paragraph start new lines that can also
   interrupt it).
   ============================================================ */

const EMPTY_PARAGRAPH_MARKDOWN = '&nbsp;'

/** Escape a line-leading block token so the line stays paragraph text.
 *  Backslash before the construct's first significant character is the
 *  CommonMark escape; for ordered lists the delimiter is the escapable
 *  part (`1\.`). Inline `*` is already escaped upstream. */
export function escapeLeadingBlockTokens(line: string): string {
  return (
    line
      // ATX heading: ## x
      .replace(/^(\s{0,3})(#{1,6})(\s|$)/, '$1\\$2$3')
      // thematic break / setext underline: ---, ___, ===
      .replace(/^(\s{0,3})((?:-{3,}|_{3,})\s*$|={1,}\s*$)/, '$1\\$2')
      // bullet: - x / + x
      .replace(/^(\s{0,3})([-+])(\s)/, '$1\\$2$3')
      // ordered: 1. x / 1) x
      .replace(/^(\s{0,3})(\d{1,9})([.)])(\s)/, '$1$2\\$3$4')
      // fence: ``` / ~~~
      .replace(/^(\s{0,3})(`{3,}|~{3,})/, '$1\\$2')
      // table row: | a |
      .replace(/^(\s{0,3})\|/, '$1\\|')
  )
}

export const ParagraphMarkdown = Paragraph.extend({
  renderMarkdown: (node, h, ctx) => {
    if (!node) return ''
    const content = Array.isArray(node.content) ? node.content : []
    if (content.length === 0) {
      // Mirror the base extension: consecutive empty paragraphs need a
      // placeholder or they collapse on reload.
      const prev = ctx?.previousNode as JSONContent | undefined
      const prevContent = Array.isArray(prev?.content) ? prev.content : []
      const prevIsEmptyParagraph = prev?.type === 'paragraph' && prevContent.length === 0
      return prevIsEmptyParagraph ? EMPTY_PARAGRAPH_MARKDOWN : ''
    }
    return h.renderChildren(content).split('\n').map(escapeLeadingBlockTokens).join('\n')
  },
})
