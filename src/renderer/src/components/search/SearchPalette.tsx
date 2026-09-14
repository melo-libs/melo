import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import i18n from '../../i18n'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { IpcChannels } from '@shared/types/ipc'
import { cn } from '../../lib/cn'
import { appStore } from '../../store/appStore'
import { settingsAtom } from '../../store/settings'
import { toast } from '../Toaster'
import { activeSmartIdAtom } from '../../store/smart'
import {
  activeNoteAtom,
  indexingAtom,
  recentNotesAtom,
  searchOpenAtom,
  treeSelectionAtom,
  workspacePathAtom,
  workspaceTreeAtom,
} from '../../store/workspace'
import { findNode } from '../sidebar/treeOps'
import { FileTypeIcon } from '../FileTypeIcon'
import { QIcon, HiText, HiRanges, KIND_LABEL } from './SearchIcon'
import { renderPreviewHtml } from './previewMarkdown'
import { SearchField, SearchTips } from './SearchField'
import {
  COMMANDS,
  cmdTitle,
  cmdHint,
  runSearch,
  termRanges,
  type SearchFile,
  type SearchItem,
  type SearchResult,
} from './searchEngine'
import './search.scss'

/* ============================================================
   SearchPalette — the ⌘K spotlight (design direction B): results
   on the left, a live preview of the highlighted result on the
   right. Ask Melo is shown as a non-interactive product preview
   until the workspace-wide assistant is available.
   ============================================================ */

type Row =
  | { kind: 'head'; label: string }
  | { kind: 'file'; file: SearchFile; nav: true }
  | { kind: 'command'; cmd: (typeof COMMANDS)[number]; nav: true }
  | { kind: 'asknotice'; nav: false }
  | { kind: 'item'; it: SearchItem; nav: true }
  | { kind: 'more'; count: number; nav: false }
  | { kind: 'none'; nav: false }

type NavRow = Extract<Row, { nav: true }>

type Preview =
  | { type: 'file'; file: SearchFile; terms: string[] }
  | { type: 'command'; cmd: (typeof COMMANDS)[number] }
  | null

function isWebUrl(raw: string): { url: string; host: string } | null {
  try {
    const u = new URL(raw.includes('://') ? raw : `https://${raw}`)
    if (!/\./.test(u.hostname)) return null
    if (!/^https?:$/.test(u.protocol)) return null
    return { url: u.href, host: u.hostname.replace(/^www\./, '') }
  } catch {
    return null
  }
}

function domainHue(domain: string) {
  let h = 0
  for (let i = 0; i < domain.length; i++) h = (h * 31 + domain.charCodeAt(i)) % 360
  return 20 + (h % 60) + (h % 3) * 70
}

const relTime = (ms?: number) => {
  if (!ms) return null
  const d = Date.now() - ms
  const m = Math.floor(d / 60000)
  if (m < 1) return i18n.t('search.justNow')
  if (m < 60) return i18n.t('search.minutesAgoShort', { count: m })
  const h = Math.floor(m / 60)
  if (h < 24) return i18n.t('search.hoursAgoShort', { count: h })
  const days = Math.floor(h / 24)
  return days < 14
    ? i18n.t('search.daysAgoShort', { count: days })
    : i18n.t('search.weeksAgoShort', { count: Math.floor(days / 7) })
}

const rowKey = (r: NavRow): string => {
  if (r.kind === 'file') return 'recent:' + r.file.id
  if (r.kind === 'command') return 'cmd:' + r.cmd.id
  const it = r.it
  if (it.type === 'file') return it.file.id
  return 'cmd:' + it.id
}

/* Memoized result row — while typing and on arrow-key moves the row data
   keeps its identity, so only the rows whose `isActive` flips re-render. */
interface PaletteRowProps {
  row: NavRow
  index: number
  isActive: boolean
  onHover: (index: number) => void
  onChoose: (index: number) => void
}

