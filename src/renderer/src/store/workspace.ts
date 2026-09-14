import { atom } from 'jotai'
import type { FileNode } from '../components/sidebar/types'

/* ============================================================
   Workspace session — which folder is open and its file tree.
   null path = no workspace yet (the app shows the opener page).
   ============================================================ */

export const workspacePathAtom = atom<string | null>(null)

/** The real on-disk tree (single root = the workspace folder itself). */
export const workspaceTreeAtom = atom<FileNode[]>([])

/** Selected note (absolute path) — shared by the sidebar, search and (later)
 *  the editor. null = nothing selected. */
export const activeNoteAtom = atom<string | null>(null)

/** Selected tree row (file or folder).  Clicking a file sets both this and
 *  activeNoteAtom; clicking a folder only sets this. */
export const treeSelectionAtom = atom<string | null>(null)

/** True while the index is being built/rebuilt after a workspace switch. */
export const indexingAtom = atom(false)

/** Display name of the workspace being switched to, null when idle.
 *  The switcher trigger shows it immediately so the seconds of flush +
 *  tree load + index init don't look like an unresponsive click. */
export const workspaceSwitchingAtom = atom<string | null>(null)

/** Search palette visibility (⌘K). */
export const searchOpenAtom = atom(false)

/** Signal from App.tsx / search palette: "create a new note". */
export const treeCreatingAtom = atom(false)

/** Signal from App.tsx / search palette: "create a new folder". */
export const treeCreatingFolderAtom = atom(false)

/** Inline create input rendered inside a specific folder.
 *  Set to { folderId, type } to show the input; null to hide it. */
export const inlineCreateAtom = atom<{
  folderId: string
  type: 'note' | 'folder'
} | null>(null)

// Recents are stored per workspace — a shared list would let two
// workspaces evict each other's entries, and after a switch the Recent
// section is how users find their way back into what they were doing.
const recentsKey = (ws: string | null) => 'melo.recents:' + (ws ?? '')
const readRecents = (key: string): string[] => {
  try {
    return JSON.parse(localStorage.getItem(key) || '[]')
  } catch {
    return []
  }
}
/** One-time migration from the old shared list: entries under this
 *  workspace seed its per-workspace key on first read. */
const migrateLegacyRecents = (key: string, ws: string): void => {
  if (localStorage.getItem(key) !== null) return
  const legacy = readRecents('melo.recents')
  if (!legacy.length) return
  const mine = legacy.filter((p) => p.startsWith(ws + '/'))
  try {
    localStorage.setItem(key, JSON.stringify(mine))
  } catch {
    /* ignore */
  }
}
const recentsBumpAtom = atom(0)

/** Recently opened notes of the current workspace (absolute paths, most
 *  recent first, max 8). Write with a path to bump it to the front. */
export const recentNotesAtom = atom(
  (get) => {
    get(recentsBumpAtom)
    const ws = get(workspacePathAtom)
    const key = recentsKey(ws)
    if (ws) migrateLegacyRecents(key, ws)
    return readRecents(key)
  },
  (get, set, path: string) => {
    const key = recentsKey(get(workspacePathAtom))
    const next = [path, ...readRecents(key).filter((p) => p !== path)].slice(0, 8)
    try {
      localStorage.setItem(key, JSON.stringify(next))
    } catch {
      /* storage may be unavailable — recents just won't persist */
    }
    set(recentsBumpAtom, (v) => v + 1)
  },
)
