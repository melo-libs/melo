import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import i18n from '../../i18n'
import { cn } from '../../lib/cn'
import { QIcon } from './SearchIcon'

/* ============================================================
   Shared search field — filter pills (commit-on-space) + inline
   autocomplete + rotating tips. Port of design SearchField.jsx;
   is:starred is omitted until starred data exists (F3).
   ============================================================ */

interface Filter {
  kind: string
  value: string
}

const KIND_OPTIONS: [string, string][] = [
  ['md', 'Markdown'],
  ['html', 'Web clip'],
  ['pdf', 'PDF'],
  ['audio', 'Audio'],
  ['video', 'Video'],
  ['data', 'Data'],
  ['bookmark', 'Bookmark'],
  ['code', 'Code'],
]

const FILTER_ICON: Record<string, string> = { tag: 'hash', path: 'folder', kind: 'file' }
const filterLabel = (f: Filter) => (f.kind === 'tag' ? f.value : f.kind + ': ' + f.value)

function serializeFilters(filters: Filter[]): string {
  return filters.map((f) => (f.kind === 'tag' ? '#' + f.value : f.kind + ':' + f.value)).join(' ')
}
function buildQuery(mode: string | null, filters: Filter[], text: string): string {
  if (mode === 'command') return '>' + (text ? ' ' + text : '')
  const ser = serializeFilters(filters)
  if (ser && text) return ser + ' ' + text
  return ser || text || ''
}
function splitQuery(q: string): { mode: string | null; filters: Filter[]; text: string } {
  let mode: string | null = null
  let body = q
  if (q.startsWith('>')) {
    mode = 'command'
    body = q.slice(1)
  }
  body = body.replace(/^\s+/, '')
  if (mode) return { mode, filters: [], text: body }
  const endsSpace = /\s$/.test(body)
  const toks = body.split(/\s+/).filter(Boolean)
  const filters: Filter[] = []
  const textToks: string[] = []
  toks.forEach((tok, i) => {
    const active = i === toks.length - 1 && !endsSpace // still being typed
    const op = tok.match(/^(tag|path|kind|in):(.+)$/i)
    const hash = tok.match(/^#([\w-]+)$/)
    if (!active && op)
      filters.push({
        kind: op[1].toLowerCase() === 'in' ? 'path' : op[1].toLowerCase(),
        value: op[2].toLowerCase(),
      })
    else if (!active && hash) filters.push({ kind: 'tag', value: hash[1].toLowerCase() })
    else textToks.push(tok)
  })
  return { mode, filters, text: textToks.join(' ') }
}

export function SearchField({
  query,
  setQuery,
  inputRef,
  trailing,
  allTags,
  folderWords,
}: {
  query: string
  setQuery: (q: string) => void
  inputRef: MutableRefObject<HTMLInputElement | null>
  trailing?: string
  allTags: { tag: string; count: number }[]
  folderWords: string[]
}) {
  const { t } = useTranslation()
  const init = useMemo(() => splitQuery(query), []) // eslint-disable-line
  const [mode, setMode] = useState<string | null>(init.mode)
  const [filters, setFilters] = useState<Filter[]>(init.filters)
  const [text, setText] = useState(init.text)
  const [acSel, setAcSel] = useState(0)
  const lastEmit = useRef(query)

  // resync when query changes from OUTSIDE the field
  useEffect(() => {
    if (query !== lastEmit.current) {
      const s = splitQuery(query)
      setMode(s.mode)
      setFilters(s.filters)
      setText(s.text)
      lastEmit.current = query
    }
  }, [query])

  useEffect(() => {
    inputRef.current?.focus()
    // eslint-disable-next-line
  }, [])

  const emit = (m: string | null, f: Filter[], t: string) => {
    const q = buildQuery(m, f, t)
    lastEmit.current = q
    setQuery(q)
  }

  const applyText = (raw: string) => {
    let m = mode
    let t = raw
    if (!m && filters.length === 0 && t[0] === '>') {
      m = 'command'
      t = t.slice(1).replace(/^\s/, '')
    }
    if (m) {
      setMode(m)
      setText(t)
      emit(m, filters, t)
      return
    }
    const endsSpace = /\s$/.test(t)
    const toks = t.split(/\s+/)
    const keep: string[] = []
    const add: Filter[] = []
    toks.forEach((tok, i) => {
      if (!tok) return
      const active = i === toks.length - 1 && !endsSpace
      const op = tok.match(/^(tag|path|kind|in):(.+)$/i)
      const hash = tok.match(/^#([\w-]+)$/)
      if (!active && op)
        add.push({
          kind: op[1].toLowerCase() === 'in' ? 'path' : op[1].toLowerCase(),
          value: op[2].toLowerCase(),
        })
      else if (!active && hash) add.push({ kind: 'tag', value: hash[1].toLowerCase() })
      else keep.push(tok)
    })
    if (add.length) {
      const nf = [...filters, ...add]
      const nt = keep.join(' ') + (endsSpace && keep.length ? ' ' : '')
      setFilters(nf)
      setText(nt)
      emit(m, nf, nt)
    } else {
      setText(t)
      emit(m, filters, t)
    }
  }

  const removeFilter = (idx: number) => {
    const nf = filters.filter((_, i) => i !== idx)
    setFilters(nf)
    emit(mode, nf, text)
    inputRef.current?.focus()
  }
  const exitMode = () => {
    setMode(null)
    emit(null, filters, text)
    inputRef.current?.focus()
  }

  // autocomplete on the active trailing token
  const ac = useMemo(() => {
    if (mode) return null
    const last = text.split(/\s+/).pop() || ''
    let kind: string | null = null
    let frag = ''
    let m: RegExpMatchArray | null
    if ((m = last.match(/^#([\w-]*)$/))) {
      kind = 'tag'
      frag = m[1]
    } else if ((m = last.match(/^(tag|kind|path):([\w-]*)$/i))) {
      kind = m[1].toLowerCase()
      frag = m[2]
    }
    if (!kind) return null
    let items: { value: string; label: string; hint: string; op: string }[] = []
    if (kind === 'tag')
      items = allTags
        .filter((t) => t.tag.includes(frag))
        .map((t) => ({
          value: t.tag,
          label: '#' + t.tag,
          hint: i18n.t('search.notesCount', { count: t.count }),
          op: 'tag',
        }))
    else if (kind === 'kind')
      items = KIND_OPTIONS.filter(([v]) => v.includes(frag)).map(([v]) => ({
        value: v,
        label: i18n.t(`search.kinds.${v}`),
        hint: 'kind:' + v,
        op: 'kind',
      }))
    else if (kind === 'path')
      items = folderWords
        .filter((w) => w.includes(frag))
        .map((w) => ({ value: w, label: w, hint: 'path:' + w, op: 'path' }))
    items = items.slice(0, 6)
    return { kind, frag, items }
  }, [text, mode, allTags, folderWords, t])

  useEffect(() => setAcSel(0), [text])

  const pickAc = (item: { value: string; op: string }) => {
    const parts = text.split(/(\s+)/)
    for (let i = parts.length - 1; i >= 0; i--) {
      if (parts[i] && !/^\s+$/.test(parts[i])) {
        parts[i] = item.op === 'tag' ? '#' + item.value : item.op + ':' + item.value
        break
      }
    }
    applyText(parts.join('') + ' ')
    inputRef.current?.focus()
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (ac && ac.items.length) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        e.stopPropagation()
        setAcSel((s) => (s + 1) % ac.items.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        e.stopPropagation()
        setAcSel((s) => (s - 1 + ac.items.length) % ac.items.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        e.stopPropagation()
        pickAc(ac.items[acSel])
        return
      }
    }
    if (ac) {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        applyText(text.replace(/(#|\b(?:tag|kind|path):)[\w-]*$/, '').trimEnd() + ' ')
        return
      }
    }
    const el = e.target as HTMLInputElement
    if (e.key === 'Backspace' && text === '' && el.selectionStart === 0) {
      if (filters.length) {
        e.preventDefault()
        e.stopPropagation()
        removeFilter(filters.length - 1)
        return
      }
      if (mode) {
        e.preventDefault()
        e.stopPropagation()
        exitMode()
        return
      }
    }
    // otherwise bubble to the panel (results nav handled there)
  }

  const placeholder =
    mode === 'command'
      ? t('search.runCommandPh')
      : filters.length
        ? t('search.addFilterPh')
        : t('search.searchPh')

  const leadIcon = mode === 'command' ? 'gear' : 'search'

  return (
    <div className="sf-wrap sf-wrap-b">
      <QIcon name={leadIcon} size={19} className="sf-lead-ic" />
      <div className="sf-tokens">
        {mode && (
          <span className="sf-mode" onClick={exitMode}>
            <QIcon name="gear" size={12} />
            {t('search.commandChip')}
            <QIcon name="plus" size={11} className="sf-x" style={{ transform: 'rotate(45deg)' }} />
          </span>
        )}
        {filters.map((f, i) => (
          <span key={i} className={cn('sf-pill', 'sf-pill-' + f.kind)}>
            <QIcon name={FILTER_ICON[f.kind] || 'hash'} size={11} />
            {filterLabel(f)}
            <button
              className="sf-x"
              onMouseDown={(e) => {
                e.preventDefault()
                removeFilter(i)
              }}
              aria-label={t('search.removeFilter')}
            >
              <QIcon name="plus" size={11} style={{ transform: 'rotate(45deg)' }} />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          className="sf-input"
          value={text}
          placeholder={placeholder}
          onChange={(e) => applyText(e.target.value)}
          onKeyDown={onKeyDown}
          spellCheck={false}
          autoComplete="off"
        />
      </div>
      {trailing ? <span className="sf-trailing">{trailing}</span> : null}
      {text || filters.length || mode ? (
        <button
          className="sf-clear"
          onMouseDown={(e) => {
            e.preventDefault()
            setMode(null)
            setFilters([])
            setText('')
            emit(null, [], '')
            inputRef.current?.focus()
          }}
        >
          {t('search.clear')}
        </button>
      ) : null}

      {ac && (
        <div className="sf-ac">
          <div className="sf-ac-head">
            {ac.kind === 'tag'
              ? t('search.acTags')
              : ac.kind === 'kind'
                ? t('search.acFileType')
                : t('search.acFolder')}
          </div>
          {ac.items.length ? (
            ac.items.map((it, i) => (
              <div
                key={it.value}
                className={cn('sf-ac-row', i === acSel && 'active')}
                onMouseMove={() => setAcSel(i)}
                onMouseDown={(e) => {
                  e.preventDefault()
                  pickAc(it)
                }}
              >
                <QIcon name={FILTER_ICON[it.op] || 'hash'} size={14} />
                <span className="sf-ac-label">{it.label}</span>
                <span className="sf-ac-hint">{it.hint}</span>
              </div>
            ))
          ) : (
            <div className="sf-ac-empty">
              {ac.kind === 'tag'
                ? t('search.noTagsYet')
                : ac.kind === 'kind'
                  ? t('search.noMatchingFileType')
                  : t('search.noMatchingFolder')}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* ---- rotating, one-at-a-time tips ---- */
const TIP_KEYS = ['search.tip1', 'search.tip3', 'search.tip4', 'search.tip5']

export function SearchTips() {
  const { t } = useTranslation()
  const [i, setI] = useState(0)
  const [paused, setPaused] = useState(false)
  useEffect(() => {
    if (paused) return
    const t = setInterval(() => setI((n) => (n + 1) % TIP_KEYS.length), 4200)
    return () => clearInterval(t)
  }, [paused])
  return (
    <div
      className="sf-tips"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onClick={() => setI((n) => (n + 1) % TIP_KEYS.length)}
      title={t('search.clickNextTip')}
    >
      <QIcon name="sparkle" size={12} className="sf-tip-ic" />
      <div className="sf-tip-text" key={i}>
        <Trans i18nKey={TIP_KEYS[i]} components={{ c: <code />, k: <kbd /> }} />
      </div>
      <div className="sf-tip-dots">
        {TIP_KEYS.map((_, n) => (
          <span key={n} className={cn('sf-dot', n === i && 'on')} />
        ))}
      </div>
    </div>
  )
}
