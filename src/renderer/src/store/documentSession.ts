import type { Editor } from '@tiptap/core'
import i18n from '../i18n'
import { appStore } from './appStore'
import { setTabSaveStateAtom, promoteTabAtom, type SaveStatus } from './editor'
import { toast } from '../components/Toaster'
import { splitFrontmatter } from '../lib/frontmatter'
import { createSaveScheduler, type SaveScheduler } from '../lib/saveScheduler'
import { stripMarkdownExtension } from '@shared/fileKinds'

/* ============================================================
   Document sessions — the single owner of everything "save".

   One session per open tab holds the file's frontmatter, the last
   saved baseline, the disk mtime, dirty state and the save timers.
   Components only decide WHEN to call (edit notifications, Cmd+S,
   tab switch, close) and what dialogs to show; all state and the
   write path live here. Tab-visible state (dirty / saveStatus /
   lastSavedAt) is mirrored into tabsAtom through the explicit
   appStore, since this module runs outside React.

   Identity note: `displayedId` tracks which document the editor
   REALLY shows right now. It is set by EditorPage only after the
   document's body has been applied — never assume the active tab id
   equals the displayed document during a switch, that's how content
   ends up saved into the wrong file.
   ============================================================ */

const IDLE_MS = 10_000
const MAX_WAIT_MS = 60_000

export function getMarkdown(editor: Editor): string {
  return (editor as unknown as { getMarkdown?: () => string }).getMarkdown?.() ?? editor.getText()
}

interface Session {
  id: string
  kind: 'file' | 'untitled'
  frontmatter: string
  /** Last content known to be on disk. null = no successful load/save yet,
   *  in which case the session never writes (a failed read must not lead
   *  to overwriting the file with an empty document). */
  baseline: string | null
  /** Latest body snapshot for non-displayed sessions and untitled buffers. */
  content: string | null
  mtime: number | null
  dirty: boolean
  dirtyRev: number
  /** Tombstone: closed sessions ignore late async completions. */
  closed: boolean
  scheduler: SaveScheduler
  saving: Promise<boolean> | null
  errorToasted: boolean
  warnedExternalMtime: number | null
  loadToken: number
}

const sessions = new Map<string, Session>()
/** The document the editor currently displays (set post-apply). */
let displayedId: string | null = null
let activeEditor: Editor | null = null
/** Registered by EditorPage: knows how to put a reloaded body into the
 *  editor (setContent + state rebuild + recounts). */
let reloadApplier: ((body: string) => void) | null = null

const isUntitled = (id: string) => id.startsWith('untitled-')

const setTabState = (patch: {
  id: string
  dirty?: boolean
  saveStatus?: SaveStatus
  lastSavedAt?: number | null
}) => appStore.set(setTabSaveStateAtom, patch)

function tabTitle(id: string): string {
  const base = id.split('/').pop() ?? id
  return stripMarkdownExtension(base)
}

function ensure(id: string): Session {
  let s = sessions.get(id)
  if (!s) {
    s = {
      id,
      kind: isUntitled(id) ? 'untitled' : 'file',
      frontmatter: '',
      baseline: null,
      content: null,
      mtime: null,
      dirty: false,
      dirtyRev: 0,
      closed: false,
      scheduler: createSaveScheduler(() => void save(id), IDLE_MS, MAX_WAIT_MS),
      saving: null,
      errorToasted: false,
      warnedExternalMtime: null,
      loadToken: 0,
    }
    sessions.set(id, s)
  }
  return s
}

/** The (single) editor instance, registered once by EditorPage. */
export function attachEditor(editor: Editor | null): void {
  activeEditor = editor
}

export function registerReloadApplier(fn: ((body: string) => void) | null): void {
  reloadApplier = fn
}

/** EditorPage calls this after a document's body has been applied to the
 *  editor — from that moment edits and snapshots belong to `id`. */
export function setDisplayedSession(id: string | null): void {
  displayedId = id
}

/** Snapshot the displayed document into its session — call before the
 *  editor's content is replaced (tab switch), so saves and Save As never
 *  depend on the editor still showing this document. */
export function snapshotDisplayed(): void {
  if (!displayedId || !activeEditor) return
  const s = sessions.get(displayedId)
  if (!s || s.closed) return
  s.content = getMarkdown(activeEditor)
}

/** Edit notification from the editor's update event. */
export function noteEdited(): void {
  if (!displayedId) return
  const s = ensure(displayedId)
  if (s.closed) return
  s.dirty = true
  s.dirtyRev++
  setTabState({ id: s.id, dirty: true })
  if (s.kind === 'file' && s.baseline !== null) s.scheduler.edited()
}

