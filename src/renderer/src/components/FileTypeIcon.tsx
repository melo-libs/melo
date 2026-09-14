import { cn } from '../lib/cn'
import i18n from '../i18n'
import './FileTypeIcon.scss'

/* ============================================================
   FileTypeIcon — small rounded tile + glyph per file kind.
   Tile fill and border come from CSS (`.ft-{group}` classes);
   the user's accent / theme stays in charge of actual hue.
   ============================================================ */

export type FileKind =
  | 'folder'
  | 'folderOpen'
  | 'md'
  | 'txt'
  | 'html'
  | 'bookmark'
  | 'pdf'
  | 'image'
  | 'audio'
  | 'video'
  | 'code'
  | 'data'
  | 'zip'
  | 'other'

export type FileTypeIconKind = FileKind | 'clip'

type FileGroup = 'note' | 'clip' | 'read' | 'media' | 'code' | 'archive' | 'folder'

const GROUP_CLASS: Record<FileGroup, string> = {
  note: 'ft-note',
  clip: 'ft-clip',
  read: 'ft-read',
  media: 'ft-media',
  code: 'ft-code',
  archive: 'ft-archive',
  folder: 'ft-folder',
}

export const FILE_TYPES: Record<
  FileTypeIconKind,
  { group: FileGroup; label: string; ext: string }
> = {
  folder: { group: 'folder', label: 'Folder', ext: '' },
  folderOpen: { group: 'folder', label: 'Folder', ext: '' },
  md: { group: 'note', label: 'Markdown note', ext: '.md' },
  clip: { group: 'clip', label: 'Web clipping', ext: '.md' },
  txt: { group: 'note', label: 'Plain text', ext: '.txt' },
  html: { group: 'clip', label: 'Web clipping', ext: '.html' },
  bookmark: { group: 'clip', label: 'Bookmark', ext: '' },
  pdf: { group: 'read', label: 'PDF', ext: '.pdf' },
  image: { group: 'media', label: 'Image', ext: '' },
  audio: { group: 'media', label: 'Audio', ext: '' },
  video: { group: 'media', label: 'Video', ext: '' },
  code: { group: 'code', label: 'Code', ext: '' },
  data: { group: 'code', label: 'Data', ext: '' },
  zip: { group: 'archive', label: 'Archive', ext: '.zip' },
  other: { group: 'archive', label: 'File', ext: '' },
}

type GlyphKind =
  | Exclude<FileTypeIconKind, 'folder' | 'folderOpen' | 'bookmark'>
  | 'bookmark'
  | 'folder'

