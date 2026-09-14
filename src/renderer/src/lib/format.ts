/** Human file size — B/KB/MB/GB, one decimal above KB. */
export const formatSize = (n: number): string => {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

/** Frontmatter date values are machine truth (full ISO instants) — the
 *  UI always shows them as a localized calendar date. Unparseable input
 *  falls back to the raw string rather than 'Invalid Date'. */
export const formatFrontmatterDate = (raw: string, locale: string): string => {
  const t = Date.parse(raw)
  if (!Number.isFinite(t)) return raw
  return new Date(t).toLocaleDateString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}