/** Document body + frontmatter for showing `id` in the editor. Cached
 *  session state wins (it may hold unsaved edits — switching back to a
 *  tab must never clobber them with disk content); disk is read only on
 *  first activation. Returns null when a first read fails — the caller
 *  must treat the document as not editable-for-saving. */
export async function activateSession(
  id: string,
): Promise<{ body: string; frontmatter: string } | null> {
  const s = ensure(id)
  if (s.kind === 'untitled') return { body: s.content ?? '', frontmatter: '' }
  if (s.baseline !== null) {
    return { body: s.content ?? s.baseline, frontmatter: s.frontmatter }
  }
  return loadFile(id)
}

/** First-time (or explicit re-)load of a file session from disk. */
async function loadFile(id: string): Promise<{ body: string; frontmatter: string } | null> {
  const s = ensure(id)
  const token = ++s.loadToken
  try {
    const res = await window.api.invoke(window.api.channels.InvokeReadFile, { filePath: id })
    if (s.closed || token !== s.loadToken) return null
    if (!res.success || !res.data) throw new Error(res.success ? 'empty response' : res.error)
    const { frontmatter, body } = splitFrontmatter(res.data.content)
    s.frontmatter = frontmatter
    s.baseline = body
    s.content = body
    s.mtime = res.data.mtime
    s.dirty = false
    s.errorToasted = false
    setTabState({ id, dirty: false, saveStatus: 'saved', lastSavedAt: res.data.mtime })
    return { body, frontmatter }
  } catch (err) {
    if (s.closed || token !== s.loadToken) return null
    s.baseline = null
    setTabState({ id, saveStatus: 'error' })
    toast(i18n.t('session.couldNotRead', { title: tabTitle(id) }))
    console.error('[session] read failed:', err)
    return null
  }
}

/** Write a file session to disk if its content differs from the baseline.
 *  Serializes concurrent calls; late completions on closed sessions only
 *  skip state updates (the bytes are already on their way). */
function save(id: string): Promise<boolean> {
  const s = sessions.get(id)
  if (!s || s.kind !== 'file') return Promise.resolve(true)

  const run = async (): Promise<boolean> => {
    if (s.baseline === null) return false
    const body = id === displayedId && activeEditor ? getMarkdown(activeEditor) : s.content
    if (body === null) return true
    const rev = s.dirtyRev
    if (body === s.baseline) {
      if (!s.closed && s.dirtyRev === rev) {
        s.dirty = false
        setTabState({ id, dirty: false, saveStatus: 'saved' })
      }
      return true
    }
    if (!s.closed) setTabState({ id, saveStatus: 'saving' })
    try {
      const res = await window.api.invoke(window.api.channels.InvokeSaveFile, {
        content: s.frontmatter ? s.frontmatter + body : body,
        filePath: id,
      })
      if (!res.success || !res.data) throw new Error(res.success ? 'empty response' : res.error)
      s.baseline = body
      s.mtime = res.data.mtime
      s.errorToasted = false
      // Only sync `content` and clear dirty if no newer edit arrived while
      // this save was in flight — a newer snapshot must survive it.
      if (s.dirtyRev === rev) {
        s.content = body
        s.dirty = false
        if (!s.closed)
          setTabState({ id, dirty: false, saveStatus: 'saved', lastSavedAt: Date.now() })
      } else if (!s.closed) {
        setTabState({ id, saveStatus: 'saved', lastSavedAt: Date.now() })
      }
      return true
    } catch (err) {
      console.error('[session] write failed:', err)
      if (!s.closed) {
        setTabState({ id, saveStatus: 'error' })
        if (!s.errorToasted) {
          s.errorToasted = true
          toast(i18n.t('session.couldNotSaveFile', { title: tabTitle(id) }))
        }
      }
      return false
    }
  }

  const prev = s.saving ?? Promise.resolve(true)
  const p = prev.then(run, run)
  const wrapped = p.finally(() => {
    if (s.saving === wrapped) s.saving = null
  })
  s.saving = wrapped
  return p
}

/** Cancel pending timers and save now. */
export function flush(id: string): Promise<boolean> {
  const s = sessions.get(id)
  if (!s || s.kind !== 'file') return Promise.resolve(true)
  s.scheduler.cancel()
  return save(id)
}

/** Flush every file session; resolves with the ids that failed. */
export async function flushAll(): Promise<string[]> {
  const ids = [...sessions.values()].filter((s) => s.kind === 'file').map((s) => s.id)
  const results = await Promise.all(ids.map((id) => flush(id)))
  return ids.filter((_, i) => !results[i])
}