const PaletteRow = React.memo(function PaletteRow({
  row,
  index,
  isActive,
  onHover,
  onChoose,
}: PaletteRowProps) {
  // Subscribes this memoized row to i18n so an open palette follows a live
  // language switch (memo props don't change on languageChanged).
  useTranslation()
  const rowProps = {
    'data-active': isActive,
    onMouseMove: () => onHover(index),
    onClick: () => onChoose(index),
  }
  if (row.kind === 'file')
    return (
      <div className={cn('pb-row', isActive && 'active')} {...rowProps}>
        <span className="pb-row-ft">
          <FileTypeIcon kind={row.file.kind} size={22} bare />
        </span>
        <div className="pb-row-main">
          <div className="pb-row-title">{row.file.name}</div>
          {row.file.path && <div className="pb-row-sub">{row.file.path}</div>}
        </div>
      </div>
    )
  if (row.kind === 'command')
    return (
      <div className={cn('pb-row', isActive && 'active')} {...rowProps}>
        <span className="pb-row-ic accent">
          <QIcon name={row.cmd.icon} size={16} />
        </span>
        <div className="pb-row-main">
          <div className="pb-row-title">{cmdTitle(row.cmd.id)}</div>
        </div>
        {row.cmd.keys && (
          <span className="pb-row-keys">
            {row.cmd.keys.map((k, j) => (
              <kbd key={j}>{k}</kbd>
            ))}
          </span>
        )}
      </div>
    )
  const it = row.it
  if (it.type === 'file')
    return (
      <div className={cn('pb-row', isActive && 'active')} {...rowProps}>
        <span className="pb-row-ft">
          <FileTypeIcon kind={it.file.kind} size={22} bare />
        </span>
        <div className="pb-row-main">
          <div className="pb-row-title">
            <HiText text={it.file.name} positions={it.titlePositions} />
          </div>
          <div className="pb-row-sub">
            {it.snippet ? (
              <HiRanges text={it.snippet.text} ranges={it.snippet.ranges} />
            ) : (
              it.file.path
            )}
          </div>
        </div>
      </div>
    )
  if (it.type === 'command') {
    const c = COMMANDS.find((x) => x.id === it.id)
    if (!c) return null
    return (
      <div className={cn('pb-row', isActive && 'active')} {...rowProps}>
        <span className="pb-row-ic accent">
          <QIcon name={c.icon} size={16} />
        </span>
        <div className="pb-row-main">
          <div className="pb-row-title">
            <HiText text={it.title} positions={it.titlePositions} />
          </div>
        </div>
      </div>
    )
  }
  return null
})

