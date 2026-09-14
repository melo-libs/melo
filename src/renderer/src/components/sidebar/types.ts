import type { FileKind } from '../FileTypeIcon'

/** A node in the workspace file tree — folder or file. */
export interface FileNode {
  id: string
  name: string
  kind: FileKind
  children?: FileNode[]
  /** Folder default expansion. */
  open?: boolean
  /** Marks the system Inbox folder. */
  system?: 'inbox'
  /** Present on clipped content (web clippings, bookmarks). */
  source?: { url?: string; host?: string; capturedAt?: string }
  /** Pinned to top. */
  starred?: boolean
  /** Word count / page count / minutes, depending on kind. */
  count?: number
  /** Tags from the note's frontmatter. */
  tags?: string[]
  /** On-disk size in bytes (real workspaces). */
  size?: number
  /** Last-modified time, ms epoch (real workspaces). */
  mtime?: number
  /** Creation time (fs birthtime) — tree sorting by created. */
  btime?: number
}

/** A workspace the user can switch between. */
export interface Workspace {
  id: string
  name: string
  notes: number
  color: string
}
