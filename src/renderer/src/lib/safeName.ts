/** Squash anything that can't live in a filename into a safe basename. */
export function safeName(raw: string): string {
  return (
    raw
      .replace(/[/\\:*?"<>|]/g, ' ')
      .replace(/\.{2,}/g, '.')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120) || ''
  )
}
