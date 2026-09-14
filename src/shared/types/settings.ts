/* ============================================================
   App settings — one flat object persisted by the main process
   (preferences.json, key "settings") and mirrored to every
   window over IPC. Values here are identity values: locale
   files translate them at render, consumers switch on them.
   ============================================================ */

export interface AppSettings {
  /** Where a note created without explicit context lands. */
  newNoteLocation: 'inbox' | 'current'
  /** Automatic background update checks (manual check always works). */
  autoUpdate: boolean

  theme: 'light' | 'dark' | 'system'
  editorWidth: 'narrow' | 'default' | 'wide' | 'full'
  /** Show the outline column when the app starts. */
  outlineByDefault: boolean
  /** File-tree ordering (folders first, Inbox pinned, then this rule). */
  treeSort:
    | 'name-asc'
    | 'name-desc'
    | 'modified-desc'
    | 'modified-asc'
    | 'created-desc'
    | 'created-asc'

  /** Reading face for note content, including headings. */
  editorFont: 'sans' | 'serif'
  /** What Tab inserts inside a code block. */
  codeIndent: 'tab' | '2' | '4'

  /** Default destination for web clips. */
  clipLocation: 'inbox' | 'remember' | 'custom'
  /** Per-workspace folder for clipLocation 'custom', keyed by workspace
   *  root — the destination is a property of each workspace, not global. */
  clipCustomDest: Record<string, string>
  /** Download article images into .assets while clipping. */
  clipDownloadImages: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
  newNoteLocation: 'current',
  autoUpdate: true,
  theme: 'system',
  editorWidth: 'default',
  outlineByDefault: false,
  treeSort: 'name-asc',
  editorFont: 'sans',
  codeIndent: 'tab',
  clipLocation: 'inbox',
  clipDownloadImages: true,
  clipCustomDest: {},
}
