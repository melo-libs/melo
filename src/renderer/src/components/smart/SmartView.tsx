import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import i18n from '../../i18n'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { useVirtualizer } from '@tanstack/react-virtual'
import { cn } from '../../lib/cn'
import { IpcChannels } from '@shared/types/ipc'
import type { SmartHit, SmartRule, SmartSort } from '@shared/types/smart'
import {
  activeSmartIdAtom,
  persistSmartViewsAtom,
  smartBuilderAtom,
  smartFoldersAtom,
  smartVocabAtom,
} from '../../store/smart'
import { activeTabIdAtom, closeTabAtom, openFileAtom, tabsAtom } from '../../store/editor'
import { SIcon } from './SmartIcon'
import { SortMenu, SORTS } from './SmartControls'
import { bucketOf, smartViewName } from './smartData'
import { Button } from '../ui/Button'
import { toast } from '../Toaster'
import './smart.scss'

const PAGE_SIZE = 50
const EMPTY_RULES: SmartRule[] = []

const sortItems = (items: SmartHit[], sort: SmartSort) => {
  const a = [...items]
  const byPath = (x: SmartHit, y: SmartHit) => x.path.localeCompare(y.path)
  if (sort === 'Newest first') a.sort((x, y) => y.createdAt - x.createdAt || byPath(x, y))
  else if (sort === 'Oldest first') a.sort((x, y) => x.createdAt - y.createdAt || byPath(x, y))
  else if (sort === 'Name A–Z') a.sort((x, y) => x.title.localeCompare(y.title) || byPath(x, y))
  else if (sort === 'Source')
    a.sort((x, y) => (x.sourceHost || 'zzz').localeCompare(y.sourceHost || 'zzz') || byPath(x, y))
  return a
}

const isTimeSort = (sort: SmartSort) => sort === 'Newest first' || sort === 'Oldest first'

type ResultEntry =
  | { type: 'group'; key: string; label: string }
  | { type: 'item'; key: string; item: SmartHit; divider: boolean }
  | { type: 'loading'; key: string }

/* List column width: user-resizable, persisted across sessions. */
const SV_WIDTH_KEY = 'melo.smartListWidth'
const SV_WIDTH_DEFAULT = 300
const SV_WIDTH_MIN = 240
const SV_WIDTH_MAX = 480

const savedWidth = (): number => {
  const w = Number(localStorage.getItem(SV_WIDTH_KEY))
  return Number.isFinite(w) && w >= SV_WIDTH_MIN && w <= SV_WIDTH_MAX ? w : SV_WIDTH_DEFAULT
}

/** Relative only while it reads naturally; absolute dates beyond a week. */
function briefAge(
  days: number,
  t: (k: string, o?: Record<string, unknown>) => string,
  lang: string,
): string {
  if (days <= 0) return t('smartVals.Today')
  if (days === 1) return t('smartVals.Yesterday')
  if (days < 7) return t('smart.daysAgo', { count: days })
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toLocaleDateString(lang, {
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  })
}

function ResultRow({
  it,
  selected,
  divider,
  onSelect,
}: {
  it: SmartHit
  selected: boolean
  divider: boolean
  onSelect: () => void
}) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  return (
    <div
      className={cn('res-row', divider && 'with-divider', selected && 'sel')}
      data-path={it.path}
      onClick={onSelect}
    >
      <span className="res-main">
        <div className="res-name">{it.title}</div>
        <div className="res-meta">
          <span className="res-where">{it.sourceHost || it.folderTop}</span>
          <span className="dot-sep" />
          <span>{briefAge(it.days, t, lang)}</span>
          {it.tags.map((t) => (
            <span key={t} className="res-tag">
              #{t}
            </span>
          ))}
        </div>
      </span>
    </div>
  )
}