/** Close a session. Default: flush file sessions first (tab close keeps
 *  the "save on close" behavior) — if that save FAILS the session stays
 *  alive and false is returned, so callers can keep the tab open instead
 *  of dropping unsaved content. discard: skip the final save, drop the
 *  timers and mark the tab clean — used for delete-file and "Don't Save".
 *  Awaits any in-flight write so a caller deleting the file afterwards
 *  can't race it. */
export async function closeSession(id: string, opts?: { discard?: boolean }): Promise<boolean> {
  const s = sessions.get(id)
  if (!s) return true
  s.scheduler.cancel()
  if (!opts?.discard && s.kind === 'file' && s.dirty) {
    const ok = await save(id)
    if (!ok) return false
  }
  s.closed = true
  if (s.saving) await s.saving.catch(() => undefined)
  sessions.delete(id)
  if (id === displayedId) displayedId = null
  if (opts?.discard) setTabState({ id, dirty: false, saveStatus: 'saved' })
  return true
}

/** Current body content — editor for the displayed session, snapshot
 *  otherwise. Used by Save As and the untitled dialogs. */
export function getContent(id: string): string {
  if (id === displayedId && activeEditor) return getMarkdown(activeEditor)
  return sessions.get(id)?.content ?? ''
}

/** Migrate an untitled session into a real-file session after Save As.
 *  The just-written content becomes the new baseline. */
export async function promoteUntitled(oldId: string, filePath: string): Promise<void> {
  const body = getContent(oldId)
  const old = sessions.get(oldId)
  if (old) {
    old.closed = true
    old.scheduler.cancel()
    sessions.delete(oldId)
  }
  const s = ensure(filePath)
  s.frontmatter = ''
  s.baseline = body
  s.content = body
  s.dirty = false
  appStore.set(promoteTabAtom, { oldId, filePath })
  if (displayedId === oldId) displayedId = filePath
  try {
    const res = await window.api.invoke(window.api.channels.InvokeGetFileStats, { filePath })
    if (res.success && res.data) s.mtime = res.data.mtime
  } catch {
    // mtime stays null; the next save fills it in.
  }
}

/** External-change check for the displayed file, called on watcher events.
 *  Newer file on disk + no local edits → reload silently; local edits
 *  pending → warn once per disk state, the next save wins (last writer).
 *  Everything is re-validated after each await — the user may have typed
 *  or switched tabs while we were reading. */
export async function reconcileActiveWithDisk(): Promise<void> {
  const id = displayedId
  if (!id || isUntitled(id)) return
  const s = sessions.get(id)
  if (!s || s.mtime === null) return

  let diskMtime: number
  try {
    const res = await window.api.invoke(window.api.channels.InvokeGetFileStats, { filePath: id })
    if (!res.success || !res.data) return
    diskMtime = res.data.mtime
  } catch {
    return
  }
  // Small slack: filesystems round mtime, and our own save already
  // recorded the post-write value.
  if (diskMtime <= (s.mtime ?? 0) + 2) return

  if (s.dirty || s.saving) {
    if (s.warnedExternalMtime !== diskMtime) {
      s.warnedExternalMtime = diskMtime
      toast(i18n.t('session.changedOnDisk', { title: tabTitle(id) }))
    }
    return
  }

  const revBefore = s.dirtyRev
  let content: string
  let mtime: number
  try {
    const res = await window.api.invoke(window.api.channels.InvokeReadFile, { filePath: id })
    if (!res.success || !res.data) return
    content = res.data.content
    mtime = res.data.mtime
  } catch {
    return
  }
  // Re-validate: still the displayed doc, still clean, no save started.
  if (s.closed || displayedId !== id || s.dirty || s.saving || s.dirtyRev !== revBefore) return

  const { frontmatter, body } = splitFrontmatter(content)
  s.frontmatter = frontmatter
  s.baseline = body
  s.content = body
  s.mtime = mtime
  setTabState({ id, dirty: false, saveStatus: 'saved', lastSavedAt: mtime })
  reloadApplier?.(body)
}

/** Rebuild a file session from disk (e.g. after a failed delete left the
 *  tab open but its session discarded). */
export function reviveFromDisk(id: string): Promise<{ body: string; frontmatter: string } | null> {
  return loadFile(id)
}

/** Frontmatter of a session (ClipBanner and save need it). */
export function getFrontmatter(id: string): string {
  return sessions.get(id)?.frontmatter ?? ''
}
