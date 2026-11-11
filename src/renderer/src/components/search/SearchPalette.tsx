import { MeloLogo } from '../MeloLogo'
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
  searchPrefillAtom,
  treeSelectionAtom,
  workspacePathAtom,
  workspaceTreeAtom,
} from '../../store/workspace'
import { findNode } from '../sidebar/treeOps'
import { FileTypeIcon } from '../FileTypeIcon'
import { Favicon } from '../Favicon'
import { Icon } from '../Icon'
import { Button } from '../ui/Button'
import { QIcon, HiText, HiRanges } from './SearchIcon'
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
import { openAgent } from '../../store/agent'
import { activeTabIdAtom } from '../../store/editor'
import { displayedMetadataAtom } from '../../store/documentSession'

/* ============================================================
   SearchPalette — the ⌘K spotlight (design direction B): results
   on the left, a live preview of the highlighted result on the
   right. Ask Melo continues the query in a contextual conversation.
   ============================================================ */

type Row =
  | { kind: 'head'; label: string }
  | { kind: 'file'; file: SearchFile; nav: true }
  | { kind: 'command'; cmd: (typeof COMMANDS)[number]; nav: true }
  | { kind: 'asknotice'; nav: true }
  | { kind: 'item'; it: SearchItem; nav: true }
  | { kind: 'more'; count: number; nav: false }
  | { kind: 'none'; nav: false }

type NavRow = Extract<Row, { nav: true }>

type Preview =
  | { type: 'agent'; query: string }
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
  if (r.kind === 'asknotice') return 'ask-melo'
  if (r.kind === 'file') return 'recent:' + r.file.id
  if (r.kind === 'command') return 'cmd:' + r.cmd.id
  const it = r.it
  if (it.type === 'file') return it.file.id
  return 'cmd:' + it.id
}

/* Memoized result row — while typing and on arrow-key moves the row data
   keeps its identity, so only the rows whose `isActive` flips re-render. */
