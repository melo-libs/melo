import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import i18n from '../../i18n'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/cn'
import { IpcChannels } from '@shared/types/ipc'
import type { SmartHit, SmartRule } from '@shared/types/smart'
import {
  activeSmartIdAtom,
  smartBuilderAtom,
  smartFoldersAtom,
  smartVocabAtom,
} from '../../store/smart'
import { activeTabIdAtom, closeTabAtom, openFileAtom, tabsAtom } from '../../store/editor'
import { SIcon } from './SmartIcon'
import { SortMenu, SORTS } from './SmartControls'
import { bucketOf } from './smartData'
import './smart.scss'

const sortItems = (items: SmartHit[], sort: string) => {
  const a = [...items]
  if (sort === 'Newest first') a.sort((x, y) => y.createdAt - x.createdAt)
  else if (sort === 'Oldest first') a.sort((x, y) => x.createdAt - y.createdAt)
  else if (sort === 'Name A–Z') a.sort((x, y) => x.title.localeCompare(y.title))
  else if (sort === 'Source')
    a.sort((x, y) => (x.sourceHost || 'zzz').localeCompare(y.sourceHost || 'zzz'))
  return a
}

const isTimeSort = (sort: string) => sort === 'Newest first' || sort === 'Oldest first'

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
  onSelect,
}: {
  it: SmartHit
  selected: boolean
  onSelect: () => void
}) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  return (
    <div className={cn('res-row', selected && 'sel')} data-path={it.path} onClick={onSelect}>
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

export const SmartView = () => {
  const { t } = useTranslation()
  const folders = useAtomValue(smartFoldersAtom)
  const [activeId, setActiveId] = useAtom(activeSmartIdAtom)
  const setBuilder = useSetAtom(smartBuilderAtom)
  const vocab = useAtomValue(smartVocabAtom)
  const openFile = useSetAtom(openFileAtom)
  const closeTab = useSetAtom(closeTabAtom)
  const tabs = useAtomValue(tabsAtom)
  const activeTabId = useAtomValue(activeTabIdAtom)

  const [sort, setSort] = useState('Newest first')
  const [items, setItems] = useState<SmartHit[] | null>(null)

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
  const rules = active?.rules ?? []

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
    const valid = rules.filter((r) => r.op === 'is empty' || r.val)
    let alive = true
    const run = () => {
      const mySeq = ++seq.current
      window.api
        .invoke(IpcChannels.InvokeQuerySmartView, {
          rules: valid as SmartRule[],
          // The backend caps at 200 AFTER ordering — the sort must reach
          // it, or "Oldest first" on a large view shows the oldest of
          // the newest 200. The client re-sort below stays for instant
          // feedback while the refetch is in flight.
          sort: sort as 'Newest first' | 'Oldest first' | 'Name A–Z' | 'Source',
        })
        .then((res) => {
          if (alive && seq.current === mySeq && res.success && res.data) setItems(res.data.items)
        })
        .catch(() => {})
    }
    run()
    const off = window.api.on(IpcChannels.OnWorkspaceChanged, run)
    return () => {
      alive = false
      off()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(rules), activeId, sort])

  useEffect(() => {
    setItems(null)
  }, [activeId])

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

  if (!active || !activeId) return null

  const openBuilder = () =>
    setBuilder({ name: active.name, glyph: active.glyph, rules, editId: active.id })

  // Results are already time-sorted (either direction), so buckets come
  // out in the right order just by walking the list.
  const bucketed = isTimeSort(sort)
  const groups: string[] = []
  const byBucket: Record<string, SmartHit[]> = {}
  if (bucketed) {
    results.forEach((it) => {
      const b = bucketOf(it.days)
      if (!byBucket[b]) {
        byBucket[b] = []
        groups.push(b)
      }
      byBucket[b].push(it)
    })
  }

  const sorts = vocab.sources.length > 0 ? SORTS : SORTS.filter((s) => s !== 'Source')

  return (
    <div className="smart-view" style={{ width }}>
      <div className="sv-top">
        <div className="sv-crumb">
          <SIcon n={active.glyph} s={14} cls="sf-glyph" />
          <span>{t('smart.breadcrumb')}</span>
          <span className="sep">/</span>
          <span className="cur">{active.name}</span>
        </div>
        <div className="sv-top-actions">
          <button className="sv-iconbtn" title={t('smart.editSmartFolder')} onClick={openBuilder}>
            <SIcon n="sliders" s={16} />
          </button>
        </div>
      </div>

      <div className="sv-status">
        <span className="sv-count">{t('smart.results', { count: results.length })}</span>
        <SortMenu sort={sort} sorts={sorts} onSort={setSort} />
      </div>

      {items !== null && results.length === 0 ? (
        <EmptyState onEdit={openBuilder} />
      ) : (
        <div className="sf-results">
          {bucketed
            ? groups.map((b) => (
                <Fragment key={b}>
                  {groups.length > 1 && <div className="res-group-head">{b}</div>}
                  {byBucket[b].map((it) => (
                    <ResultRow
                      key={it.path}
                      it={it}
                      selected={it.path === activeTabId}
                      onSelect={() => openResult(it.path)}
                    />
                  ))}
                </Fragment>
              ))
            : results.map((it) => (
                <ResultRow
                  key={it.path}
                  it={it}
                  selected={it.path === activeTabId}
                  onSelect={() => openResult(it.path)}
                />
              ))}
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
