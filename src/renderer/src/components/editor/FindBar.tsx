import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor, EditorEvents } from '@tiptap/react'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { Icon } from '../Icon'
import { cn } from '../../lib/cn'
import { activeTabIdAtom } from '../../store/editor'

/* ============================================================
   FindBar — in-document find & replace. ⌘F opens (prefilled from
   the selection), ⌥⌘F opens with the replace row, Esc closes.
   Matches render as decorations (lemon; the current one accented),
   Enter / ⌘G cycles, replace-all lands in one undo step.
   ============================================================ */

const findKey = new PluginKey<DecorationSet>('meloFind')

/** Decoration carrier: content comes in via setMeta, positions are
 *  mapped through unrelated transactions so highlights stay put. */
const findPlugin = new Plugin<DecorationSet>({
  key: findKey,
  state: {
    init: () => DecorationSet.empty,
    apply: (tr, old) => {
      const meta = tr.getMeta(findKey) as DecorationSet | undefined
      if (meta) return meta
      return tr.docChanged ? old.map(tr.mapping, tr.doc) : old
    },
  },
  props: {
    decorations(state) {
      return this.getState(state)
    },
  },
})

interface Match {
  from: number
  to: number
}

/** Per-textblock scan. Inline atoms (math, images) contribute exactly one
 *  placeholder char — same width as the one doc position they occupy — so
 *  text offsets map linearly to doc positions, and matches spanning mark
 *  boundaries (bold splits text nodes) still land. */
function findMatches(doc: PMNode, query: string, caseSensitive: boolean): Match[] {
  const matches: Match[] = []
  const q = caseSensitive ? query : query.toLowerCase()
  if (!q) return matches
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    let text = ''
    node.forEach((child) => {
      text += child.isText ? (child.text ?? '') : '￼'.repeat(child.nodeSize)
    })
    // Unicode lowercasing can change UTF-16 length (İ → i̇) and corrupt
    // the offset mapping — fall back to exact case for such blocks.
    const lower = caseSensitive ? text : text.toLowerCase()
    const hay = lower.length === text.length ? lower : text
    let i = hay.indexOf(q)
    while (i !== -1) {
      matches.push({ from: pos + 1 + i, to: pos + 1 + i + q.length })
      i = hay.indexOf(q, i + q.length)
    }
    return false
  })
  return matches
}

