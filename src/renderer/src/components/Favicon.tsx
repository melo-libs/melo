import './Favicon.scss'

/**
 * Favicon — deterministic colored circle with the host's first letter.
 * A real product would fetch /favicon.ico; this renders offline.
 * `tone="muted"` is a quiet gray outline (sidebar); `tone="color"` is the
 * deterministic colored version (Properties drawer, share card).
 */
export interface FaviconProps {
  host?: string
  size?: number
  tone?: 'muted' | 'color'
}

export const Favicon = ({ host, size = 12, tone = 'muted' }: FaviconProps) => {
  if (!host) return null
  const letter = host
    .replace(/^www\./, '')
    .charAt(0)
    .toUpperCase()

  if (tone === 'color') {
    const hue = [...host].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)
    return (
      <span
        className="favicon favicon-color"
        style={{
          width: size,
          height: size,
          background: `oklch(0.7 0.12 ${hue})`,
          fontSize: Math.round(size * 0.7),
        }}
        title={host}
      >
        {letter}
      </span>
    )
  }

  return (
    <span
      className="favicon favicon-muted"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.72) }}
      title={host}
    >
      {letter}
    </span>
  )
}
