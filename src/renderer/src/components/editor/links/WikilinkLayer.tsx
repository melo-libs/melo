import { useCallback, useEffect, useRef, useState } from 'react'
import i18n from '../../../i18n'
import { useAtomValue, useSetAtom } from 'jotai'
import { Icon } from '../../Icon'
import { FileTypeIcon } from '../../FileTypeIcon'
import { IpcChannels } from '@shared/types/ipc'
import { toast } from '../../Toaster'
import { safeName } from '../../../lib/safeName'
import { activeTabAtom, openFileAtom } from '../../../store/editor'
import { workspacePathAtom } from '../../../store/workspace'
import {
  cachedResolution,
  invalidateResolutions,
  onResolutionsChanged,
  resolveTarget,
  workspaceDisplayPath,
  type ResolvedLink,
} from './resolve'

/* ============================================================
   WikilinkLayer — hover "peek" preview card on .wikilink anchors
   plus click navigation. Document-level listeners, so it covers
   the editor body and backlink snippets. Clicking an existing
   link opens its note; a missing one is created next to the
   current note, then opened.
   ============================================================ */

interface PeekState {
  note: ResolvedLink | null
  target: string
  rect: DOMRect
}

/** Parent directory of an absolute path, tolerant of either separator. */
function parentDirOf(p: string | undefined): string {
  if (!p) return ''
  const cut = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return cut > 0 ? p.slice(0, cut) : ''
}

export function clampToViewport(x: number, y: number, w: number, h: number) {
  const pad = 10
  const nx = Math.min(x, window.innerWidth - w - pad)
  let ny = y
  if (ny + h > window.innerHeight - pad) ny = window.innerHeight - h - pad
  return { x: Math.max(pad, nx), y: Math.max(pad, ny) }
}