export const FindBar = ({ editor }: { editor: Editor }) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [withReplace, setWithReplace] = useState(false)
  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [matches, setMatches] = useState<Match[]>([])
  const [active, setActive] = useState(0)
  const findRef = useRef<HTMLInputElement>(null)
  const barRef = useRef<HTMLDivElement>(null)

  // Register the decoration plugin once per editor instance.
  useEffect(() => {
    editor.registerPlugin(findPlugin)
    return () => {
      editor.unregisterPlugin(findKey)
    }
  }, [editor])

  const pushDecos = useCallback(
    (list: Match[], activeIdx: number) => {
      const decos = list.map((m, i) =>
        Decoration.inline(m.from, m.to, {
          class: cn('find-match', i === activeIdx && 'find-match-active'),
        }),
      )
      const set = DecorationSet.create(editor.state.doc, decos)
      editor.view.dispatch(editor.state.tr.setMeta(findKey, set).setMeta('addToHistory', false))
    },
    [editor],
  )

  const clearDecos = useCallback(() => {
    editor.view.dispatch(
      editor.state.tr.setMeta(findKey, DecorationSet.empty).setMeta('addToHistory', false),
    )
  }, [editor])

  const scrollToActive = useCallback(() => {
    requestAnimationFrame(() => {
      editor.view.dom
        .querySelector('.find-match-active')
        ?.scrollIntoView({ block: 'center', behavior: 'auto' })
    })
  }, [editor])

  /** Recompute matches; keep the active slot pointed at (or after) the
   *  given doc position so cycling and edits feel anchored. */
  const refresh = useCallback(
    (q: string, cs: boolean, anchorPos?: number) => {
      const list = findMatches(editor.state.doc, q, cs)
      setMatches(list)
      let idx = 0
      if (list.length > 0) {
        const anchor = anchorPos ?? editor.state.selection.from
        idx = list.findIndex((m) => m.from >= anchor)
        if (idx === -1) idx = 0
      }
      setActive(idx)
      pushDecos(list, idx)
      return list
    },
    [editor, pushDecos],
  )

  // Doc edits while the bar is open: re-run the scan with the same query,
  // anchoring on the active match's position mapped THROUGH the edit —
  // an unmapped anchor drifts to a later match when text before it is
  // deleted.
  useEffect(() => {
    if (!open) return
    const onUpdate = ({ transaction }: EditorEvents['update']) => {
      const prev = matches[active]?.from
      refresh(query, caseSensitive, prev != null ? transaction.mapping.map(prev) : undefined)
    }
    editor.on('update', onUpdate)
    return () => {
      editor.off('update', onUpdate)
    }
  }, [open, query, caseSensitive, matches, active, editor, refresh])

  // The tab switch swaps the document under this same editor instance
  // (with update suppressed) — stale match ranges must never survive
  // into the next document.
  const activeTabId = useAtomValue(activeTabIdAtom)
  const tabRef = useRef(activeTabId)
  useEffect(() => {
    if (tabRef.current === activeTabId) return
    tabRef.current = activeTabId
    if (open) {
      setOpen(false)
      setMatches([])
      setActive(0)
      clearDecos()
    }
  }, [activeTabId, open, clearDecos])

  const openBar = useCallback(
    (replace: boolean) => {
      const { from, to } = editor.state.selection
      // '\n' separator so a multi-block selection is detectable (and
      // rejected — the scanner never matches across blocks).
      const sel = from !== to ? editor.state.doc.textBetween(from, to, '\n') : ''
      setOpen(true)
      setWithReplace(replace)
      if (sel && !sel.includes('\n') && sel.length <= 200) {
        setQuery(sel)
        refresh(sel, caseSensitive, from)
      } else if (query) {
        refresh(query, caseSensitive)
      }
      requestAnimationFrame(() => {
        findRef.current?.focus()
        findRef.current?.select()
      })
    },
    [editor, query, caseSensitive, refresh],
  )

  const close = useCallback(() => {
    setOpen(false)
    clearDecos()
    editor.commands.focus()
  }, [editor, clearDecos])

  const step = useCallback(
    (dir: 1 | -1) => {
      if (matches.length === 0) return
      const idx = (active + dir + matches.length) % matches.length
      setActive(idx)
      pushDecos(matches, idx)
      scrollToActive()
    },
    [matches, active, pushDecos, scrollToActive],
  )

  const replaceOne = useCallback(() => {
    const m = matches[active]
    if (!m) return
    // Compare against the actual matched text (not the query — a
    // case-insensitive match may still need its case normalized).
    const current = editor.state.doc.textBetween(m.from, m.to)
    if (replacement !== current) {
      editor.view.dispatch(editor.state.tr.insertText(replacement, m.from, m.to))
    }
    // Explicit rescan anchored PAST the inserted text — the update
    // handler alone would re-activate a replacement that contains the
    // query ("a" → "aa"), and a no-op replacement emits no update at
    // all, stalling the cycle.
    refresh(query, caseSensitive, m.from + replacement.length)
    scrollToActive()
  }, [matches, active, replacement, query, caseSensitive, editor, refresh, scrollToActive])

  const replaceAll = useCallback(() => {
    if (matches.length === 0) return
    const tr = editor.state.tr
    for (const m of [...matches].sort((a, b) => b.from - a.from)) {
      tr.insertText(replacement, m.from, m.to)
    }
    editor.view.dispatch(tr)
  }, [matches, replacement, editor])

  // Global shortcuts: ⌘F / ⌥⌘F open, ⌘G / ⇧⌘G cycle while open, Esc
  // closes from anywhere (not just the bar's inputs). Physical KeyF —
  // macOS Option transforms e.key ("ƒ"). Gated on the editor pane being
  // visible: viewer tabs keep this component mounted but hidden.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.code === 'KeyF' && !e.shiftKey) {
        if (editor.view.dom.offsetParent === null) return
        e.preventDefault()
        openBar(e.altKey)
      } else if (open && mod && e.code === 'KeyG') {
        e.preventDefault()
        step(e.shiftKey ? -1 : 1)
      } else if (open && e.key === 'Escape') {
        close()
      }
    }
    // Bubble phase on purpose: popovers eat Esc in the capture phase
    // (see SmartControls' Menu), and that layering must win over us.
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, openBar, step, close, editor])

  // Anchor to the editor pane's right edge (fixed positioning — the pane
  // shares the window with sidebar / smart list / outline).
  useEffect(() => {
    if (!open) return
    const place = () => {
      const el = barRef.current
      if (!el) return
      const pane = editor.view.dom.getBoundingClientRect()
      el.style.right = `${Math.max(16, Math.round(window.innerWidth - pane.right) + 16)}px`
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open, editor])

  if (!open) return null

  const onFindKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      step(e.shiftKey ? -1 : 1)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
  }

  return (
    <div ref={barRef} className="find-bar" onMouseDown={(e) => e.stopPropagation()}>
      <div className="find-row">
        <input
          ref={findRef}
          className="find-input"
          placeholder={t('editor.findPlaceholder')}
          value={query}
          spellCheck={false}
          onChange={(e) => {
            setQuery(e.target.value)
            refresh(e.target.value, caseSensitive)
          }}
          onKeyDown={onFindKey}
        />
        <button
          className={cn('find-btn find-case', caseSensitive && 'on')}
          title={t('editor.matchCase')}
          onClick={() => {
            setCaseSensitive(!caseSensitive)
            refresh(query, !caseSensitive)
          }}
        >
          Aa
        </button>
        <span className="find-count">
          {query ? (matches.length === 0 ? '0' : `${active + 1}/${matches.length}`) : ''}
        </span>
        <button
          className="find-btn"
          title={t('editor.findPrev')}
          disabled={matches.length === 0}
          onClick={() => step(-1)}
        >
          <Icon name="arrowUp" size={13} />
        </button>
        <button
          className="find-btn"
          title={t('editor.findNext')}
          disabled={matches.length === 0}
          onClick={() => step(1)}
        >
          <Icon name="arrowDown" size={13} />
        </button>
        <button
          className={cn('find-btn', withReplace && 'on')}
          title={t('editor.replaceToggle')}
          onClick={() => setWithReplace(!withReplace)}
        >
          <Icon name="eraser" size={13} />
        </button>
        <button className="find-btn" title={t('editor.closeEsc')} onClick={close}>
          <Icon name="x" size={13} />
        </button>
      </div>
      {withReplace && (
        <div className="find-row">
          <input
            className="find-input"
            placeholder={t('editor.replacePlaceholder')}
            value={replacement}
            spellCheck={false}
            onChange={(e) => setReplacement(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                replaceOne()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                close()
              }
            }}
          />
          <button
            className="find-text-btn"
            disabled={matches.length === 0}
            onClick={replaceOne}
            title={t('editor.replaceCurrent')}
          >
            {t('editor.replace')}
          </button>
          <button className="find-text-btn" disabled={matches.length === 0} onClick={replaceAll}>
            {t('editor.replaceAll')}
          </button>
        </div>
      )}
    </div>
  )
}
