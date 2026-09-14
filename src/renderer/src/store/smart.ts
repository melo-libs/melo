import { atom } from 'jotai'
import { IpcChannels } from '@shared/types/ipc'
import type { SmartRule, SmartViewDef, SmartVocab } from '@shared/types/smart'
import { workspacePathAtom } from './workspace'

/* ============================================================
   Smart folder state — definitions come from .melo/views.json,
   counts and vocabulary from the index. The definitions are the
   single source of truth for rules: rule-bar edits persist
   immediately (macOS smart-folder model), so the sidebar badge,
   the view and the file on disk can never disagree.
   ============================================================ */

const EMPTY_VOCAB: SmartVocab = { tags: [], folders: [], sources: [] }

export const smartFoldersAtom = atom<SmartViewDef[]>([])

/** Active smart folder id; null = the editor column shows the note. */
export const activeSmartIdAtom = atom<string | null>(null)

/** Value options for the builder/rule chips, from the live index. */
export const smartVocabAtom = atom<SmartVocab>(EMPTY_VOCAB)

/** Sidebar badge counts, keyed by folder id. */
export const smartCountsAtom = atom<Record<string, number>>({})

/** Last selected result path per folder id — browsing context survives
 *  a round-trip through the editor and folder switches. */
export const smartSelectionAtom = atom<Record<string, string>>({})

/** Builder modal: null closed, otherwise the initial draft. */
export interface BuilderDraft {
  name: string
  glyph: string
  rules: SmartRule[]
  /** Set when editing an existing folder — save updates it in place. */
  editId?: string
}
export const smartBuilderAtom = atom<BuilderDraft | null>(null)

/** Write-only: load definitions + vocab + counts for the open workspace.
 *  Responses that come back after another workspace took over are
 *  discarded (the root is re-checked around every await). */
export const loadSmartWorkspaceAtom = atom(null, async (get, set) => {
  const workspaceRoot = get(workspacePathAtom)
  set(smartFoldersAtom, [])
  set(smartCountsAtom, {})
  set(smartVocabAtom, EMPTY_VOCAB)
  set(smartSelectionAtom, {})
  if (!workspaceRoot) return
  const res = await window.api.invoke(IpcChannels.InvokeGetSmartViews, { workspaceRoot })
  if (get(workspacePathAtom) !== workspaceRoot) return
  if (!res.success || !res.data) return
  set(smartFoldersAtom, res.data.views)
  await set(refreshSmartMetaAtom)
})

/** Write-only: refresh counts + vocab (index changed under us). */
export const refreshSmartMetaAtom = atom(null, async (get, set) => {
  const workspaceRoot = get(workspacePathAtom)
  const views = get(smartFoldersAtom)
  const [countsRes, vocabRes] = await Promise.all([
    window.api.invoke(IpcChannels.InvokeCountSmartViews, {
      views: views.map((v) => ({ id: v.id, rules: v.rules })),
    }),
    window.api.invoke(IpcChannels.InvokeGetSmartVocab, undefined),
  ])
  if (get(workspacePathAtom) !== workspaceRoot) return
  if (countsRes.success && countsRes.data) set(smartCountsAtom, countsRes.data.counts)
  if (vocabRes.success && vocabRes.data) set(smartVocabAtom, vocabRes.data)
})

/** Write-only: replace the definitions and persist them to views.json.
 *  Returns false (and rolls back) when the write failed — callers keep
 *  their UI open instead of pretending the folder exists. */
export const persistSmartViewsAtom = atom(
  null,
  async (get, set, views: SmartViewDef[]): Promise<boolean> => {
    const workspaceRoot = get(workspacePathAtom)
    if (!workspaceRoot) return false
    const prev = get(smartFoldersAtom)
    set(smartFoldersAtom, views)
    const res = await window.api.invoke(IpcChannels.InvokeSaveSmartViews, {
      workspaceRoot,
      views,
    })
    if (get(workspacePathAtom) !== workspaceRoot) return false
    if (!res.success) {
      set(smartFoldersAtom, prev)
      return false
    }
    await set(refreshSmartMetaAtom)
    return true
  },
)

/** Write-only: delete one smart folder. Leaves the center column on the
 *  editor when the deleted folder was open. */
export const deleteSmartViewAtom = atom(null, async (get, set, id: string): Promise<boolean> => {
  const views = get(smartFoldersAtom)
  const ok = await set(
    persistSmartViewsAtom,
    views.filter((v) => v.id !== id),
  )
  if (!ok) return false
  if (get(activeSmartIdAtom) === id) set(activeSmartIdAtom, null)
  return true
})
