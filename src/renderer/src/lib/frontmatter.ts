/* ============================================================
   YAML frontmatter splitting. The frontmatter block (delimiters plus
   trailing blank lines) is kept verbatim so saving can re-prepend it;
   the editor only ever sees the body.
   ============================================================ */

const DELIMITER = /^---\s*$/

/** Split leading YAML frontmatter from a markdown document. A frontmatter
 *  block starts with a `---` line at the very top and ends at the next
 *  line that is exactly `---` — full-line matches only, so `---` sequences
 *  embedded in body text or inside frontmatter values don't end the block
 *  early (the old indexOf('\n---') scan did). */
export function splitFrontmatter(raw: string): { frontmatter: string; body: string } {
  if (!raw.startsWith('---')) return { frontmatter: '', body: raw }
  const firstLineEnd = raw.indexOf('\n')
  if (firstLineEnd === -1) return { frontmatter: '', body: raw }
  if (!DELIMITER.test(raw.slice(0, firstLineEnd).replace(/\r$/, ''))) {
    return { frontmatter: '', body: raw }
  }

  let i = firstLineEnd + 1
  while (i <= raw.length) {
    const lineEnd = raw.indexOf('\n', i)
    const line = (lineEnd === -1 ? raw.slice(i) : raw.slice(i, lineEnd)).replace(/\r$/, '')
    if (DELIMITER.test(line)) {
      const afterClose = lineEnd === -1 ? raw.length : lineEnd + 1
      let bodyStart = afterClose
      while (bodyStart < raw.length && (raw[bodyStart] === '\n' || raw[bodyStart] === '\r')) {
        bodyStart++
      }
      return { frontmatter: raw.slice(0, bodyStart), body: raw.slice(bodyStart) }
    }
    if (lineEnd === -1) break
    i = lineEnd + 1
  }
  // No closing delimiter — not frontmatter.
  return { frontmatter: '', body: raw }
}
