/* ============================================================
   Search palette icon set — ported verbatim from the design's
   corpus.jsx ICON_PATHS (18-viewBox, stroke). Self-contained so
   the palette renders 1:1 with the design.
   ============================================================ */

const PATHS: Record<string, string> = {
  search: '<circle cx="8" cy="8" r="4.5"/><path d="M11.5 11.5L14 14" stroke-linecap="round"/>',
  file: '<path d="M5 2.5h6l3.5 3.5v9.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-12a1 1 0 0 1 1-1Z"/><path d="M11 2.5v3.5a1 1 0 0 0 1 1h2.5"/>',
  md: '<path d="M5 2.5h6l3.5 3.5v9.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-12a1 1 0 0 1 1-1Z"/><path d="M11 2.5v3.5a1 1 0 0 0 1 1h2.5"/><path d="M6.4 12.4v-3l1.3 1.7 1.3-1.7v3M11.2 9.4v3M11.2 12.4l1.1-1.3M11.2 12.4l-1.1-1.3" stroke-width="1.1"/>',
  folder:
    '<path d="M2.5 5.5a2 2 0 0 1 2-2h3l2 2h5a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-10a2 2 0 0 1-2-2v-7Z"/>',
  pdf: '<path d="M5 2.5h6l3.5 3.5v9.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-12a1 1 0 0 1 1-1Z"/><path d="M11 2.5v3.5a1 1 0 0 0 1 1h2.5"/><path d="M6 10.5h1.4a1 1 0 0 0 0-2H6v4M10.2 8.5v4h.8a1.4 1.4 0 0 0 1.4-1.4v-1.2a1.4 1.4 0 0 0-1.4-1.4Z" stroke-width="1.05"/>',
  html: '<path d="M5 2.5h6l3.5 3.5v9.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-12a1 1 0 0 1 1-1Z"/><path d="M11 2.5v3.5a1 1 0 0 0 1 1h2.5"/><path d="M7 8.5L5.5 10.5 7 12.5M11 8.5l1.5 2L11 12.5M9.6 8l-1.2 5" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round"/>',
  bookmark:
    '<path d="M5 3.5h8a1 1 0 0 1 1 1v11l-5-3-5 3v-11a1 1 0 0 1 1-1Z" stroke-linejoin="round"/>',
  image:
    '<rect x="2.5" y="3.5" width="13" height="11" rx="1.5"/><circle cx="6.5" cy="7.5" r="1.5"/><path d="M2.5 12l3-3 3 3 3-3 4 4"/>',
  audio:
    '<path d="M7 11.5V5l6-1.5v6.5" /><circle cx="5.2" cy="11.5" r="1.8"/><circle cx="11.2" cy="10" r="1.8"/>',
  video:
    '<rect x="2.5" y="4" width="13" height="10" rx="1.5"/><path d="M7.5 7l3.5 2-3.5 2z" fill="currentColor" stroke="none"/>',
  code: '<path d="M6 5L2.5 9 6 13M12 5l3.5 4L12 13" stroke-linecap="round" stroke-linejoin="round"/>',
  data: '<ellipse cx="9" cy="5" rx="5" ry="2"/><path d="M4 5v8c0 1.1 2.2 2 5 2s5-.9 5-2V5M4 9c0 1.1 2.2 2 5 2s5-.9 5-2"/>',
  zip: '<path d="M5 2.5h6l3.5 3.5v9.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-12a1 1 0 0 1 1-1Z"/><path d="M9 3v1.2M9 5.4v1.2M9 7.8v1.2M8.2 9.5h1.6l-.4 2.3a.6.6 0 0 1-1.2 0Z" stroke-width="1.05"/>',
  txt: '<path d="M5 2.5h6l3.5 3.5v9.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-12a1 1 0 0 1 1-1Z"/><path d="M11 2.5v3.5a1 1 0 0 0 1 1h2.5"/>',
  sparkle:
    '<path d="M9 2.5l1.2 3.8 3.8 1.2-3.8 1.2L9 12.5 7.8 8.7 4 7.5l3.8-1.2zM14 12l.6 1.4L16 14l-1.4.6L14 16l-.6-1.4L12 14l1.4-.6z" stroke-linejoin="round"/>',
  chev: '<path d="M7 5l4 4-4 4" stroke-linecap="round" stroke-linejoin="round"/>',
  enter:
    '<path d="M14 4v4a2 2 0 0 1-2 2H4M7 7L4 10l3 3" stroke-linecap="round" stroke-linejoin="round"/>',
  arrowUpDown:
    '<path d="M6 7L6 14M6 7L4 9M6 7l2 2M12 11V4M12 11l-2-2M12 11l2-2" stroke-linecap="round" stroke-linejoin="round"/>',
  star: '<path d="M9 2.5l1.9 4.1 4.5.5-3.3 3 .9 4.4L9 12.3 4.9 14.5l.9-4.4-3.3-3 4.5-.5z" stroke-linejoin="round"/>',
  clock: '<circle cx="9" cy="9" r="6.5"/><path d="M9 5.5V9l2.5 1.5" stroke-linecap="round"/>',
  hash: '<path d="M6 3.5L4.5 14.5M11.5 3.5L10 14.5M3.5 7h11M3 11h11" stroke-linecap="round"/>',
  gear: '<circle cx="9" cy="9" r="2.3"/><path d="M9 2.5v2M9 13.5v2M2.5 9h2M13.5 9h2M4.4 4.4l1.4 1.4M12.2 12.2l1.4 1.4M4.4 13.6l1.4-1.4M12.2 5.8l1.4-1.4" stroke-linecap="round"/>',
  plus: '<path d="M9 4v10M4 9h10" stroke-linecap="round"/>',
  moon: '<path d="M14.5 10.5A5.5 5.5 0 0 1 7.5 3.5a6 6 0 1 0 7 7Z"/>',
  panel: '<rect x="2.5" y="3.5" width="13" height="11" rx="1.5"/><path d="M7 3.5v11"/>',
  download:
    '<path d="M9 3v8M6 8l3 3 3-3M4 14.5h10" stroke-linecap="round" stroke-linejoin="round"/>',
  globe:
    '<circle cx="9" cy="9" r="6.5"/><ellipse cx="9" cy="9" rx="3" ry="6.5"/><path d="M2.5 9h13M3 6h12M3 12h12"/>',
  scissors:
    '<circle cx="5.5" cy="13" r="1.8"/><circle cx="12.5" cy="13" r="1.8"/><path d="M12.5 11.2L5 3M5.5 11.2L13 3" stroke-linecap="round"/>',
  check: '<path d="M4 9.5l3.5 3.5L14 5.5" stroke-linecap="round" stroke-linejoin="round"/>',
  close: '<path d="M5 5l8 8M13 5l-8 8" stroke-linecap="round"/>',
  graph:
    '<circle cx="4.5" cy="13" r="1.8"/><circle cx="13.5" cy="13" r="1.8"/><circle cx="9" cy="4.5" r="1.8"/><path d="M8 6L5.3 11.4M10 6l2.7 5.4M6.3 13h5.4"/>',
}