interface PaletteRowProps {
  row: Exclude<NavRow, { kind: 'asknotice' }>
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
  const { t, i18n: i18nSub } = useTranslation()
  const [open, setOpen] = useAtom(searchOpenAtom)
  const tree = useAtomValue(workspaceTreeAtom)
  const workspacePath = useAtomValue(workspacePathAtom)
  const setActiveNote = useSetAtom(activeNoteAtom)
  const setTreeSelection = useSetAtom(treeSelectionAtom)
  const setActiveSmartId = useSetAtom(activeSmartIdAtom)
  const activeSmartId = useAtomValue(activeSmartIdAtom)
  const activeTabId = useAtomValue(activeTabIdAtom)
  const metadata = useAtomValue(displayedMetadataAtom)
  const canEditTags =
    !activeSmartId && metadata?.id === activeTabId && !!activeTabId?.toLowerCase().endsWith('.md')
  const editTagsAfterClose = useRef(false)
  const indexing = useAtomValue(indexingAtom)
  const [recents, pushRecent] = useAtom(recentNotesAtom)

  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [searchResult, setResult] = useState<SearchResult | null>(null)
  const result = useMemo(() => {
    if (!searchResult || canEditTags) return searchResult
    let removed = 0
    const groups = searchResult.groups
      .map((group) => {
        const items = group.items.filter(
          (item) => item.type !== 'command' || item.id !== 'add-tags',
        )
        removed += group.items.length - items.length
        return { ...group, items }
      })
      .filter((group) => group.items.length || group.hidden)
    return { ...searchResult, groups, total: searchResult.total - removed }
  }, [searchResult, canEditTags])
  const [allTags, setAllTags] = useState<{ tag: string; count: number }[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const clipRef = useRef<ClipPanelHandle>(null)

  const empty = query.trim() === ''

  useEffect(() => {
    if (open || !editTagsAfterClose.current) return
    editTagsAfterClose.current = false
    if (canEditTags) window.dispatchEvent(new CustomEvent('melo:edit-tags'))
  }, [open, canEditTags])

  // Reset + fetch tag vocabulary each open.
  useEffect(() => {
    if (!open) return
    setQuery(appStore.get(searchPrefillAtom))
    appStore.set(searchPrefillAtom, '')
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
        rows.push({ kind: 'head', label: t('search.groups.recent') })
        recentFiles.slice(0, 5).forEach((f) => rows.push({ kind: 'file', file: f, nav: true }))
      }
      if (workspacePath) rows.push({ kind: 'asknotice', nav: true })
      rows.push({ kind: 'head', label: t('search.groups.commands') })
      ;['new-note', 'new-folder', ...(canEditTags ? ['add-tags'] : []), 'settings'].forEach(
        (cid) => {
          const c = COMMANDS.find((x) => x.id === cid)
          if (c) rows.push({ kind: 'command', cmd: c, nav: true })
        },
      )
    } else if (result) {
      result.groups.forEach((g) => {
        if (g.label) rows.push({ kind: 'head', label: g.label })
        g.items.forEach((it) => rows.push({ kind: 'item', it, nav: true }))
        if (g.hidden) rows.push({ kind: 'more', count: g.hidden, nav: false })
      })
      if (!result.total && !urlMatch) rows.push({ kind: 'none', nav: false })
    }
    if (!empty && !urlMatch && workspacePath) rows.push({ kind: 'asknotice', nav: true })
    return rows
  }, [empty, result, recentFiles, urlMatch, workspacePath, canEditTags, t])

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
      if (id === 'add-tags') {
        if (!canEditTags) return
        editTagsAfterClose.current = true
      }
      close()
      if (id === 'new-note') window.dispatchEvent(new CustomEvent('melo:new-note'))
      else if (id === 'new-folder') window.dispatchEvent(new CustomEvent('melo:new-folder'))
      else if (id === 'theme') window.dispatchEvent(new CustomEvent('melo:toggle-theme'))
      else if (id === 'sidebar') window.dispatchEvent(new CustomEvent('melo:toggle-sidebar'))
      else if (id === 'settings')
        void window.api.invoke(IpcChannels.InvokeOpenSettingsWindow, undefined)
    },
    [close, canEditTags],
  )

  const move = (d: number) => {
    if (navIdx.length) setActive((a) => (a + d + navIdx.length) % navIdx.length)
  }
  const askMelo = useCallback(() => {
    close()
    openAgent({ draft: query.trim() || undefined, appendDraft: true })
  }, [close, query])
  const choose = useCallback(
    (rowIndex: number | undefined) => {
      if (rowIndex == null) return
      const r = flat[rowIndex]
      if (!r) return
      if (r.kind === 'asknotice') askMelo()
      if (r.kind === 'file') openFile(r.file.id)
      else if (r.kind === 'command') runCommand(r.cmd.id)
      else if (r.kind === 'item') {
        const it = r.it
        if (it.type === 'file') openFile(it.file.id)
        else if (it.type === 'command') runCommand(it.id)
      }
    },
    [flat, openFile, runCommand, askMelo],
  )
  const hoverRow = useCallback((i: number) => setActive(navIdx.indexOf(i)), [navIdx])
  const onKey = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && workspacePath) {
      e.preventDefault()
      askMelo()
      return
    }
    if (isClip) {
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
      } else clipRef.current?.onKeyDown(e)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      inputRef.current?.focus()
      move(1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      inputRef.current?.focus()
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
    if (activeRow.kind === 'asknotice') preview = { type: 'agent', query }
    else if (activeRow.kind === 'file') preview = { type: 'file', file: activeRow.file, terms: [] }
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

  const askShortcut = workspacePath ? (
    <button
      className="pb-ask-shortcut"
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.stopPropagation()
      }}
      onClick={askMelo}
    >
      <MeloLogo size={16} /> {t('search.askMelo')} <kbd>⌘↵</kbd>
    </button>
  ) : null

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

        {isClip ? (
          <ClipPanel
            key={workspacePath}
            ref={clipRef}
            url={urlMatch.url}
            host={urlMatch.host}
            workspacePath={workspacePath}
            inboxId={inboxId}
            tree={tree}
            inputRef={inputRef}
            askShortcut={askShortcut}
            onSaved={handleClipSaved}
            onOpenExisting={openFile}
          />
        ) : (
          <>
            <div className="pb-body">
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
                      <button
                        key="ask-melo"
                        className={cn('pb-row pb-ask-notice', i === activeRowIndex && 'active')}
                        data-active={i === activeRowIndex}
                        onMouseMove={() => hoverRow(i)}
                        onFocus={() => hoverRow(i)}
                        onClick={() => choose(i)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') event.stopPropagation()
                        }}
                      >
                        <span className="pb-row-ic ai">
                          <MeloLogo size={24} />
                        </span>
                        <div className="pb-row-main">
                          <div className="pb-row-title">{t('search.askMelo')}</div>
                        </div>
                        <span className="pb-row-keys" aria-hidden="true">
                          <kbd>↵</kbd>
                        </span>
                      </button>
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
            </div>

            <div className="pb-foot">
              <SearchTips />
              <div className="pb-foot-hints">
                {askShortcut}
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
          </>
        )}
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
  faviconUrl: string
}