export const SearchPalette = () => {
  const { i18n: i18nSub } = useTranslation()
  const [open, setOpen] = useAtom(searchOpenAtom)
  const tree = useAtomValue(workspaceTreeAtom)
  const workspacePath = useAtomValue(workspacePathAtom)
  const setActiveNote = useSetAtom(activeNoteAtom)
  const setTreeSelection = useSetAtom(treeSelectionAtom)
  const setActiveSmartId = useSetAtom(activeSmartIdAtom)
  const indexing = useAtomValue(indexingAtom)
  const [recents, pushRecent] = useAtom(recentNotesAtom)

  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [result, setResult] = useState<SearchResult | null>(null)
  const [allTags, setAllTags] = useState<{ tag: string; count: number }[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const clipRef = useRef<{ submit: () => void }>(null)

  const empty = query.trim() === ''

  // Reset + fetch tag vocabulary each open.
  useEffect(() => {
    if (!open) return
    setQuery('')
    setResult(null)
    setActive(0)
    window.api.invoke(IpcChannels.InvokeGetAllTags, undefined).then((res) => {
      if (res.success && res.data) setAllTags(res.data.tags)
    })
  }, [open])

  // Debounced async search (titles are local, full text hits the index).
  useEffect(() => {
    if (!open || empty) {
      setResult(null)
      return
    }
    let alive = true
    const t = setTimeout(() => {
      runSearch(query, tree).then((r) => {
        if (alive) setResult(r)
      })
    }, 120)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [query, open, tree, empty, i18nSub.language])

  const folderWords = useMemo(() => {
    const set = new Set<string>()
    const walk = (nodes: typeof tree) =>
      nodes.forEach((n) => {
        if (n.kind === 'folder') {
          n.name
            .toLowerCase()
            .split(/[\s/]+/)
            .forEach((w) => w.length >= 3 && set.add(w))
          walk(n.children ?? [])
        }
      })
    walk(tree)
    return [...set]
  }, [tree])

  const recentFiles = useMemo(
    () =>
      recents
        .map((p) => findNode(tree, p))
        .filter((n): n is NonNullable<typeof n> => !!n && n.kind !== 'folder')
        .map(
          (n) => ({ id: n.id, name: n.name, kind: n.kind, path: '', mtime: n.mtime }) as SearchFile,
        ),
    [recents, tree],
  )

  const urlMatch = useMemo(() => isWebUrl(query.trim()), [query])
  const isClip = !!urlMatch

  const flat = useMemo<Row[]>(() => {
    const rows: Row[] = []
    if (empty) {
      if (recentFiles.length) {
        rows.push({ kind: 'head', label: i18n.t('search.groups.recent') })
        recentFiles.slice(0, 5).forEach((f) => rows.push({ kind: 'file', file: f, nav: true }))
      }
      rows.push({ kind: 'asknotice', nav: false })
      rows.push({ kind: 'head', label: i18n.t('search.groups.commands') })
      ;['new-note', 'new-folder', 'settings'].forEach((cid) => {
        const c = COMMANDS.find((x) => x.id === cid)
        if (c) rows.push({ kind: 'command', cmd: c, nav: true })
      })
    } else if (result) {
      result.groups.forEach((g) => {
        if (g.label) rows.push({ kind: 'head', label: g.label })
        g.items.forEach((it) => rows.push({ kind: 'item', it, nav: true }))
        if (g.hidden) rows.push({ kind: 'more', count: g.hidden, nav: false })
      })
      if (!result.total && !urlMatch) rows.push({ kind: 'none', nav: false })
    }
    return rows
  }, [empty, result, recentFiles, urlMatch, i18nSub.language])

  const navIdx = useMemo(
    () => flat.map((r, i) => ('nav' in r && r.nav ? i : -1)).filter((i) => i >= 0),
    [flat],
  )
  useEffect(() => setActive(0), [query, result])
  const activeRowIndex = navIdx[Math.min(active, Math.max(0, navIdx.length - 1))]

  const inboxId = useMemo(() => {
    const inbox = tree.find((n) => n.system === 'inbox')
    return inbox?.id ?? workspacePath
  }, [tree, workspacePath])

  const close = useCallback(() => setOpen(false), [setOpen])
  const openFile = useCallback(
    (id: string) => {
      setActiveNote(id)
      setTreeSelection(id)
      setActiveSmartId(null)
      pushRecent(id)
      close()
    },
    [setActiveNote, setTreeSelection, setActiveSmartId, pushRecent, close],
  )
  const runCommand = useCallback(
    (id: string) => {
      close()
      if (id === 'new-note') window.dispatchEvent(new CustomEvent('melo:new-note'))
      else if (id === 'new-folder') window.dispatchEvent(new CustomEvent('melo:new-folder'))
      else if (id === 'theme') window.dispatchEvent(new CustomEvent('melo:toggle-theme'))
      else if (id === 'sidebar') window.dispatchEvent(new CustomEvent('melo:toggle-sidebar'))
      else if (id === 'settings')
        void window.api.invoke(IpcChannels.InvokeOpenSettingsWindow, undefined)
    },
    [close],
  )

  const move = (d: number) => {
    if (navIdx.length) setActive((a) => (a + d + navIdx.length) % navIdx.length)
  }
  const choose = useCallback(
    (rowIndex: number | undefined) => {
      if (rowIndex == null) return
      const r = flat[rowIndex]
      if (!r) return
      if (r.kind === 'file') openFile(r.file.id)
      else if (r.kind === 'command') runCommand(r.cmd.id)
      else if (r.kind === 'item') {
        const it = r.it
        if (it.type === 'file') openFile(it.file.id)
        else if (it.type === 'command') runCommand(it.id)
      }
    },
    [flat, openFile, runCommand],
  )
  const hoverRow = useCallback((i: number) => setActive(navIdx.indexOf(i)), [navIdx])
  const onKey = (e: React.KeyboardEvent) => {
    if (isClip) {
      if (e.key === 'Enter') {
        e.preventDefault()
        clipRef.current?.submit()
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
        return
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      move(1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      move(-1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      choose(activeRowIndex)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
  }

  useEffect(() => {
    if (!listRef.current) return
    const el = listRef.current.querySelector('[data-active="true"]')
    if (el) {
      const r = el.getBoundingClientRect()
      const pr = listRef.current.getBoundingClientRect()
      if (r.bottom > pr.bottom) listRef.current.scrollTop += r.bottom - pr.bottom + 8
      else if (r.top < pr.top) listRef.current.scrollTop -= pr.top - r.top + 8
    }
  }, [activeRowIndex])

  // the active payload (for the preview pane)
  const activeRow = activeRowIndex != null ? flat[activeRowIndex] : undefined
  let preview: Preview = null
  if (activeRow) {
    if (activeRow.kind === 'file') preview = { type: 'file', file: activeRow.file, terms: [] }
    else if (activeRow.kind === 'command') preview = { type: 'command', cmd: activeRow.cmd }
    else if (activeRow.kind === 'item') {
      const it = activeRow.it
      if (it.type === 'file')
        preview = { type: 'file', file: it.file, terms: result?.parsed.terms ?? [] }
      else if (it.type === 'command') {
        const cmd = COMMANDS.find((x) => x.id === it.id)
        if (cmd) preview = { type: 'command', cmd }
      }
    }
  }

  const handleClipSaved = useCallback(
    (filePath: string, title: string, openAfter: boolean) => {
      toast(i18n.t('search.savedToast', { title }))
      close()
      if (openAfter) openFile(filePath)
    },
    [close, openFile],
  )

  if (!open) return null

  return (
    <div
      className="pb-scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div className="pb-panel" onKeyDown={onKey}>
        <SearchField
          query={query}
          setQuery={setQuery}
          inputRef={inputRef}
          trailing={
            indexing
              ? i18n.t('search.indexing')
              : isClip || empty || !result
                ? ''
                : i18n.t('search.resultCount', { count: result.total })
          }
          allTags={allTags}
          folderWords={folderWords}
        />

        <div className={cn('pb-body', isClip && 'pb-body-clip')}>
          {isClip ? (
            <ClipPanel
              ref={clipRef}
              url={urlMatch.url}
              host={urlMatch.host}
              workspacePath={workspacePath}
              inboxId={inboxId}
              tree={tree}
              onSaved={handleClipSaved}
              onOpenExisting={openFile}
            />
          ) : (
            <>
              <div className="pb-list" ref={listRef}>
                {flat.map((r, i) => {
                  if (r.kind === 'head')
                    return (
                      <div key={'h' + i} className="pb-head">
                        {r.label}
                      </div>
                    )
                  if (r.kind === 'more')
                    return (
                      <div key={'m' + i} className="pb-more">
                        {i18n.t('search.moreMatches', { count: r.count })}
                      </div>
                    )
                  if (r.kind === 'none')
                    return (
                      <div key="none" className="pb-empty">
                        <QIcon name="search" size={20} />
                        <div>{i18n.t('search.noMatches')}</div>
                      </div>
                    )
                  if (r.kind === 'asknotice')
                    return (
                      <div key="ask-melo" className="pb-row pb-ai pb-ask-notice">
                        <span className="pb-row-ic ai">
                          <QIcon name="sparkle" size={16} />
                        </span>
                        <div className="pb-row-main">
                          <div className="pb-ask-title-line">
                            <div className="pb-row-title">{i18n.t('search.askMelo')}</div>
                            <span className="pb-row-soon">{i18n.t('search.comingSoon')}</span>
                          </div>
                          <div className="pb-row-sub">{i18n.t('search.askMeloDescription')}</div>
                        </div>
                      </div>
                    )
                  return (
                    <PaletteRow
                      key={rowKey(r)}
                      row={r}
                      index={i}
                      isActive={i === activeRowIndex}
                      onHover={hoverRow}
                      onChoose={choose}
                    />
                  )
                })}
              </div>

              <div className="pb-preview">
                <PreviewPane preview={preview} />
              </div>
            </>
          )}
        </div>

        <div className="pb-foot">
          <SearchTips />
          <div className="pb-foot-hints">
            <span>
              <kbd>
                <QIcon name="arrowUpDown" size={12} />
              </kbd>
            </span>
            <span>
              <kbd>↵</kbd>
            </span>
            <span>
              <kbd>esc</kbd>
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ================================================================
   ClipPanel — two-pane capture UI (left control + right preview)
   ================================================================ */

interface UrlPreview {
  title: string
  host: string
  wordCount: number
  imageCount: number
  excerpt: string
  bodyPreview: string
}

type ClipPhase = 'fetching' | 'ready' | 'error'

interface ClipPanelProps {
  url: string
  host: string
  workspacePath: string | null
  inboxId: string | null
  tree: ReturnType<typeof useAtomValue<typeof workspaceTreeAtom>>
  onSaved: (filePath: string, title: string, openAfter: boolean) => void
  onOpenExisting: (id: string) => void
}

const ClipPanel = React.forwardRef<{ submit: () => void }, ClipPanelProps>(function ClipPanel(
  { url, host, workspacePath, inboxId, tree, onSaved, onOpenExisting },
  ref,
) {
  const [phase, setPhase] = useState<ClipPhase>('fetching')
  const [urlPreview, setUrlPreview] = useState<UrlPreview | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [existing, setExisting] = useState<{ path: string; title: string; savedAt: number } | null>(
    null,
  )
  const [dest, setDest] = useState(() => {
    // Settings pick the preselected folder; anything that no longer
    // exists (deleted folder, stale path) falls back to Inbox.
    const { clipLocation, clipCustomDest } = appStore.get(settingsAtom)
    const candidate =
      clipLocation === 'remember'
        ? localStorage.getItem('melo.clipDest')
        : clipLocation === 'custom' && workspacePath
          ? clipCustomDest[workspacePath]
          : null
    if (candidate && findNode(tree, candidate)?.kind === 'folder') return candidate
    return inboxId ?? ''
  })
  const [pending, setPending] = useState<'save' | 'open' | null>(null)
  const [saving, setSaving] = useState(false)
  const destRef = useRef(dest)
  destRef.current = dest
  const treeRef = useRef(tree)
  treeRef.current = tree

  const hue = useMemo(() => domainHue(host), [host])

  // Auto-fetch on mount
  useEffect(() => {
    setPhase('fetching')
    setUrlPreview(null)
    setErrorMsg(null)
    setExisting(null)
    setPending(null)
    setSaving(false)
    let alive = true
    Promise.all([
      window.api.invoke(IpcChannels.InvokePreviewUrl, { url }),
      window.api.invoke(IpcChannels.InvokeFindBySource, { url }),
    ])
      .then(([previewRes, existingRes]) => {
        if (!alive) return
        if (previewRes.success && previewRes.data) {
          setUrlPreview(previewRes.data)
          setPhase('ready')
        } else {
          setErrorMsg(previewRes.error || i18n.t('clip.couldNotFetch'))
          setPhase('error')
        }
        if (existingRes.success && existingRes.data) setExisting(existingRes.data)
      })
      .catch(() => {
        if (!alive) return
        setErrorMsg(i18n.t('clip.networkError'))
        setPhase('error')
      })
    return () => {
      alive = false
    }
  }, [url])

  const doSave = useCallback(
    async (openAfter: boolean) => {
      if (!workspacePath || saving) return
      setSaving(true)
      try {
        // The picked folder may have been deleted while the panel sat
        // open — capturing into it would silently recreate it.
        const picked = destRef.current
        const destFolder =
          picked && findNode(treeRef.current, picked)?.kind === 'folder'
            ? picked
            : inboxId || workspacePath
        const res = await window.api.invoke(IpcChannels.InvokeCaptureUrl, {
          url,
          destFolder,
          workspaceRoot: workspacePath,
        })
        if (res.success && res.data) {
          localStorage.setItem('melo.clipDest', destFolder || '')
          if (res.data.empty) toast(i18n.t('clip.emptyExtract'))
          onSaved(res.data.filePath, res.data.title, openAfter)
        } else {
          toast(res.error || i18n.t('clip.captureFailed'))
          setSaving(false)
        }
      } catch (e) {
        toast(e instanceof Error ? e.message : i18n.t('clip.captureFailed'))
        setSaving(false)
      }
    },
    [url, workspacePath, inboxId, saving, onSaved],
  )

  // Fire queued save once ready
  useEffect(() => {
    if (phase === 'ready' && pending) {
      doSave(pending === 'open')
      setPending(null)
    }
  }, [phase, pending, doSave])

  const commit = useCallback(
    (openAfter: boolean) => {
      if (phase === 'ready') void doSave(openAfter)
      else if (phase === 'fetching') setPending(openAfter ? 'open' : 'save')
    },
    [phase, doSave],
  )

  React.useImperativeHandle(
    ref,
    () => ({
      submit: () => {
        if (existing) onOpenExisting(existing.path)
        else commit(false)
      },
    }),
    [commit, existing, onOpenExisting],
  )

  // Folder list from workspace tree — labels include parent path for hierarchy
  const folders = useMemo(() => {
    const list: { id: string; label: string }[] = []
    const walk = (nodes: typeof tree, depth: number, prefix: string) =>
      nodes.forEach((n) => {
        if (n.kind === 'folder') {
          const label = prefix ? `${prefix} / ${n.name}` : n.name
          list.push({ id: n.id, label })
          if (depth < 2) walk(n.children ?? [], depth + 1, label)
        }
      })
    walk(tree, 0, '')
    return list
  }, [tree])

  const destLabel = useMemo(() => {
    if (!dest) return i18n.t('smartVals.Inbox')
    const f = folders.find((f) => f.id === dest)
    return f ? f.label : i18n.t('smartVals.Inbox')
  }, [dest, folders])

  const destShort = useMemo(() => {
    const parts = destLabel.split(' / ')
    return parts[parts.length - 1]
  }, [destLabel])

  const isLoading = saving || !!pending

  const showExisting = !!existing && phase !== 'fetching'

  return (
    <>
      {/* LEFT — control column */}
      <div className="pb-list clip-ctrl">
        <div className="clip-link">
          <span className="clip-fav" style={{ '--h': hue } as React.CSSProperties}>
            {host[0].toUpperCase()}
          </span>
          <div className="clip-link-main">
            <div className="clip-link-domain">
              <QIcon name="globe" size={12} /> {host}
            </div>
            <div className="clip-link-url">{url.replace(/^https?:\/\//i, '')}</div>
          </div>
          {showExisting ? (
            <span className="clip-badge saved">
              <QIcon name="check" size={12} /> {i18n.t('clip.alreadySaved')}
            </span>
          ) : (
            <span className="clip-badge">
              <QIcon name="scissors" size={12} /> {i18n.t('clip.linkDetected')}
            </span>
          )}
        </div>

        <div className="clip-ctrl-body">
          {showExisting ? (
            <>
              <div className="clip-exist-hint">{i18n.t('clip.openInstead')}</div>
              <ClipSaveButton
                loading={false}
                destLabel={i18n.t('clip.openExisting')}
                folders={[]}
                dest=""
                setDest={() => {}}
                onSave={() => onOpenExisting(existing!.path)}
                hideChevron
              />
              <button className="clip-link-btn" onClick={() => setExisting(null)}>
                {i18n.t('clip.clipAgain')}
              </button>
            </>
          ) : (
            <>
              <div className={cn('clip-status', phase)}>
                {phase === 'fetching' ? (
                  <>
                    <span className="clip-spinner-sm dark" /> {i18n.t('clip.capturingArticle')}
                  </>
                ) : phase === 'error' ? (
                  <>
                    <QIcon name="close" size={13} /> {errorMsg}
                  </>
                ) : (
                  <>
                    <QIcon name="check" size={13} /> {i18n.t('clip.readyToSave')}
                  </>
                )}
              </div>
              <ClipSaveButton
                loading={isLoading}
                destLabel={destShort}
                folders={folders}
                dest={dest}
                setDest={setDest}
                onSave={() => commit(false)}
              />
              <button className="clip-link-btn" onClick={() => commit(true)}>
                {i18n.t('clip.saveAndOpen')}
              </button>
            </>
          )}
        </div>
      </div>

      {/* RIGHT — reader preview */}
      <div className="pb-preview clip-reader">
        {showExisting && urlPreview ? (
          <ClipExistingPreview host={host} preview={urlPreview} existing={existing!} />
        ) : phase === 'ready' && urlPreview ? (
          <ClipReaderPreview host={host} preview={urlPreview} destLabel={destShort} />
        ) : (
          <ClipSkeleton host={host} hue={hue} fetching={phase === 'fetching'} />
        )}
      </div>
    </>
  )
})

/* ---- Save split button ---- */

function ClipSaveButton({
  loading,
  destLabel,
  folders,
  dest,
  setDest,
  onSave,
  hideChevron,
}: {
  loading: boolean
  destLabel: string
  folders: { id: string; label: string }[]
  dest: string
  setDest: (d: string) => void
  onSave: () => void
  hideChevron?: boolean
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [menuOpen])

  return (
    <div className={cn('clip-save', 'block')} ref={wrapRef}>
      <div className={cn('clip-save-btn', loading && 'loading')}>
        <button className="clip-save-main" onClick={onSave} disabled={loading}>
          {loading ? (
            <>
              <span className="clip-spinner-sm" /> {i18n.t('clip.savingWhenReady')}
            </>
          ) : hideChevron ? (
            <>
              <kbd>↵</kbd> {destLabel}
            </>
          ) : (
            <>
              <kbd>↵</kbd>{' '}
              <Trans i18nKey="clip.saveTo" values={{ dest: destLabel }} components={{ b: <b /> }} />
            </>
          )}
        </button>
        {!loading && !hideChevron && (
          <button
            className={cn('clip-save-dest', menuOpen && 'open')}
            onClick={() => setMenuOpen((o) => !o)}
            aria-label={i18n.t('clip.changeFolder')}
          >
            <QIcon name="chev" size={13} />
          </button>
        )}
      </div>
      {menuOpen && (
        <FolderMenu
          folders={folders}
          dest={dest}
          setDest={(d) => {
            setDest(d)
            setMenuOpen(false)
          }}
          onClose={() => setMenuOpen(false)}
        />
      )}
    </div>
  )
}

/* ---- Folder dropdown ---- */

function FolderMenu({
  folders,
  dest,
  setDest,
  onClose,
}: {
  folders: { id: string; label: string }[]
  dest: string
  setDest: (id: string) => void
  onClose: () => void
}) {
  const [q, setQ] = useState('')
  const [hi, setHi] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => inputRef.current?.focus(), [])

  const filtered = useMemo(
    () => folders.filter((f) => f.label.toLowerCase().includes(q.toLowerCase())),
    [folders, q],
  )

  const pick = (f: { id: string }) => setDest(f.id)

  const onKey = (e: React.KeyboardEvent) => {
    e.stopPropagation()
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHi((h) => Math.min(filtered.length - 1, h + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHi((h) => Math.max(0, h - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (filtered[hi]) pick(filtered[hi])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  return (
    <div className="clip-dest-pop" onMouseDown={(e) => e.stopPropagation()}>
      <div className="clip-dest-search">
        <QIcon name="search" size={13} />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
          placeholder={i18n.t('clip.findFolder')}
          spellCheck={false}
          autoComplete="off"
        />
      </div>
      <div className="clip-dest-list">
        {filtered.map((f, i) => (
          <button
            key={f.id}
            className={cn('clip-dest-row', i === hi && 'active', f.id === dest && 'sel')}
            onMouseMove={() => setHi(i)}
            onMouseDown={(e) => {
              e.preventDefault()
              pick(f)
            }}
          >
            <QIcon name="folder" size={14} />
            <span className="clip-dest-row-label">{f.label}</span>
            {f.id === dest && <QIcon name="check" size={13} className="clip-dest-check" />}
          </button>
        ))}
        {filtered.length === 0 && (
          <div className="clip-dest-row" style={{ color: 'var(--ink-4)', cursor: 'default' }}>
            {i18n.t('clip.noMatchingFolders')}
          </div>
        )}
      </div>
    </div>
  )
}

/* ---- Reader preview (right pane, ready state) ---- */

function ClipReaderPreview({
  host,
  preview,
  destLabel,
}: {
  host: string
  preview: UrlPreview
  destLabel: string
}) {
  const previewHtml = useMemo(() => {
    const textOnly = preview.bodyPreview.replace(/!\[[^\]]*\]\([^)]+\)\n*/g, '')
    return renderPreviewHtml(textOnly, [])
  }, [preview.bodyPreview])

  return (
    <div className="clip-rd">
      <div className="clip-rd-kicker">
        <QIcon name="globe" size={12} /> {i18n.t('clip.webClip')} · {host}
      </div>
      <div className="clip-rd-title">{preview.title}</div>
      <div className="clip-rd-meta">
        {i18n.t('search.wordsCount', { count: preview.wordCount })}
        {preview.imageCount > 0 && (
          <>
            <span className="clip-dot" />
            {i18n.t('search.imagesCount', { count: preview.imageCount })}
          </>
        )}
        <span className="clip-dot" />
        {destLabel}
      </div>
      <div className="clip-rd-rule" />
      {preview.excerpt ? (
        <p className="clip-rd-lead">{preview.excerpt}</p>
      ) : (
        <p className="clip-rd-lead placeholder">{i18n.t('clip.clippedLead', { host })}</p>
      )}
      <div className="clip-rd-rule" />
      <div className="pb-prev-md" dangerouslySetInnerHTML={{ __html: previewHtml }} />
    </div>
  )
}

/* ---- Existing note preview (right pane, already-saved state) ---- */

function ClipExistingPreview({
  host,
  preview,
  existing,
}: {
  host: string
  preview: UrlPreview
  existing: { path: string; title: string; savedAt: number }
}) {
  const previewHtml = useMemo(() => {
    const textOnly = preview.bodyPreview.replace(/!\[[^\]]*\]\([^)]+\)\n*/g, '')
    return renderPreviewHtml(textOnly, [])
  }, [preview.bodyPreview])

  return (
    <div className="clip-rd existing">
      <div className="clip-rd-kicker">
        <QIcon name="file" size={12} /> {i18n.t('clip.webClip')} · {host}
      </div>
      <div className="clip-rd-title">{existing.title || preview.title}</div>
      <div className="clip-rd-meta">
        {relTime(existing.savedAt)
          ? i18n.t('clip.savedRel', { time: relTime(existing.savedAt) })
          : i18n.t('clip.savedPreviously')}
        {preview.wordCount > 0 && (
          <>
            <span className="clip-dot" />
            {i18n.t('search.wordsCount', { count: preview.wordCount })}
          </>
        )}
      </div>
      <div className="clip-rd-rule" />
      {preview.excerpt ? (
        <p className="clip-rd-lead">{preview.excerpt}</p>
      ) : (
        <p className="clip-rd-lead placeholder">{i18n.t('clip.prevClipped', { host })}</p>
      )}
      <div className="clip-rd-rule" />
      <div className="pb-prev-md" dangerouslySetInnerHTML={{ __html: previewHtml }} />
    </div>
  )
}

/* ---- Skeleton (right pane, fetching state) ---- */

function ClipSkeleton({ host, hue, fetching }: { host: string; hue: number; fetching: boolean }) {
  return (
    <div className={cn('clip-sk', fetching && 'shimmer')}>
      <div className="clip-sk-fav" style={{ '--h': hue } as React.CSSProperties}>
        {host[0].toUpperCase()}
      </div>
      <div className="clip-sk-domain">
        {fetching ? i18n.t('clip.capturingFrom', { host }) : host}
      </div>
      <div className="clip-sk-line w90 tall" />
      <div className="clip-sk-line w70 tall" />
      <div className="clip-sk-gap" />
      <div className="clip-sk-line w100" />
      <div className="clip-sk-line w100" />
      <div className="clip-sk-line w80" />
      <div className="clip-sk-gap" />
      <div className="clip-sk-line w100" />
      <div className="clip-sk-line w60" />
    </div>
  )
}

/* ================================================================
   PreviewPane — right-hand preview for normal search results
   ================================================================ */

const PREVIEW_CHAR_LIMIT = 50_000

/** The pane is a glance view — cap what enters the DOM so a huge text file
    can't stall the renderer. When the match sits past the cap, window the
    slice around it so the highlight survives. */
function previewSlice(content: string, terms: string[]): string {
  if (content.length <= PREVIEW_CHAR_LIMIT) return content
  const lower = content.toLowerCase()
  let first = -1
  for (const t of terms) {
    if (!t) continue
    const i = lower.indexOf(t)
    if (i !== -1 && (first === -1 || i < first)) first = i
  }
  const start = first > PREVIEW_CHAR_LIMIT / 2 ? Math.max(0, first - 2_000) : 0
  return content.slice(start, start + PREVIEW_CHAR_LIMIT)
}

function PreviewPane({ preview }: { preview: Preview }) {
  const [body, setBody] = useState<string | null>(null)
  const [meta, setMeta] = useState<{ words: number; tags: string[] } | null>(null)

  const file = preview?.type === 'file' ? preview.file : null
  const terms = preview?.type === 'file' ? preview.terms : []
  useEffect(() => {
    setBody(null)
    setMeta(null)
    if (!file) return
    let alive = true
    if (file.kind === 'md' || file.kind === 'txt') {
      window.api.invoke(IpcChannels.InvokeReadFile, { filePath: file.id }).then((res) => {
        if (!alive || !res.success || !res.data) return
        setBody(previewSlice(res.data.content.replace(/^---\n[\s\S]*?\n---\n?/, ''), terms))
      })
      window.api.invoke(IpcChannels.InvokeGetFileMeta, { path: file.id }).then((res) => {
        if (alive && res.success && res.data?.meta) setMeta(res.data.meta)
      })
    }
    return () => {
      alive = false
    }
  }, [file?.id]) // eslint-disable-line

  const mdHtml = useMemo(
    () => (body != null && file?.kind === 'md' ? renderPreviewHtml(body, terms) : null),
    [body, file?.kind, terms.join('\t')], // eslint-disable-line
  )

  if (!preview)
    return (
      <div className="pb-prev-empty">
        <QIcon name="search" size={26} />
        <div>{i18n.t('search.selectResult')}</div>
      </div>
    )

  if (preview.type === 'command') {
    const c = preview.cmd
    return (
      <div className="pb-prev-cmd">
        <span className="pb-prev-cmd-ic">
          <QIcon name={c.icon} size={26} />
        </span>
        <div className="pb-prev-cmd-title">{cmdTitle(c.id)}</div>
        <div className="pb-prev-cmd-hint">{cmdHint(c.id)}</div>
        <div className="pb-prev-run">
          <Trans i18nKey="search.pressToRun" components={{ k: <kbd /> }} />
        </div>
      </div>
    )
  }

  // file preview — markdown rendered, search terms highlighted
  const f = preview.file
  const ranges = body && preview.terms.length ? termRanges(body.toLowerCase(), preview.terms) : []
  return (
    <div className="pb-prev-doc">
      <div className="pb-prev-kicker">
        <FileTypeIcon kind={f.kind} size={13} />{' '}
        {i18n.t(KIND_LABEL[f.kind] ? `search.kinds.${f.kind}` : 'search.kinds.other')}
      </div>
      <div className="pb-prev-title">{f.name}</div>
      <div className="pb-prev-meta">
        {f.path || i18n.t('search.workspace')}
        {f.mtime && (
          <>
            <span className="pb-prev-dot" />
            {i18n.t('search.updated', { time: relTime(f.mtime) })}
          </>
        )}
        {meta && (
          <>
            <span className="pb-prev-dot" />
            {i18n.t('search.wordsCount', { count: meta.words })}
          </>
        )}
      </div>
      {meta && meta.tags.length > 0 && (
        <div className="pb-prev-tags">
          {meta.tags.map((t) => (
            <span key={t} className="pb-prev-tag">
              #{t}
            </span>
          ))}
        </div>
      )}
      <div className="pb-prev-rule" />
      {mdHtml != null ? (
        <div className="pb-prev-md" dangerouslySetInnerHTML={{ __html: mdHtml }} />
      ) : body != null ? (
        <>
          <div className="pb-prev-bodytitle">{f.name}</div>
          <p className="pb-prev-body">
            <HiRanges text={body} ranges={ranges} />
          </p>
        </>
      ) : (
        <p className="pb-prev-body" style={{ color: 'var(--ink-4)' }}>
          {i18n.t('search.noTextPreview')}
        </p>
      )}
      <div className="pb-prev-open">
        <Trans i18nKey="search.pressToOpen" components={{ k: <kbd /> }} />
      </div>
    </div>
  )
}