export const KIND_ICON: Record<string, string> = {
  md: 'md',
  txt: 'txt',
  html: 'html',
  bookmark: 'bookmark',
  pdf: 'pdf',
  image: 'image',
  audio: 'audio',
  video: 'video',
  code: 'code',
  data: 'data',
  zip: 'zip',
  folder: 'folder',
}

export const KIND_LABEL: Record<string, string> = {
  md: 'Markdown',
  txt: 'Text',
  html: 'Web clip',
  bookmark: 'Bookmark',
  pdf: 'PDF',
  image: 'Image',
  audio: 'Audio',
  video: 'Video',
  code: 'Code',
  data: 'Data',
  zip: 'Archive',
  folder: 'Folder',
}

export const QIcon = ({
  name,
  size = 16,
  strokeWidth = 1.5,
  className,
  style,
}: {
  name: string
  size?: number
  strokeWidth?: number
  className?: string
  style?: React.CSSProperties
}) => {
  const path = PATHS[name]
  if (!path) return null
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      style={style}
      dangerouslySetInnerHTML={{ __html: path }}
    />
  )
}

/** Title highlighter for fuzzy-match positions. */
export const HiText = ({ text, positions }: { text: string; positions: number[] }) => {
  if (!positions || !positions.length) return <>{text}</>
  const set = new Set(positions)
  const out: React.ReactNode[] = []
  let run = ''
  let runHi = set.has(0)
  for (let i = 0; i < text.length; i++) {
    const hi = set.has(i)
    if (hi !== runHi) {
      out.push(
        runHi ? (
          <mark key={i} className="hi">
            {run}
          </mark>
        ) : (
          <span key={i}>{run}</span>
        ),
      )
      run = ''
      runHi = hi
    }
    run += text[i]
  }
  out.push(
    runHi ? (
      <mark key="end" className="hi">
        {run}
      </mark>
    ) : (
      <span key="end">{run}</span>
    ),
  )
  return <>{out}</>
}

/** Snippet highlighter for [start,end) ranges. */
export const HiRanges = ({ text, ranges }: { text: string; ranges: [number, number][] }) => {
  if (!ranges || !ranges.length) return <>{text}</>
  const out: React.ReactNode[] = []
  let cursor = 0
  ranges.forEach(([a, b], idx) => {
    if (a > cursor) out.push(<span key={'t' + idx}>{text.slice(cursor, a)}</span>)
    out.push(
      <mark key={'m' + idx} className="hi">
        {text.slice(a, b)}
      </mark>,
    )
    cursor = b
  })
  if (cursor < text.length) out.push(<span key="tail">{text.slice(cursor)}</span>)
  return <>{out}</>
}
