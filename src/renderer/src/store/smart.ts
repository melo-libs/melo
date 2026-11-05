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

/** Workspace currently owned by the smart-folder state. This is tracked
 *  separately from loaded definitions because an intentionally empty
 *  views.json is valid state, not a loading sentinel. */
const smartWorkspaceRootAtom = atom<string | null>(null)
const smartLoadGenerationAtom = atom(0)
const smartMetaGenerationAtom = atom(0)

export const smartRevisionAtom = atom('')
export const smartSaveErrorAtom = atom<string | null>(null)

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
const smartBuilderDraftAtom = atom<(BuilderDraft & { revision: string }) | null>(null)
export const smartBuilderAtom = atom(
  (get) => get(smartBuilderDraftAtom),
  (get, set, draft: BuilderDraft | null) =>
    set(smartBuilderDraftAtom, draft ? { ...draft, revision: get(smartRevisionAtom) } : null),
)

/** Write-only: load definitions + vocab + counts for the open workspace.
 *  Responses that come back after another workspace took over are
 *  discarded (the root is re-checked around every await). */
export const loadSmartWorkspaceAtom = atom(null, async (get, set) => {
  const workspaceRoot = get(workspacePathAtom)
  if (get(smartWorkspaceRootAtom) !== workspaceRoot) {
    set(smartWorkspaceRootAtom, workspaceRoot)
    set(smartFoldersAtom, [])
    set(smartRevisionAtom, '')
    set(smartBuilderDraftAtom, null)
    set(smartCountsAtom, {})
    set(smartVocabAtom, EMPTY_VOCAB)
    set(smartSelectionAtom, {})
    set(activeSmartIdAtom, null)
  }
  if (!workspaceRoot) return false
  const generation = get(smartLoadGenerationAtom) + 1
  set(smartLoadGenerationAtom, generation)
  const res = await window.api.invoke(IpcChannels.InvokeGetSmartViews, { workspaceRoot })
  if (get(workspacePathAtom) !== workspaceRoot || get(smartLoadGenerationAtom) !== generation)
    return false
  if (!res.success || !res.data) return false
  set(smartFoldersAtom, res.data.views)
  set(smartRevisionAtom, res.data.revision)
  const activeId = get(activeSmartIdAtom)
  if (activeId && !res.data.views.some((view) => view.id === activeId)) set(activeSmartIdAtom, null)
  await set(refreshSmartMetaAtom)
  return true
})

/** Write-only: refresh counts + vocab (index changed under us). */
export const refreshSmartMetaAtom = atom(null, async (get, set) => {
  const workspaceRoot = get(workspacePathAtom)
  const views = get(smartFoldersAtom)
  const generation = get(smartMetaGenerationAtom) + 1
  set(smartMetaGenerationAtom, generation)
  const [countsRes, vocabRes] = await Promise.all([
    window.api.invoke(IpcChannels.InvokeCountSmartViews, {
      views: views
        .filter((view) => view.preset !== 'recent')
        .map((view) => ({ id: view.id, rules: view.rules })),
    }),
    window.api.invoke(IpcChannels.InvokeGetSmartVocab, undefined),
  ])
  if (
    get(workspacePathAtom) !== workspaceRoot ||
    get(smartMetaGenerationAtom) !== generation ||
    get(smartFoldersAtom) !== views
  )
    return
  if (countsRes.success && countsRes.data) set(smartCountsAtom, countsRes.data.counts)
  if (vocabRes.success && vocabRes.data) set(smartVocabAtom, vocabRes.data)
})

/** Write-only: replace the definitions and persist them to views.json.
 *  Returns false without replacing the current definitions when the write failed — callers keep
 *  their UI open instead of pretending the folder exists. */
export const persistSmartViewsAtom = atom(
  null,
  async (
    get,
    set,
    input: SmartViewDef[] | { views: SmartViewDef[]; revision: string },
  ): Promise<boolean> => {
    const workspaceRoot = get(workspacePathAtom)
    if (!workspaceRoot) return false
    const views = Array.isArray(input) ? input : input.views
    const expectedRevision = Array.isArray(input) ? get(smartRevisionAtom) : input.revision
    set(smartSaveErrorAtom, null)
    const generation = get(smartLoadGenerationAtom) + 1
    set(smartLoadGenerationAtom, generation)
    const res = await window.api.invoke(IpcChannels.InvokeSaveSmartViews, {
      workspaceRoot,
      views,
      expectedRevision,
    })
    if (get(workspacePathAtom) !== workspaceRoot) return false
    if (!res.success || !res.data) {
      set(smartSaveErrorAtom, res.error ?? 'Could not save Smart Folder')
      if (res.error === 'SMART_VIEWS_CONFLICT') await set(loadSmartWorkspaceAtom)
      return false
    }
    if (get(smartLoadGenerationAtom) === generation) {
      set(smartFoldersAtom, res.data.views)
      set(smartRevisionAtom, res.data.revision)
      await set(refreshSmartMetaAtom)
    }
    return true
  },
)

/** Write-only: delete one smart folder. Leaves the center column on the
 *  editor when the deleted folder was open. */
export const deleteSmartViewAtom = atom(
  null,
  async (get, set, input: string | { id: string; revision: string }): Promise<boolean> => {
    const id = typeof input === 'string' ? input : input.id
    const revision = typeof input === 'string' ? get(smartRevisionAtom) : input.revision
    const views = get(smartFoldersAtom)
    const ok = await set(persistSmartViewsAtom, {
      views: views.filter((v) => v.id !== id),
      revision,
    })
    if (!ok) return false
    if (get(activeSmartIdAtom) === id) set(activeSmartIdAtom, null)
    return true
  },
)