function WikilinkPeek({
  peek,
  workspaceRoot,
  onCreate,
  onOpen,
  onEnter,
  onLeave,
}: {
  peek: PeekState | null
  workspaceRoot: string | null
  onCreate: (target: string) => void
  onOpen: (note: ResolvedLink) => void
  onEnter: () => void
  onLeave: () => void
}) {
  if (!peek) return null
  const { note, target, rect } = peek
  const W = 300
  const estH = note ? 196 : 140
  const pos = clampToViewport(rect.left, rect.bottom + 8, W, estH)
  return (
    <div
      className="wl-peek"
      style={{ left: pos.x, top: pos.y, width: W }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      {!note ? (
        <>
          <div className="wl-peek-new">
            <span className="wl-peek-newicon">
              <Icon name="plus" size={15} />
            </span>
            <div>
              <div className="wl-peek-title">{target}</div>
              <div className="wl-peek-newmeta">{i18n.t('links.notCreatedYet')}</div>
            </div>
          </div>
          <button className="wl-peek-cta" onClick={() => onCreate(target)}>
            <Icon name="plus" size={13} /> {i18n.t('links.createNoteBtn')}
          </button>
        </>
      ) : (
        <>
          <div className="wl-peek-head">
            <span className="wl-peek-ft">
              <FileTypeIcon kind="md" size={18} />
            </span>
            <div className="wl-peek-headtext">
              <div className="wl-peek-title">{note.title}</div>
              <div className="wl-peek-path">{workspaceDisplayPath(note.path, workspaceRoot)}</div>
            </div>
          </div>
          <div className="wl-peek-excerpt">{note.excerpt || i18n.t('links.emptyNote')}</div>
          <div className="wl-peek-foot">
            <button className="wl-peek-open" onClick={() => onOpen(note)}>
              {i18n.t('links.openNote')} <Icon name="arrowRight" size={12} />
            </button>
          </div>
        </>
      )}
    </div>
  )
}

export const WikilinkLayer = () => {
  const [peek, setPeek] = useState<PeekState | null>(null)
  const overCard = useRef(false)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const openFile = useSetAtom(openFileAtom)
  const activeTab = useAtomValue(activeTabAtom)
  const workspacePath = useAtomValue(workspacePathAtom)
  const activeTabRef = useRef(activeTab)
  activeTabRef.current = activeTab
  const workspaceRef = useRef(workspacePath)
  workspaceRef.current = workspacePath

  const scheduleHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => {
      if (!overCard.current) setPeek(null)
    }, 140)
  }, [])

  const openNote = useCallback(
    (note: ResolvedLink) => {
      setPeek(null)
      openFile(note.path)
    },
    [openFile],
  )

  // A missing target becomes a real note beside the current one (workspace
  // root when the current tab is untitled), then opens. The watcher refresh
  // also invalidates the cache, but that round-trip is debounced — clear it
  // here so the link repaints as soon as the note exists.
  const createNote = useCallback(
    async (target: string, parentOverride?: string) => {
      setPeek(null)
      const root = workspaceRef.current
      if (!root) return
      const parentPath = parentOverride ?? parentDirOf(activeTabRef.current?.path)
      const name = safeName(target)
      if (!name) return
      const res = await window.api.invoke(IpcChannels.InvokeCreateFile, {
        parentPath: parentPath || root,
        name: `${name}.md`,
      })
      if (!res.success || !res.data) {
        toast(res.error || i18n.t('links.couldNotCreate'))
        return
      }
      invalidateResolutions()
      openFile(res.data.filePath)
    },
    [openFile],
  )

  const hoverTarget = useRef<string | null>(null)
  useEffect(() => {
    const linkOf = (e: Event) =>
      (e.target as HTMLElement | null)?.closest?.('.wikilink') as HTMLElement | null

    const over = (e: MouseEvent) => {
      const a = linkOf(e)
      if (!a) return
      if (hideTimer.current) clearTimeout(hideTimer.current)
      const target = a.getAttribute('data-note') ?? ''
      hoverTarget.current = target
      const rect = a.getBoundingClientRect()
      const cached = cachedResolution(target)
      if (cached !== undefined) {
        setPeek({ note: cached, target, rect })
        return
      }
      // Unknown yet — wait for the index round-trip (ms-scale) instead of
      // flashing a "not created" card that may flip to a preview.
      void resolveTarget(target).then((note) => {
        if (hoverTarget.current === target) setPeek({ note, target, rect })
      })
    }
    const out = (e: MouseEvent) => {
      if (linkOf(e)) {
        hoverTarget.current = null
        scheduleHide()
      }
    }
    const click = (e: MouseEvent) => {
      const a = linkOf(e)
      if (!a) return
      e.preventDefault()
      const target = a.getAttribute('data-note') ?? ''
      // Sample the destination folder now — the user may switch tabs
      // before resolution returns.
      const parent = parentDirOf(activeTabRef.current?.path)
      void resolveTarget(target).then((note) => {
        if (note) openNote(note)
        else void createNote(target, parent)
      })
    }
    document.addEventListener('mouseover', over)
    document.addEventListener('mouseout', out)
    document.addEventListener('click', click)
    return () => {
      document.removeEventListener('mouseover', over)
      document.removeEventListener('mouseout', out)
      document.removeEventListener('click', click)
    }
  }, [scheduleHide, openNote, createNote])

  // Workspace changes can create/rename/delete link targets — drop the
  // cache; open editors re-resolve via the decoration plugin.
  useEffect(() => {
    const off = window.api.on(IpcChannels.OnWorkspaceChanged, () => invalidateResolutions())
    return off
  }, [])

  // Keep an open peek in sync when its resolution lands or flips.
  useEffect(() => {
    if (!peek) return
    return onResolutionsChanged(() => {
      setPeek((p) => {
        if (!p) return p
        const r = cachedResolution(p.target)
        return r === undefined ? p : { ...p, note: r }
      })
    })
  }, [peek])

  useEffect(() => {
    const onScroll = () => setPeek(null)
    window.addEventListener('scroll', onScroll, true)
    return () => window.removeEventListener('scroll', onScroll, true)
  }, [])

  return (
    <WikilinkPeek
      peek={peek}
      workspaceRoot={workspacePath}
      onCreate={(t) => void createNote(t)}
      onOpen={openNote}
      onEnter={() => {
        overCard.current = true
        if (hideTimer.current) clearTimeout(hideTimer.current)
      }}
      onLeave={() => {
        overCard.current = false
        scheduleHide()
      }}
    />
  )
}
