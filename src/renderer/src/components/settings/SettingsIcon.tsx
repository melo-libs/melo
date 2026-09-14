import type { JSX } from 'react'

/* Rail / pane icons — copied from the design's settings icon set
   (18-viewBox, 1.4 stroke). `capture` reuses the search palette's
   scissors glyph so clipping keeps one symbol across the app. */

const PATHS: Record<string, JSX.Element> = {
  general: (
    <>
      <circle cx="9" cy="9" r="2.4" />
      <path
        d="M9 1.8v1.8M9 14.4v1.8M16.2 9h-1.8M3.6 9H1.8M14.1 3.9l-1.27 1.27M5.17 12.83 3.9 14.1M14.1 14.1l-1.27-1.27M5.17 5.17 3.9 3.9"
        strokeLinecap="round"
      />
    </>
  ),
  appearance: (
    <>
      <path d="M9 2.2c3.8 0 6.8 2.7 6.8 6 0 2-1.7 3-3.3 3h-1.2c-1 0-1.7.8-1.7 1.6 0 .4.2.7.2 1.1 0 .8-.6 1.4-1.5 1.4A6.4 6.4 0 0 1 2.2 8.6C2.4 5 5.3 2.2 9 2.2Z" />
      <circle cx="6" cy="7.5" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="9" cy="5.5" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="12" cy="7.5" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  editor: <path d="M4 4.5h10M4 8h7M4 11.5h10M4 15h5" strokeLinecap="round" />,
  capture: (
    <>
      <circle cx="5" cy="5.5" r="2" />
      <circle cx="5" cy="12.5" r="2" />
      <path d="M6.7 6.6L15 13M6.7 11.4L15 5" strokeLinecap="round" />
    </>
  ),
  shortcuts: (
    <>
      <rect x="2.5" y="4.5" width="13" height="9" rx="1.8" />
      <path
        d="M5 7.2h.01M7.4 7.2h.01M9.8 7.2h.01M12.2 7.2h.01M5 9.6h.01M12.2 9.6h.01M6.6 11.6h4.8"
        strokeLinecap="round"
      />
    </>
  ),
  about: (
    <>
      <circle cx="9" cy="9" r="6.5" />
      <path d="M9 8.2v4M9 5.6v.5" strokeLinecap="round" />
    </>
  ),
  refresh: (
    <>
      <path d="M14.5 8a5.5 5.5 0 0 0-9.6-3.2M3.5 10a5.5 5.5 0 0 0 9.6 3.2" strokeLinecap="round" />
      <path d="M14.8 3.5v2.8h-2.8M3.2 14.5v-2.8h2.8" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  ext: (
    <path
      d="M11 3.5h3.5V7M14.5 3.5L8 10M12 9.5v3a1.5 1.5 0 0 1-1.5 1.5h-6A1.5 1.5 0 0 1 3 12.5v-6A1.5 1.5 0 0 1 4.5 5h3"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
}

export const SettingsIcon = ({ name, size = 16 }: { name: string; size?: number }) => {
  const p = PATHS[name]
  if (!p) return null
  return (
    <svg
      viewBox="0 0 18 18"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
    >
      {p}
    </svg>
  )
}
