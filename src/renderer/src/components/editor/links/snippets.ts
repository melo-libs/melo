/* ============================================================
   Snippet HTML for the backlinks panel: plain-text/markdown
   context from the main process becomes safe HTML with [[..]]
   rendered as wikilink chips and the note's own name marked.
   ============================================================ */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** [[Target]] / [[Target|alias]] → wikilink anchors; targets matching any
 *  `highlights` entry get the bl-hl mark so the reference pops. Runs on
 *  escaped text, so bracket forms are matched literally. */
export function wikilinkSnippetHtml(context: string, highlights: string[]): string {
  const esc = escapeHtml(context)
  const hl = new Set(highlights.map((h) => h.trim().toLowerCase()).filter(Boolean))
  return esc.replace(
    /\[\[([^\][|#\n]+)(?:\|([^\][\n]+))?\]\]/g,
    (_m, target: string, alias?: string) => {
      const t = target.trim()
      const label = (alias ?? t).trim()
      const anchor = `<a class="wikilink" data-note="${t.replace(/"/g, '&quot;')}" tabindex="0"><span class="wl-bracket">⟦</span>${label}<span class="wl-bracket">⟧</span></a>`
      return hl.has(t.toLowerCase()) ? `<mark class="bl-hl">${anchor}</mark>` : anchor
    },
  )
}

/** Plain-text mention context: the mentioned name gets the bl-hl mark. */
export function mentionSnippetHtml(context: string, mention: string): string {
  const esc = escapeHtml(context)
  const re = new RegExp(escapeRegex(escapeHtml(mention)).replace(/\s+/g, '\\s+'), 'i')
  return esc.replace(re, (m) => `<mark class="bl-hl">${m}</mark>`)
}
