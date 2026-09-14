/* ============================================================
   SIcon — the Smart Folders glyph set, ported verbatim from
   design smart-data.jsx (24-viewBox, lucide-ish stroke). Kept
   separate from the app's 18-viewBox Icon so both render 1:1
   with their respective designs.
   ============================================================ */

const P = (d: string, sw?: number) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw || 1.7}" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`

const ICONS: Record<string, string> = {
  chev: P('<path d="M9 6l6 6-6 6"/>'),
  caret: P('<path d="M6 9l6 6 6-6"/>', 1.8),
  search: P('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.2-4.2"/>'),
  folder: P(
    '<path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  ),
  inbox: P(
    '<path d="M3 12h5l1.5 2.5h5L21 12"/><path d="M5 5h14l2 7v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5z"/>',
  ),
  funnel: P('<path d="M21 4H3l7 8.5V19l4 2v-8.5z"/>', 1.6),
  star: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 3.5l2.6 5.3 5.9.9-4.2 4.1 1 5.9-5.3-2.8-5.3 2.8 1-5.9L4.2 9.7l5.9-.9z"/></svg>',
  starline: P(
    '<path d="M12 3.5l2.6 5.3 5.9.9-4.2 4.1 1 5.9-5.3-2.8-5.3 2.8 1-5.9L4.2 9.7l5.9-.9z"/>',
  ),
  hash: P('<path d="M5 9h14M4 15h14M10 4l-2 16M16 4l-2 16"/>'),
  doc: P('<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/><path d="M10 13h5M10 16h5"/>'),
  globe: P(
    '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.4 2.5 14.6 0 17M12 3.5c-2.5 2.4-2.5 14.6 0 17"/>',
  ),
  pdf: P(
    '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/><path d="M9.5 17v-4h1.2a1.2 1.2 0 0 1 0 2.4H9.5"/>',
  ),
  image: P(
    '<rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M5 18l4.5-4.5 4 4 2.5-2.5L20 18"/>',
  ),
  audio: P(
    '<path d="M9 18V6l10-2v12"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/>',
  ),
  video: P(
    '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M10 9.5l5 2.5-5 2.5z" fill="currentColor" stroke="none"/>',
  ),
  code: P('<path d="M9 8l-4 4 4 4M15 8l4 4-4 4"/>'),
  plus: P('<path d="M12 5v14M5 12h14"/>'),
  sliders: P(
    '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
  ),
  sort: P('<path d="M7 4v16M7 4l-3 3M7 4l3 3M17 20V4M17 20l-3-3M17 20l3-3"/>'),
  moreH: P(
    '<circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
  ),
  spark:
    '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2.5l1.6 6 5.9 1.5-5.9 1.5L12 17.5l-1.6-6L4.5 10l5.9-1.5z"/></svg>',
  bookmark: P('<path d="M6 4h12v16l-6-4-6 4z"/>'),
  x: P('<path d="M6 6l12 12M18 6L6 18"/>'),
  check: P('<path d="M5 12.5l4.5 4.5L19 6.5"/>'),
  trash: P('<path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/>'),
  calendar: P('<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M4 9h16M9 3v4M15 3v4"/>'),
  tag: P(
    '<path d="M3 12l8.5-8.5a2 2 0 0 1 1.4-.6H19a2 2 0 0 1 2 2v6.1a2 2 0 0 1-.6 1.4L12 21z"/><circle cx="16" cy="8" r="1.3"/>',
  ),
  clock: P('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  open: P(
    '<path d="M14 4h6v6M20 4l-9 9M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5"/>',
  ),
  pin: P('<path d="M12 17v5M8 4h8l-1 7 3 3H6l3-3z"/>'),
  // --- curated smart-folder glyph set (clear at 15px) ---
  book: P(
    '<path d="M5.5 4H12v16H5.5A1.5 1.5 0 0 1 4 18.5v-13A1.5 1.5 0 0 1 5.5 4z"/><path d="M18.5 4H12v16h6.5a1.5 1.5 0 0 0 1.5-1.5v-13A1.5 1.5 0 0 0 18.5 4z"/>',
  ),
  wave: P('<path d="M3 11v2M7.5 7v10M12 4v16M16.5 8v8M21 11v2"/>'),
  tagOff: P(
    '<path d="M3 12l8.5-8.5a2 2 0 0 1 1.4-.6H19a2 2 0 0 1 2 2v6.1a2 2 0 0 1-.6 1.4L12 21z"/><circle cx="16" cy="8" r="1.2"/><path d="M3.5 3.5l17 17"/>',
  ),
  flame: P(
    '<path d="M12 3c.5 3 4 4.2 4 8a4 4 0 0 1-8 0c0-1.4.6-2.3 1.4-3.2C10.5 9.7 12 8.5 12 3z"/>',
  ),
  flag: P('<path d="M6 21V4M6 4.5h11l-2.2 4 2.2 4H6"/>'),
  layers: P('<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>'),
  highlight: P('<path d="M4 20h6M14 4l6 6-8 8H8v-4z"/>'),
  heart: P(
    '<path d="M12 20.5C7.5 17 3 13.5 3 9.5a4.5 4.5 0 0 1 9-1.2 4.5 4.5 0 0 1 9 1.2c0 4-4.5 7.5-9 11z"/>',
  ),
  bolt: P('<path d="M13 2.5L3.5 14H12l-1 7.5L20.5 10H12z"/>'),
  archive: P(
    '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9"/><path d="M10 13h4"/>',
  ),
  briefcase: P(
    '<rect x="3" y="8" width="18" height="12" rx="2"/><path d="M9 8V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>',
  ),
  bulb: P(
    '<path d="M12 3a6 6 0 0 1 3.5 10.9c-.7.5-1 1.3-1 2.1h-5c0-.8-.3-1.6-1-2.1A6 6 0 0 1 12 3z"/><path d="M9.5 19h5M10.5 21.5h3"/>',
  ),
  target: P(
    '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/>',
  ),
  leaf: P('<path d="M5 19C5 10 11 4 20 4c0 9-6 15-15 15z"/><path d="M5 19c3-5 7-9 11-11"/>'),
  moon: P('<path d="M20 13.5A8 8 0 0 1 10.5 4 8 8 0 1 0 20 13.5z"/>'),
  pencil: P('<path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19l-4 1z"/><path d="M14.5 6.5l3 3"/>'),
  coffee: P(
    '<path d="M4 9h13v7a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z"/><path d="M17 10h1.5a2.5 2.5 0 0 1 0 5H17"/><path d="M9 3.5v2M13 3.5v2"/>',
  ),
  plane: P('<path d="M21 3L3 10.5l7 2.5 2.5 7z"/><path d="M21 3l-11 10"/>'),
  home: P('<path d="M4 11l8-7 8 7"/><path d="M6 9.5V20h12V9.5"/>'),
}

export const SIcon = ({ n, s = 16, cls = '' }: { n: string; s?: number; cls?: string }) => (
  <span
    className={'ico ' + cls}
    style={{ width: s, height: s }}
    dangerouslySetInnerHTML={{ __html: ICONS[n] || '' }}
  />
)
