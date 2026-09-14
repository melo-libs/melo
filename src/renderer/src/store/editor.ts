import { atom } from 'jotai'
import { stripMarkdownExtension } from '@shared/fileKinds'

/* ============================================================
   Editor tabs — tracks which files are open, which is active.
   Tab id = absolute file path (guarantees dedup). Untitled notes
   get a synthetic id like "untitled-1".
   ============================================================ */

export type SaveStatus = 'saved' | 'saving' | 'error'

export interface EditorTab {
  id: string
  title: string
  path: string
  dirty: boolean
  /** Per-tab save state, written by the document session at save cadence
   *  (not per keystroke). lastSavedAt starts as the file's mtime. */
  saveStatus: SaveStatus
  lastSavedAt: number | null
}

export const wordCountAtom = atom(0)

export const tabsAtom = atom<EditorTab[]>([])
export const activeTabIdAtom = atom<string | null>(null)

export const activeTabAtom = atom((get) => {
  const id = get(activeTabIdAtom)
  return get(tabsAtom).find((t) => t.id === id) ?? null
})

let untitledSeq = 0

/** Write-only: opens a file in a tab (or focuses it if already open). */
export const openFileAtom = atom(null, (get, set, filePath: string) => {
  const tabs = get(tabsAtom)
  const existing = tabs.find((t) => t.id === filePath)
  if (existing) {
    set(activeTabIdAtom, filePath)
    return
  }
  const basename = filePath.split('/').pop() ?? filePath
  const title = stripMarkdownExtension(basename)
  const newTab: EditorTab = {
    id: filePath,
    title,
    path: filePath,
    dirty: false,
    saveStatus: 'saved',
    lastSavedAt: null,
  }
  set(tabsAtom, [...tabs, newTab])
  set(activeTabIdAtom, filePath)
})

/** Write-only: close a tab. */
export const closeTabAtom = atom(null, (get, set, tabId: string) => {
  const tabs = get(tabsAtom)
  const next = tabs.filter((t) => t.id !== tabId)
  set(tabsAtom, next)
  if (get(activeTabIdAtom) === tabId) {
    set(activeTabIdAtom, next.length ? next[next.length - 1].id : null)
  }
})

/** Write-only: create an untitled tab. Returns the new tab id. */
export const newTabAtom = atom(null, (_get, set) => {
  const id = `untitled-${++untitledSeq}`
  const tab: EditorTab = {
    id,
    title: 'Untitled',
    path: '',
    dirty: false,
    saveStatus: 'saved',
    lastSavedAt: null,
  }
  set(tabsAtom, (ts) => [...ts, tab])
  set(activeTabIdAtom, id)
  return id
})

/** Write-only: promote an untitled tab to a real-file tab after Save As. */
export const promoteTabAtom = atom(
  null,
  (get, set, { oldId, filePath }: { oldId: string; filePath: string }) => {
    const basename = filePath.split('/').pop() ?? filePath
    const title = stripMarkdownExtension(basename)
    set(
      tabsAtom,
      get(tabsAtom).map((t) =>
        t.id === oldId
          ? {
              id: filePath,
              title,
              path: filePath,
              dirty: false,
              saveStatus: 'saved' as const,
              lastSavedAt: Date.now(),
            }
          : t,
      ),
    )
    if (get(activeTabIdAtom) === oldId) {
      set(activeTabIdAtom, filePath)
    }
  },
)

/** Write-only: merge save state into a tab. The document session calls
 *  this on save-cadence transitions only; the unchanged-check keeps
 *  per-keystroke dirty notifications from rebuilding tabsAtom. */
export const setTabSaveStateAtom = atom(
  null,
  (
    get,
    set,
    patch: { id: string; dirty?: boolean; saveStatus?: SaveStatus; lastSavedAt?: number | null },
  ) => {
    const tabs = get(tabsAtom)
    const tab = tabs.find((t) => t.id === patch.id)
    if (!tab) return
    const changed =
      (patch.dirty !== undefined && patch.dirty !== tab.dirty) ||
      (patch.saveStatus !== undefined && patch.saveStatus !== tab.saveStatus) ||
      (patch.lastSavedAt !== undefined && patch.lastSavedAt !== tab.lastSavedAt)
    if (!changed) return
    set(
      tabsAtom,
      tabs.map((t) => (t.id === patch.id ? { ...t, ...patch, id: t.id } : t)),
    )
  },
)