const glyphs: Record<GlyphKind, JSX.Element> = {
  md: (
    <path
      d="M4.5 12V6l2 2.5L8.5 6v6M11 8v4M11 12l1.5-2M11 12l-1.5-2"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  clip: (
    <>
      <circle cx="9" cy="9" r="4" strokeWidth="1.1" />
      <path
        d="M5 9h8M9 5c1.4 1.2 2 2.5 2 4s-.6 2.8-2 4M9 5C7.6 6.2 7 7.5 7 9s.6 2.8 2 4"
        strokeWidth="1.1"
      />
    </>
  ),
  txt: <path d="M5 7h8M5 9.5h8M5 12h5" strokeWidth="1.2" strokeLinecap="round" />,
  html: (
    <path
      d="M5.5 7L4 9l1.5 2M12.5 7L14 9l-1.5 2M10.5 6.5l-3 5"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  bookmark: (
    <path
      d="M6 4.5v9.5l3-2 3 2V4.5a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1z"
      strokeWidth="1.2"
      strokeLinejoin="round"
    />
  ),
  pdf: (
    <path
      d="M5 6.5h2a1 1 0 0 1 0 2H5zM5 6.5v6M9.5 6.5v6h1.5a2 2 0 0 0 0-4 2 2 0 0 0-1.5-2zM13 6.5h2.5M13 6.5v6M13 9.5h2"
      strokeWidth="1.05"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  image: (
    <>
      <rect x="4" y="5" width="10" height="8" rx="1" strokeWidth="1.2" />
      <circle cx="6.5" cy="7.5" r="0.9" fill="currentColor" stroke="none" />
      <path d="M4 11l2.5-2 2.5 2 2-1.5L14 12" strokeWidth="1.2" />
    </>
  ),
  audio: (
    <>
      <path
        d="M5 11V7l5-1.5v6M10 11.5V5.5"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="4.5" cy="11.5" r="1.5" strokeWidth="1.2" />
      <circle cx="11.5" cy="11" r="1.5" strokeWidth="1.2" />
    </>
  ),
  video: (
    <>
      <rect x="3.5" y="5" width="11" height="8" rx="1.5" strokeWidth="1.2" />
      <path d="M7.5 7.5l3.5 1.5-3.5 1.5z" fill="currentColor" stroke="none" />
    </>
  ),
  code: (
    <path
      d="M6 6.5L3 9l3 2.5M12 6.5L15 9l-3 2.5M10.5 5.5l-3 7"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  data: (
    <>
      <ellipse cx="9" cy="6" rx="4" ry="1.4" strokeWidth="1.2" />
      <path
        d="M5 6v3c0 .8 1.8 1.4 4 1.4s4-.6 4-1.4V6M5 9v3c0 .8 1.8 1.4 4 1.4s4-.6 4-1.4V9"
        strokeWidth="1.2"
      />
    </>
  ),
  zip: (
    <>
      <rect x="6" y="3.5" width="2" height="2" strokeWidth="1.2" />
      <rect x="6" y="5.5" width="2" height="2" strokeWidth="1.2" />
      <rect x="6" y="7.5" width="2" height="2" strokeWidth="1.2" />
      <path d="M5 11h4l-1 3.5h-2z" strokeWidth="1.2" strokeLinejoin="round" />
    </>
  ),
  folder: (
    <path
      d="M3 6a1.5 1.5 0 0 1 1.5-1.5H7l1.5 1.5h5A1.5 1.5 0 0 1 15 7.5v4A1.5 1.5 0 0 1 13.5 13h-9A1.5 1.5 0 0 1 3 11.5z"
      strokeWidth="1.2"
      strokeLinejoin="round"
    />
  ),
  other: <path d="M5.5 4h4.5L13 7v7H5.5zM10 4v3h3" strokeWidth="1.2" strokeLinejoin="round" />,
}

export interface FileTypeIconProps {
  kind: FileTypeIconKind
  size?: number
  /** Glyph only, no tile — for dense lists where the tile reads heavy. */
  bare?: boolean
  className?: string
  title?: string
}

export const FileTypeIcon = ({ kind, size = 16, bare, className, title }: FileTypeIconProps) => {
  const meta = FILE_TYPES[kind] ?? FILE_TYPES.md
  const groupCls = GROUP_CLASS[meta.group] ?? 'ft-note'
  const glyphKind: GlyphKind =
    kind === 'folder' || kind === 'folderOpen' ? 'folder' : (kind as GlyphKind)
  const glyph = glyphs[glyphKind] ?? glyphs.md

  // Folder / bookmark render WITHOUT the surrounding tile (they're themselves shapes)
  if (kind === 'folder' || kind === 'folderOpen' || kind === 'bookmark') {
    return (
      <svg
        viewBox="0 0 18 18"
        width={size}
        height={size}
        fill="none"
        stroke="currentColor"
        className={cn('ft-icon ft-bare', groupCls, className)}
      >
        {title && <title>{title}</title>}
        {glyph}
      </svg>
    )
  }

  return (
    <svg
      viewBox="0 0 18 18"
      width={size}
      height={size}
      className={cn('ft-icon', bare ? 'ft-bare-glyph' : 'ft-tile', groupCls, className)}
    >
      {title && <title>{title}</title>}
      {!bare && <rect x="2.5" y="2.5" width="13" height="13" rx="2.5" className="ft-tile-bg" />}
      <g className="ft-tile-glyph">{glyph}</g>
    </svg>
  )
}

/** Localized display label for a file kind — FILE_TYPES.label stays the
    English identity value. */
export const fileTypeLabel = (kind: FileTypeIconKind): string => i18n.t(`fileTypes.${kind}`)