function EmptyState({ onEdit }: { onEdit: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="sf-empty">
      <h3>{t('smart.noMatchesYet')}</h3>
      <p>{t('smart.emptyHint')}</p>
      <button className="btn ghost sm" onClick={onEdit}>
        <SIcon n="sliders" s={14} />
        {t('smart.editRules')}
      </button>
    </div>
  )
}

function LoadErrorState({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="sf-empty" role="alert">
      <h3>{t('smart.couldNotLoad')}</h3>
      <Button size="small" onClick={onRetry}>
        {t('smart.retry')}
      </Button>
    </div>
  )
}

export const SmartView = () => {
  const { t } = useTranslation()
  const folders = useAtomValue(smartFoldersAtom)
  const [activeId, setActiveId] = useAtom(activeSmartIdAtom)
  const setBuilder = useSetAtom(smartBuilderAtom)
  const persistViews = useSetAtom(persistSmartViewsAtom)
  const vocab = useAtomValue(smartVocabAtom)
  const openFile = useSetAtom(openFileAtom)
  const closeTab = useSetAtom(closeTabAtom)
  const tabs = useAtomValue(tabsAtom)
  const activeTabId = useAtomValue(activeTabIdAtom)

  const [sort, setSort] = useState<SmartSort>('Newest first')
  const [items, setItems] = useState<SmartHit[] | null>(null)
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [queryError, setQueryError] = useState<{
    key: string
    phase: 'initial' | 'more'
  } | null>(null)
  const [retryVersion, setRetryVersion] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const loadingRef = useRef(false)

  const [width, setWidth] = useState(savedWidth)
  const widthRef = useRef(width)
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = widthRef.current
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    const move = (ev: PointerEvent) => {
      const w = Math.round(
        Math.min(SV_WIDTH_MAX, Math.max(SV_WIDTH_MIN, startW + ev.clientX - startX)),
      )
      widthRef.current = w
      setWidth(w)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      localStorage.setItem(SV_WIDTH_KEY, String(widthRef.current))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const resetWidth = () => {
    widthRef.current = SV_WIDTH_DEFAULT
    setWidth(SV_WIDTH_DEFAULT)
    localStorage.setItem(SV_WIDTH_KEY, String(SV_WIDTH_DEFAULT))
  }

  const active = folders.find((f) => f.id === activeId)
  const rules = active?.rules ?? EMPTY_RULES
  const activeName = active ? smartViewName(active) : ''
  const validRules = useMemo(
    () => rules.filter((rule) => rule.op === 'is empty' || rule.val),
    [rules],
  )
  const queryKey = useMemo(
    () => JSON.stringify([activeId, validRules, sort]),
    [activeId, validRules, sort],
  )
  const initialError = queryError?.key === queryKey && queryError.phase === 'initial'
  const loadMoreError = queryError?.key === queryKey && queryError.phase === 'more'

  useEffect(() => {
    setSort(active?.sort ?? 'Newest first')
  }, [activeId, active?.sort])

  // Track the tab created by smart folder browsing so we can replace it
  // on the next click instead of accumulating tabs.
  const smartTabRef = useRef<string | null>(null)
  useEffect(() => {
    smartTabRef.current = null
  }, [activeId])

  const openResult = (path: string) => {
    const prev = smartTabRef.current
    openFile(path)
    if (prev && prev !== path) {
      const prevTab = tabs.find((t) => t.id === prev)
      if (prevTab && !prevTab.dirty) closeTab(prev)
    }
    smartTabRef.current = path
  }

  const seq = useRef(0)
  useEffect(() => {
    if (!activeId) return
    let alive = true
    const run = () => {
      const mySeq = ++seq.current
      loadingRef.current = true
      setItems(null)
      setTotal(0)
      setHasMore(false)
      setLoadingMore(false)
      setQueryError(null)
      scrollRef.current?.scrollTo({ top: 0 })
      window.api
        .invoke(IpcChannels.InvokeQuerySmartView, {
          rules: validRules,
          sort,
          offset: 0,
          limit: PAGE_SIZE,
        })
        .then((res) => {
          if (!alive || seq.current !== mySeq) return
          if (!res.success || !res.data) {
            setItems([])
            setQueryError({ key: queryKey, phase: 'initial' })
            return
          }
          setItems(res.data.items)
          setTotal(res.data.total)
          setHasMore(res.data.hasMore)
        })
        .catch(() => {
          if (!alive || seq.current !== mySeq) return
          setItems([])
          setQueryError({ key: queryKey, phase: 'initial' })
        })
        .finally(() => {
          if (alive && seq.current === mySeq) loadingRef.current = false
        })
    }
    run()
    const off = window.api.on(IpcChannels.OnWorkspaceChanged, run)
    return () => {
      alive = false
      seq.current += 1
      loadingRef.current = false
      off()
    }
  }, [validRules, activeId, sort, queryKey, retryVersion])

  const loadMore = useCallback(() => {
    if (!activeId || !items || !hasMore || loadingRef.current) return
    const mySeq = seq.current
    const offset = items.length
    loadingRef.current = true
    setLoadingMore(true)
    setQueryError(null)
    void window.api
      .invoke(IpcChannels.InvokeQuerySmartView, {
        rules: validRules,
        sort,
        offset,
        limit: PAGE_SIZE,
      })
      .then((res) => {
        if (seq.current !== mySeq) return
        if (!res.success || !res.data) {
          setQueryError({ key: queryKey, phase: 'more' })
          return
        }
        const data = res.data
        setItems((current) => {
          if (!current) return data.items
          const paths = new Set(current.map((item) => item.path))
          return [...current, ...data.items.filter((item) => !paths.has(item.path))]
        })
        setTotal(data.total)
        setHasMore(data.hasMore)
      })
      .catch(() => {
        if (seq.current === mySeq) setQueryError({ key: queryKey, phase: 'more' })
      })
      .finally(() => {
        if (seq.current === mySeq) {
          loadingRef.current = false
          setLoadingMore(false)
        }
      })
  }, [activeId, hasMore, items, queryKey, sort, validRules])

  const results = useMemo(() => sortItems(items ?? [], sort), [items, sort])
  const selectedIdx = activeTabId ? results.findIndex((r) => r.path === activeTabId) : -1

  const autoOpened = useRef<string | null>(null)
  useEffect(() => {
    if (activeId && activeId !== autoOpened.current && results.length > 0) {
      openResult(results[0].path)
      autoOpened.current = activeId
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, results.length > 0])

  // Keep the selected row visible.
  useEffect(() => {
    if (selectedIdx < 0) return
    document
      .querySelector(`.res-row[data-path="${CSS.escape(results[selectedIdx].path)}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [selectedIdx, results])

  const openResultRef = useRef(openResult)
  openResultRef.current = openResult
  const keyCtx = useRef({ results, selectedIdx })
  keyCtx.current = { results, selectedIdx }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, [contenteditable="true"], .smart-modal')) return
      const { results: rs, selectedIdx: idx } = keyCtx.current
      if (e.key === 'Escape') {
        setActiveId(null)
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        if (rs.length === 0) return
        const next = idx < 0 ? 0 : Math.min(idx + 1, rs.length - 1)
        openResultRef.current(rs[next].path)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        if (rs.length === 0 || idx <= 0) return
        openResultRef.current(rs[Math.max(idx - 1, 0)].path)
      } else if (e.key === 'Enter') {
        if (idx >= 0) setActiveId(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId])

  const entries = useMemo<ResultEntry[]>(() => {
    const next: ResultEntry[] = []
    let previousBucket = ''
    let previousWasItem = false
    for (const item of results) {
      if (isTimeSort(sort)) {
        const bucket = bucketOf(item.days)
        if (bucket !== previousBucket) {
          next.push({ type: 'group', key: `group:${bucket}`, label: bucket })
          previousBucket = bucket
          previousWasItem = false
        }
      }
      next.push({ type: 'item', key: item.path, item, divider: previousWasItem })
      previousWasItem = true
    }
    if (hasMore) next.push({ type: 'loading', key: 'loading' })
    return next
  }, [hasMore, results, sort])

  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollRef.current,
    getItemKey: (index) => entries[index].key,
    estimateSize: (index) => (entries[index].type === 'item' ? 46 : 34),
    overscan: 6,
  })
  const virtualItems = virtualizer.getVirtualItems()
  const lastVirtualIndex = virtualItems.at(-1)?.index ?? -1
  useEffect(() => {
    if (!loadMoreError && lastVirtualIndex >= entries.length - 8) loadMore()
  }, [entries.length, lastVirtualIndex, loadMore, loadMoreError])

  if (!active || !activeId) return null

  const openBuilder = () =>
    setBuilder({ name: activeName, glyph: active.glyph, rules, editId: active.id })

  const sorts = vocab.sources.length > 0 ? SORTS : SORTS.filter((s) => s !== 'Source')
  const changeSort = async (nextSort: SmartSort) => {
    if (nextSort === sort) return
    const previousSort = sort
    setSort(nextSort)
    const nextFolders = folders.map((folder) =>
      folder.id === activeId ? { ...folder, sort: nextSort } : folder,
    )
    if (await persistViews(nextFolders)) return
    setSort(previousSort)
    toast(t('smart.couldNotSave'))
  }

  return (
    <div className="smart-view" style={{ width }}>
      <div className="sv-top">
        <div className="sv-crumb">
          <SIcon n={active.glyph} s={14} cls="sf-glyph" />
          <span>{t('smart.breadcrumb')}</span>
          <span className="sep">/</span>
          <span className="cur">{activeName}</span>
        </div>
        <div className="sv-top-actions">
          <button className="sv-iconbtn" title={t('smart.editSmartFolder')} onClick={openBuilder}>
            <SIcon n="sliders" s={16} />
          </button>
        </div>
      </div>

      <div className="sv-status">
        <span className="sv-count">{t('smart.results', { count: total })}</span>
        <SortMenu sort={sort} sorts={sorts} onSort={(nextSort) => void changeSort(nextSort)} />
      </div>

      {initialError ? (
        <LoadErrorState onRetry={() => setRetryVersion((version) => version + 1)} />
      ) : items !== null && results.length === 0 ? (
        <EmptyState onEdit={openBuilder} />
      ) : (
        <div ref={scrollRef} className="sf-results" aria-busy={items === null || loadingMore}>
          <div className="sf-results-virtual" style={{ height: virtualizer.getTotalSize() }}>
            {virtualItems.map((virtualItem) => {
              const entry = entries[virtualItem.index]
              return (
                <div
                  key={entry.key}
                  ref={virtualizer.measureElement}
                  className="sf-virtual-item"
                  data-index={virtualItem.index}
                  style={{ transform: `translateY(${Math.round(virtualItem.start)}px)` }}
                >
                  {entry.type === 'group' ? (
                    <div className="res-group-head">{entry.label}</div>
                  ) : entry.type === 'loading' ? (
                    <div
                      className={cn('sf-results-loading', loadMoreError && 'error')}
                      role={loadMoreError ? 'alert' : undefined}
                    >
                      {loadMoreError ? (
                        <>
                          <span>{t('smart.couldNotLoadMore')}</span>
                          <Button size="small" onClick={loadMore}>
                            {t('smart.retry')}
                          </Button>
                        </>
                      ) : (
                        t('smart.loadingMore')
                      )}
                    </div>
                  ) : (
                    <ResultRow
                      it={entry.item}
                      selected={entry.item.path === activeTabId}
                      divider={entry.divider}
                      onSelect={() => openResult(entry.item.path)}
                    />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
      <div
        className="sv-resize"
        onPointerDown={startResize}
        onDoubleClick={resetWidth}
        title={i18n.t('misc.dragResize')}
      />
    </div>
  )
}