type ClipPhase = 'fetching' | 'ready' | 'error'

interface ClipPanelHandle {
  onKeyDown(event: React.KeyboardEvent): void
}

interface ClipPanelProps {
  url: string
  host: string
  workspacePath: string | null
  inboxId: string | null
  tree: ReturnType<typeof useAtomValue<typeof workspaceTreeAtom>>
  inputRef: React.RefObject<HTMLInputElement>
  askShortcut: React.ReactNode
  onSaved: (filePath: string, title: string, openAfter: boolean) => void
  onOpenExisting: (id: string) => void
}

const ClipPanel = React.forwardRef<ClipPanelHandle, ClipPanelProps>(function ClipPanel(props, ref) {
  const { workspacePath, inboxId, tree } = props
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
  // Destination belongs to this palette session; capture state belongs to the URL.
  return <ClipCapture key={props.url} {...props} ref={ref} dest={dest} setDest={setDest} />
})

interface ClipCaptureProps extends ClipPanelProps {
  dest: string
  setDest: (dest: string) => void
}

const ClipCapture = React.forwardRef<ClipPanelHandle, ClipCaptureProps>(function ClipCapture(
  {
    url,
    host,
    workspacePath,
    inboxId,
    tree,
    inputRef,
    askShortcut,
    onSaved,
    onOpenExisting,
    dest,
    setDest,
  },
  ref,
) {
  const [phase, setPhase] = useState<ClipPhase>('fetching')
  const [urlPreview, setUrlPreview] = useState<UrlPreview | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [existing, setExisting] = useState<{
    path: string
    title: string
    savedAt: number
    favicon?: string
  } | null>(null)
  const [pending, setPending] = useState<'save' | 'open' | null>(null)
  const [saving, setSaving] = useState(false)
  const destRef = useRef(dest)
  destRef.current = dest
  const treeRef = useRef(tree)
  treeRef.current = tree

  const [active, setActive] = useState<0 | 1>(0)
  const [menuOpen, setMenuOpen] = useState(false)
  const folderRef = useRef<HTMLDivElement>(null)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  useEffect(() => {
    if (!menuOpen) return
    const onOutside = (event: MouseEvent) => {
      if (!folderRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [menuOpen])

  // Auto-fetch on mount
  useEffect(() => {
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
        if (!alive.current) return
        if (res.success && res.data) {
          localStorage.setItem('melo.clipDest', destFolder || '')
          if (res.data.empty) toast(i18n.t('clip.emptyExtract'))
          onSaved(res.data.filePath, res.data.title, openAfter)
        } else {
          toast(res.error || i18n.t('clip.captureFailed'))
          setSaving(false)
        }
      } catch (e) {
        if (!alive.current) return
        toast(e instanceof Error ? e.message : i18n.t('clip.captureFailed'))
        setSaving(false)
      }
    },
    [url, workspacePath, inboxId, saving, onSaved],
  )

  // Fire queued save once ready
  useEffect(() => {
    if (phase === 'fetching' || !pending) return
    setPending(null)
    if (existing) onOpenExisting(existing.path)
    else if (phase === 'ready') void doSave(pending === 'open')
  }, [phase, pending, existing, doSave, onOpenExisting])

  const commit = useCallback(
    (openAfter: boolean) => {
      if (phase === 'ready') void doSave(openAfter)
      else if (phase === 'fetching') setPending(openAfter ? 'open' : 'save')
    },
    [phase, doSave],
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

  const showExisting = !!existing && phase !== 'fetching'

  const busy = saving || !!pending
  const saveDisabled = busy || phase === 'error' || !workspacePath
  const closeFolder = () => {
    setMenuOpen(false)
    setActive(0)
    inputRef.current?.focus()
  }
  const choose = (index: 0 | 1) => {
    if (showExisting) {
      if (index === 0) onOpenExisting(existing.path)
      else {
        setExisting(null)
        setActive(0)
      }
    } else if (!saveDisabled) commit(index === 1)
  }
  React.useImperativeHandle(ref, () => ({
    onKeyDown(event) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        setActive((index) => (index === 0 ? 1 : 0))
        inputRef.current?.focus()
      } else if (event.key === 'Enter' && !(event.target as HTMLElement).closest('button')) {
        event.preventDefault()
        choose(active)
      } else if (
        event.key === 'Tab' &&
        !event.shiftKey &&
        !showExisting &&
        !busy &&
        workspacePath
      ) {
        event.preventDefault()
        setActive(0)
        setMenuOpen(true)
      }
    },
  }))
  const status = showExisting ? 'saved' : busy ? 'fetching' : phase
  const statusText = showExisting
    ? i18n.t('clip.alreadySaved')
    : saving
      ? i18n.t('topBar.saving')
      : pending
        ? i18n.t('clip.savingWhenReady')
        : phase === 'fetching'
          ? i18n.t('clip.capturingArticle')
          : phase === 'error'
            ? i18n.t('clip.couldNotFetch')
            : i18n.t('clip.readyToSave')
  const existingParent = existing?.path.replace(/[\\/][^\\/]+$/, '')
  const existingLocation = folders.find((folder) => folder.id === existingParent)?.label

  return (
    <>
      <div className="pb-body pb-body-clip">
        <div className="pb-list clip-ctrl">
          <div className="clip-ctrl-heading">
            <span>{i18n.t('clip.webClip')}</span>
            <span className={cn('clip-status', status)} role="status">
              {status === 'fetching' ? (
                <span className="clip-spinner-sm" />
              ) : (
                <QIcon name={status === 'error' ? 'close' : 'check'} size={12} />
              )}
              {statusText}
            </span>
          </div>
          <div className="clip-actions">
            {showExisting ? (
              <>
                <Button
                  className={cn('clip-action-row', active === 0 && 'active')}
                  onMouseMove={() => setActive(0)}
                  onFocus={() => setActive(0)}
                  onClick={() => choose(0)}
                >
                  <QIcon name="file" size={16} />
                  <span>{i18n.t('clip.openExisting')}</span>
                  {active === 0 && (
                    <span className="clip-action-enter" aria-hidden="true">
                      ↵
                    </span>
                  )}
                </Button>
                <Button
                  className={cn('clip-action-row', active === 1 && 'active')}
                  onMouseMove={() => setActive(1)}
                  onFocus={() => setActive(1)}
                  onClick={() => choose(1)}
                >
                  <Icon name="refresh" size={16} />
                  <span>{i18n.t('clip.clipAgain')}</span>
                  {active === 1 && (
                    <span className="clip-action-enter" aria-hidden="true">
                      ↵
                    </span>
                  )}
                </Button>
                <p className="clip-exist-hint">{i18n.t('clip.openInstead')}</p>
              </>
            ) : (
              <>
                <div className="clip-save" ref={folderRef}>
                  <div
                    className={cn(
                      'clip-action-row',
                      active === 0 && 'active',
                      saveDisabled && 'disabled',
                    )}
                    onMouseMove={() => setActive(0)}
                    onClick={() => choose(0)}
                  >
                    <Button
                      className="clip-action-main"
                      disabled={saveDisabled}
                      aria-label={`${i18n.t('clip.saveToLabel')} ${destLabel}`}
                      onFocus={() => setActive(0)}
                    >
                      <Icon name="inbox" size={16} />
                      <span>{i18n.t('clip.saveToLabel')}</span>
                    </Button>
                    <Button
                      className={cn('clip-folder-trigger', menuOpen && 'open')}
                      disabled={busy || !workspacePath}
                      aria-label={i18n.t('clip.changeFolder')}
                      title={destLabel}
                      aria-expanded={menuOpen}
                      onFocus={() => setActive(0)}
                      onClick={(event) => {
                        event.stopPropagation()
                        setMenuOpen((open) => !open)
                      }}
                    >
                      <span>{destShort}</span>
                      <QIcon name="chev" size={10} />
                    </Button>
                    {active === 0 && (
                      <span className="clip-action-enter" aria-hidden="true">
                        ↵
                      </span>
                    )}
                  </div>
                  {menuOpen && (
                    <FolderMenu
                      folders={folders}
                      dest={dest}
                      setDest={(id) => {
                        setDest(id)
                        closeFolder()
                      }}
                      onClose={closeFolder}
                    />
                  )}
                </div>
                <Button
                  className={cn('clip-action-row', active === 1 && 'active')}
                  disabled={saveDisabled}
                  onMouseMove={() => setActive(1)}
                  onFocus={() => setActive(1)}
                  onClick={() => choose(1)}
                >
                  <Icon name="externalLink" size={16} />
                  <span>{i18n.t('clip.saveAndOpen')}</span>
                  {active === 1 && (
                    <span className="clip-action-enter" aria-hidden="true">
                      ↵
                    </span>
                  )}
                </Button>
                {phase === 'error' && (
                  <p className="clip-error" role="alert">
                    {errorMsg}
                  </p>
                )}
                {!workspacePath && (
                  <p className="clip-error" role="alert">
                    {i18n.t('clip.needsWorkspace')}
                  </p>
                )}
              </>
            )}
          </div>
        </div>
        <div className="pb-preview clip-reader">
          {showExisting ? (
            <ClipExistingPreview
              host={host}
              preview={urlPreview}
              existing={existing}
              location={existingLocation}
            />
          ) : phase === 'ready' && urlPreview ? (
            <ClipReaderPreview host={host} preview={urlPreview} />
          ) : (
            <ClipSkeleton host={host} fetching={phase === 'fetching'} />
          )}
        </div>
      </div>
      <div className="pb-foot clip-foot">
        <div className="pb-foot-hints">
          {askShortcut}
          {!showExisting && (
            <span>
              <kbd>tab</kbd>
              {i18n.t('search.acFolder')}
            </span>
          )}
          <span>
            <kbd>
              <QIcon name="arrowUpDown" size={12} />
            </kbd>
            {i18n.t('clip.selectAction')}
          </span>
          <span>
            <kbd>↵</kbd>
            {i18n.t(
              menuOpen || (showExisting && active === 1)
                ? 'clip.chooseAction'
                : showExisting && active === 0
                  ? 'clip.openAction'
                  : 'menu.save',
            )}
          </span>
          <span title={i18n.t('clip.closeShortcut')}>
            <kbd>esc</kbd>
          </span>
        </div>
      </div>
    </>
  )
})

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
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => inputRef.current?.focus(), [])

  const filtered = useMemo(
    () => folders.filter((f) => f.label.toLowerCase().includes(q.toLowerCase())),
    [folders, q],
  )
  useEffect(() => {
    listRef.current?.children[hi]?.scrollIntoView({ block: 'nearest' })
  }, [hi, filtered])

  const pick = (f: { id: string }) => setDest(f.id)

  const onKey = (e: React.KeyboardEvent) => {
    e.stopPropagation()
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHi((h) => Math.max(0, Math.min(filtered.length - 1, h + 1)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHi((h) => Math.max(0, h - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (filtered[hi]) pick(filtered[hi])
    } else if (e.key === 'Escape' || e.key === 'Tab') {
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
          onChange={(e) => {
            setQ(e.target.value)
            setHi(0)
          }}
          onKeyDown={onKey}
          placeholder={i18n.t('clip.findFolder')}
          spellCheck={false}
          autoComplete="off"
        />
      </div>
      <div className="clip-dest-list" ref={listRef}>
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

function ClipReaderPreview({ host, preview }: { host: string; preview: UrlPreview }) {
  const previewHtml = useMemo(() => {
    const textOnly = preview.bodyPreview.replace(/!\[[^\]]*\]\([^)]+\)\n*/g, '')
    return renderPreviewHtml(textOnly, [])
  }, [preview.bodyPreview])

  return (
    <div className="clip-rd">
      <div className="clip-rd-kicker">
        <Favicon url={preview.faviconUrl} size={14} fallback="globe" /> {i18n.t('clip.webClip')} ·{' '}
        {host}
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
      </div>
      {preview.excerpt ? <p className="clip-rd-lead">{preview.excerpt}</p> : null}
      <div className="pb-prev-md" dangerouslySetInnerHTML={{ __html: previewHtml }} />
    </div>
  )
}

/* ---- Existing note preview (right pane, already-saved state) ---- */

function ClipExistingPreview({
  host,
  preview,
  existing,
  location,
}: {
  host: string
  preview: UrlPreview | null
  existing: { path: string; title: string; savedAt: number; favicon?: string }
  location?: string
}) {
  const previewHtml = useMemo(() => {
    const textOnly = (preview?.bodyPreview ?? '').replace(/!\[[^\]]*\]\([^)]+\)\n*/g, '')
    return renderPreviewHtml(textOnly, [])
  }, [preview?.bodyPreview])

  return (
    <div className="clip-rd existing">
      <div className="clip-rd-kicker">
        <Favicon path={existing.favicon} url={preview?.faviconUrl} size={14} fallback="globe" />{' '}
        {i18n.t('clip.webClip')} · {host}
      </div>
      <div className="clip-rd-title">{existing.title || preview?.title || host}</div>
      <div className="clip-rd-meta">
        {relTime(existing.savedAt)
          ? i18n.t('clip.savedRel', { time: relTime(existing.savedAt) })
          : i18n.t('clip.savedPreviously')}
        {location && (
          <>
            <span className="clip-dot" />
            {location}
          </>
        )}
      </div>
      {preview?.excerpt ? (
        <p className="clip-rd-lead">{preview.excerpt}</p>
      ) : (
        <p className="clip-rd-lead placeholder">{i18n.t('clip.prevClipped', { host })}</p>
      )}
      <div className="pb-prev-md" dangerouslySetInnerHTML={{ __html: previewHtml }} />
    </div>
  )
}

/* ---- Skeleton (right pane, fetching state) ---- */

function ClipSkeleton({ host, fetching }: { host: string; fetching: boolean }) {
  return (
    <div className={cn('clip-sk', fetching && 'shimmer')}>
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

  if (preview.type === 'agent')
    return (
      <div className="pb-prev-agent">
        <div className="pb-prev-agent-heading">
          <MeloLogo size={32} />
          <span>{i18n.t('search.askMelo')}</span>
        </div>
        <div className="pb-prev-agent-query">
          {preview.query.trim() || i18n.t('search.askMeloExamples')}
        </div>
        <div className="pb-prev-agent-hint">{i18n.t('search.askMeloContinue')}</div>
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
