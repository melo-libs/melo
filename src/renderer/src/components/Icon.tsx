import type { SVGProps } from 'react'

/* ============================================================
   Icon — minimal inline SVG set, consistent stroke, 18×18 viewBox.
   Port of design icons.jsx; names preserved 1:1 so component code
   ported later can reference the same `name`.
   ============================================================ */

const paths: Record<string, JSX.Element> = {
  folder: (
    <path d="M2.5 5.5a2 2 0 0 1 2-2h3l2 2h5a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-10a2 2 0 0 1-2-2v-7Z" />
  ),
  folderOpen: (
    <path d="M2.5 6.5a2 2 0 0 1 2-2h3l2 2h5a2 2 0 0 1 2 2v.5M2.5 6.5v6a2 2 0 0 0 2 2h9.2a1.5 1.5 0 0 0 1.44-1.07l1.3-4.34a1 1 0 0 0-.96-1.29H4.5a2 2 0 0 0-2 2.2" />
  ),
  file: (
    <>
      <path d="M5 2.5h6l3.5 3.5v9.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-12a1 1 0 0 1 1-1Z" />
      <path d="M11 2.5v3.5a1 1 0 0 0 1 1h2.5" />
    </>
  ),
  fileMd: (
    <>
      <path d="M5 2.5h6l3.5 3.5v9.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-12a1 1 0 0 1 1-1Z" />
      <path d="M11 2.5v3.5a1 1 0 0 0 1 1h2.5" />
      <path
        d="M6.5 12.5v-3l1.2 1.6 1.2-1.6v3M11 9.5v3M11 12.5l1.2-1.5M11 12.5l-1.2-1.5"
        strokeWidth="1.1"
      />
    </>
  ),
  lock: (
    <>
      <path d="M5.5 8V6.5a3.5 3.5 0 0 1 7 0V8" />
      <rect x="3.5" y="8" width="11" height="8" rx="1.5" />
      <path d="M9 11.5v1.5" strokeLinecap="round" />
    </>
  ),
  md: (
    <g transform="scale(0.75)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 16V8l4 4 4-4v8" />
      <path d="M17 8v6m0 0l-2.5-2.5M17 14l2.5-2.5" />
    </g>
  ),
  chev: <path d="M7 5l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />,
  search: (
    <>
      <circle cx="8" cy="8" r="4.5" />
      <path d="M11.5 11.5L14 14" strokeLinecap="round" />
    </>
  ),
  plus: <path d="M9 4v10M4 9h10" strokeLinecap="round" />,
  grip: (
    <>
      <circle cx="7" cy="5" r="1" fill="currentColor" stroke="none" />
      <circle cx="11" cy="5" r="1" fill="currentColor" stroke="none" />
      <circle cx="7" cy="9" r="1" fill="currentColor" stroke="none" />
      <circle cx="11" cy="9" r="1" fill="currentColor" stroke="none" />
      <circle cx="7" cy="13" r="1" fill="currentColor" stroke="none" />
      <circle cx="11" cy="13" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  sun: (
    <>
      <circle cx="9" cy="9" r="3" />
      <path
        d="M9 2v1.5M9 14.5V16M2 9h1.5M14.5 9H16M3.7 3.7l1.06 1.06M13.24 13.24l1.06 1.06M3.7 14.3l1.06-1.06M13.24 4.76l1.06-1.06"
        strokeLinecap="round"
      />
    </>
  ),
  moon: <path d="M14.5 10.5A5.5 5.5 0 0 1 7.5 3.5a6 6 0 1 0 7 7Z" />,
  panelL: (
    <>
      <rect x="2.5" y="3.5" width="13" height="11" rx="1.5" />
      <path d="M7 3.5v11M4.5 6.5h1M4.5 8.5h1M4.5 10.5h1" />
    </>
  ),
  panelR: (
    <>
      <rect x="2.5" y="3.5" width="13" height="11" rx="1.5" />
      <path d="M11 3.5v11M12.5 6.5h1M12.5 8.5h1M12.5 10.5h1" />
    </>
  ),
  bold: (
    <path d="M5 3.5h4.5a2.5 2.5 0 0 1 0 5H5zM5 8.5h5a2.5 2.5 0 0 1 0 5H5z" strokeLinejoin="round" />
  ),
  italic: <path d="M8 3.5h6M4 13.5h6M10.5 3.5l-3 10" strokeLinecap="round" />,
  /* underline / strike: nudged from the design source (underline y3–14,
     strike y3.5–14.5) toward bold/italic's y3.5–13.5 band so the four marks
     read as one optical size in the bubble row. */
  underline: <path d="M5 3.5v5.5a4 4 0 0 0 8 0V3.5M4 14h10" strokeLinecap="round" />,
  strike: (
    <path
      d="M3.5 8.5h11M6 5.5a3 3 0 0 1 3-2c2 0 3 1 3 2.5M6 11.5c.5 1.5 1.7 2 3 2 2 0 3-1 3-2.5"
      strokeLinecap="round"
    />
  ),
  code: <path d="M6 5L2.5 9 6 13M12 5l3.5 4L12 13" strokeLinecap="round" strokeLinejoin="round" />,
  link: (
    <path d="M10 6.5h2a3 3 0 0 1 0 6h-2M8 12.5H6a3 3 0 0 1 0-6h2M6.5 9.5h5" strokeLinecap="round" />
  ),
  enter: (
    <path
      d="M14 4.5V8a2 2 0 0 1-2 2H4.5M7.5 7l-3 3 3 3"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  externalLink: (
    <path
      d="M8 4.5H5.5a1.5 1.5 0 0 0-1.5 1.5v6.5A1.5 1.5 0 0 0 5.5 14H12a1.5 1.5 0 0 0 1.5-1.5V10M10.5 3.5H14.5V7.5M14 4L8.75 9.25"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  quote: (
    <path
      d="M4 5.5v4h3v3H4.5a1 1 0 0 1-1-1v-4.5M10 5.5v4h3v3H10.5a1 1 0 0 1-1-1v-4.5"
      strokeLinejoin="round"
    />
  ),
  h1: (
    <path
      d="M4 3.5v10M10 3.5v10M4 8.5h6M13 3.5l2-1v11"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  h2: (
    <path
      d="M3 3.5v10M8 3.5v10M3 8.5h5M12 6.5a1.5 1.5 0 0 1 3 0c0 2-3 3-3 5v1h3"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  h3: (
    <path
      d="M3 3.5v10M8 3.5v10M3 8.5h5M11.5 5.5h3l-2 3a1.5 1.5 0 1 1-1.5 2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  list: (
    <>
      <circle cx="4" cy="5" r="1" fill="currentColor" stroke="none" />
      <circle cx="4" cy="9" r="1" fill="currentColor" stroke="none" />
      <circle cx="4" cy="13" r="1" fill="currentColor" stroke="none" />
      <path d="M7.5 5h8M7.5 9h8M7.5 13h8" strokeLinecap="round" />
    </>
  ),
  listOl: (
    <path d="M3 3.5L4 3v4M7.5 5h8M7.5 9h8M7.5 13h8M3 9h2l-2 3h2.5M3.5 13H5" strokeLinecap="round" />
  ),
  check: (
    <>
      <rect x="3" y="5" width="5" height="5" rx="1" />
      <path d="M4 7.5l1 1 2-2" />
      <path d="M10 5h5M10 8h5M10 11h5M3 14h12" strokeLinecap="round" />
    </>
  ),
  /* Plain selection checkmark — `check` above is the task-list block
     composite and must never mark a chosen menu item. */
  tick: <path d="M3.5 9.5l3.2 3.2L14.5 5" strokeLinecap="round" strokeLinejoin="round" />,
  /* Task checkbox — single box + check, cleaner at 14px than `check`'s
     box-with-text-lines composite. */
  task: (
    <>
      <rect x="3.5" y="3.5" width="11" height="11" rx="2.5" />
      <path d="M6.2 9.2l1.9 1.9 3.7-4" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  /* Code block — chevrons + slash ("</>"), distinct from the inline-code
     chevrons and lighter than code2's window frame. */
  codeBlock: (
    <path
      d="M5.2 6L2.5 9l2.7 3M12.8 6l2.7 3-2.7 3M10.4 4.5l-2.8 9"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  toggle: (
    <>
      <path d="M6 5l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M11 9h5" strokeLinecap="round" />
    </>
  ),
  callout: (
    <>
      <path d="M3.5 5.5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-4L6 15.5v-3H5.5a2 2 0 0 1-2-2z" />
      <circle cx="9" cy="8" r="0.7" fill="currentColor" stroke="none" />
      <circle cx="6" cy="8" r="0.7" fill="currentColor" stroke="none" />
      <circle cx="12" cy="8" r="0.7" fill="currentColor" stroke="none" />
    </>
  ),
  image: (
    <>
      <rect x="2.5" y="3.5" width="13" height="11" rx="1.5" />
      <circle cx="6.5" cy="7.5" r="1.5" />
      <path d="M2.5 12l3-3 3 3 3-3 4 4" />
    </>
  ),
  divider: <path d="M3 9h2M7 9h4M13 9h2" strokeLinecap="round" />,
  table: (
    <>
      <rect x="2.5" y="3.5" width="13" height="11" rx="1" />
      <path d="M2.5 7.5h13M2.5 11h13M6.5 3.5v11M11 3.5v11" />
    </>
  ),
  code2: (
    <>
      <rect x="2.5" y="4" width="13" height="10" rx="1.5" />
      <path d="M6 8l-1.5 1L6 10M12 8l1.5 1L12 10M10 7l-1 4" strokeLinecap="round" />
    </>
  ),
  sparkle: (
    <path
      d="M9 2.5l1.2 3.8 3.8 1.2-3.8 1.2L9 12.5 7.8 8.7 4 7.5l3.8-1.2zM14 12l.6 1.4L16 14l-1.4.6L14 16l-.6-1.4L12 14l1.4-.6z"
      strokeLinejoin="round"
    />
  ),
  dots: (
    <>
      <circle cx="4" cy="9" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="9" cy="9" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="14" cy="9" r="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  share: (
    <path d="M6 9L12 5M6 9L12 13M6 9a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM16 4a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM16 14a2 2 0 1 1-4 0 2 2 0 0 1 4 0z" />
  ),
  hist: (
    <path
      d="M9 3.5a5.5 5.5 0 1 1-5.5 5.5M3.5 4v3h3M9 6v3.5l2 1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  copy: (
    <>
      <rect x="3" y="5" width="9" height="10" rx="1" />
      <path d="M5.5 5V3.5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H12" />
    </>
  ),
  trash: (
    <path
      d="M4 5.5h10M7 5.5V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5M6 5.5l.5 9a1 1 0 0 0 1 .9h3a1 1 0 0 0 1-.9l.5-9"
      strokeLinecap="round"
    />
  ),
  arrowRight: <path d="M4 9h10M10 5l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />,
  bracketLink: (
    <path
      d="M6.5 3.5H4.5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h2M11.5 3.5h2a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  backlink: (
    <path
      d="M14.5 5.5v3a3 3 0 0 1-3 3H4.5M7.5 8.5l-3 3 3 3"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  graph: (
    <>
      <circle cx="5" cy="6" r="2" />
      <circle cx="13.5" cy="5" r="1.6" />
      <circle cx="10" cy="13" r="1.9" />
      <path d="M6.6 6.9 8.7 11.4M6.8 5.6 11.6 5.1" />
    </>
  ),
  x: <path d="M5 5l8 8M13 5l-8 8" strokeLinecap="round" />,
  moreH: (
    <>
      <circle cx="4" cy="9" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="9" cy="9" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="14" cy="9" r="1.3" fill="currentColor" stroke="none" />
    </>
  ),
  tag: (
    <>
      <path d="M3 3.5h5.5L15 10l-6.5 6.5L2 10V3.5z" strokeLinejoin="round" />
      <circle cx="5.5" cy="6" r="0.8" fill="currentColor" stroke="none" />
    </>
  ),
  book: (
    <path d="M3.5 4.5a2 2 0 0 1 2-2H9v12H5.5a2 2 0 0 0-2 2zM14.5 4.5a2 2 0 0 0-2-2H9v12h3.5a2 2 0 0 1 2 2z" />
  ),
  ai: <path d="M9 3l1.5 4L14.5 8.5 10.5 10 9 14 7.5 10 3.5 8.5 7.5 7z" strokeLinejoin="round" />,
  star: (
    <path
      d="M9 2.5l2 4.3 4.7.5-3.6 3.2 1.1 4.6L9 12.7l-4.2 2.4 1.1-4.6L2.3 7.3l4.7-.5z"
      strokeLinejoin="round"
    />
  ),
  starFill: (
    <path
      d="M9 2.5l2 4.3 4.7.5-3.6 3.2 1.1 4.6L9 12.7l-4.2 2.4 1.1-4.6L2.3 7.3l4.7-.5z"
      fill="currentColor"
      strokeLinejoin="round"
    />
  ),
  pencil: (
    <path
      d="M12 3.5l2.5 2.5-8 8H4v-2.5z M11 4.5L13.5 7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  duplicate: (
    <>
      <rect x="3" y="3" width="8" height="8" rx="1" />
      <path d="M7 11v3a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1h-3" />
    </>
  ),
  move: (
    <path
      d="M3.5 6.5a2 2 0 0 1 2-2h2.5l1.5 1.5h4.5a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H5.5a2 2 0 0 1-2-2zM10 8.5h4M12 6.5L14 8.5 12 10.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  download: (
    <path
      d="M9 3v8M5.5 7.5L9 11l3.5-3.5M3.5 13.5h11"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  upload: (
    <path
      d="M9 11V3M5.5 6.5L9 3l3.5 3.5M3.5 13.5h11"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  info: (
    <>
      <circle cx="9" cy="9" r="6" />
      <path d="M9 8.5v3.5M9 6v.5" strokeLinecap="round" />
    </>
  ),
  eye: (
    <>
      <path d="M2 9s2.5-4.5 7-4.5S16 9 16 9s-2.5 4.5-7 4.5S2 9 2 9z" />
      <circle cx="9" cy="9" r="1.7" />
    </>
  ),
  folderPlus: (
    <>
      <path d="M2.5 5.5a2 2 0 0 1 2-2h3l2 2h5a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-10a2 2 0 0 1-2-2v-7Z" />
      <path d="M9 7.5v4M7 9.5h4" strokeLinecap="round" />
    </>
  ),
  folderArrow: (
    <>
      <path d="M2.5 5.5a2 2 0 0 1 2-2h3l2 2h5a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-10a2 2 0 0 1-2-2v-7Z" />
      <path d="M7 9.5h5M10 7.5L12 9.5 10 11.5" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  inbox: (
    <path
      d="M3 4.5a1.5 1.5 0 0 1 1.5-1.5h9A1.5 1.5 0 0 1 15 4.5l-1 5.5h-3a2 2 0 0 1-4 0H4z M3 10v3.5A1.5 1.5 0 0 0 4.5 15h9a1.5 1.5 0 0 0 1.5-1.5V10"
      strokeLinejoin="round"
    />
  ),
  inboxFill: (
    <>
      <path
        d="M4.5 3a1.5 1.5 0 0 0-1.5 1.5L4 10h3a2 2 0 0 0 4 0h3l1-5.5A1.5 1.5 0 0 0 13.5 3z"
        fill="currentColor"
        stroke="none"
      />
      <path d="M3 10v3.5A1.5 1.5 0 0 0 4.5 15h9a1.5 1.5 0 0 0 1.5-1.5V10" strokeLinejoin="round" />
    </>
  ),
  globe: (
    <>
      <circle cx="9" cy="9" r="6" />
      <path d="M3 9h12M9 3a8 8 0 0 1 0 12M9 3a8 8 0 0 0 0 12" />
    </>
  ),
  paperclip: (
    <path
      d="M14 8L8.5 13.5a3 3 0 1 1-4.2-4.2L10 3.6a2 2 0 1 1 2.8 2.8L7 12.3a1 1 0 1 1-1.4-1.4L11 5.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  fileGeneric: (
    <>
      <path d="M5 2.5h6l3.5 3.5v9.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-12a1 1 0 0 1 1-1Z" />
      <path d="M11 2.5v3.5a1 1 0 0 0 1 1h2.5" />
    </>
  ),
  print: (
    <path
      d="M5 7V3.5h8V7M5 14H3.5v-5a1.5 1.5 0 0 1 1.5-1.5h8A1.5 1.5 0 0 1 14.5 9v5H13M5 11h8v3.5H5z"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  focus: (
    <>
      <path
        d="M3 6V3.5h2.5M12.5 3.5H15V6M15 12v2.5h-2.5M5.5 14.5H3V12"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="9" cy="9" r="2.2" />
    </>
  ),
  type: <path d="M4 5h10M9 5v10M6.5 15h5" strokeLinecap="round" />,
  sigma: <path d="M13 4H5l4 5-4 5h8" strokeLinecap="round" strokeLinejoin="round" />,
  arrowUp: <path d="M9 14V4M5 8l4-4 4 4" strokeLinecap="round" strokeLinejoin="round" />,
  arrowDown: <path d="M9 4v10M5 10l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />,
  arrowLeft: <path d="M14 9H4M8 5L4 9l4 4" strokeLinecap="round" strokeLinejoin="round" />,
  sortAsc: (
    <path
      d="M5 3v12M3 13l2 2 2-2M10 5h5M10 9h3.5M10 13h2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  sortDesc: (
    <path
      d="M5 3v12M3 13l2 2 2-2M10 5h2M10 9h3.5M10 13h5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  alignLeft: <path d="M3 4h12M3 8h8M3 12h10" strokeLinecap="round" />,
  alignCenter: <path d="M3 4h12M5 8h8M4 12h10" strokeLinecap="round" />,
  alignRight: <path d="M3 4h12M7 8h8M5 12h10" strokeLinecap="round" />,
  tableHeader: (
    <>
      <rect x="2.5" y="3.5" width="13" height="11" rx="1" />
      <path d="M2.5 7.5h13" />
      <path d="M6.5 3.5v4M11 3.5v4" />
    </>
  ),
  eraser: (
    <path
      d="M6 14h8M8.5 14l-4.8-4.8a1.5 1.5 0 0 1 0-2.1l5.2-5.2a1.5 1.5 0 0 1 2.1 0l3.2 3.2a1.5 1.5 0 0 1 0 2.1L10 11.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  moreV: (
    <>
      <circle cx="9" cy="4.5" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="9" cy="9" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="9" cy="13.5" r="1.3" fill="currentColor" stroke="none" />
    </>
  ),
  grip4: (
    <>
      <circle cx="6.5" cy="6.5" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="11.5" cy="6.5" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="6.5" cy="11.5" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="11.5" cy="11.5" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
}

export type IconName = keyof typeof paths

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName
  size?: number
}

export const Icon = ({ name, size = 16, style, ...rest }: IconProps) => {
  const path = paths[name]
  if (!path) return null
  return (
    <svg
      viewBox="0 0 18 18"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.3}
      // Stroke weight is scope-tunable like a typographic property: a
      // container sets --icon-stroke and every Icon inside follows (the
      // bubble uses 1.5 to compensate for its smaller 14px render).
      // Paths with their own strokeWidth attr keep it (attrs beat
      // inherited styles).
      style={{ strokeWidth: 'var(--icon-stroke, 1.3)', ...style }}
      {...rest}
    >
      {path}
    </svg>
  )
}
