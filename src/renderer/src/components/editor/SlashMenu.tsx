import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { IpcChannels } from '@shared/types/ipc'
import { type Editor } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import Suggestion, { exitSuggestion, type SuggestionProps } from '@tiptap/suggestion'
import { flip, offset, shift, size } from '@floating-ui/react'
import { useFloatingElement } from '../../hooks/useFloatingElement'
import { useMenuNavigation } from '../../hooks/useMenuNavigation'
import { Icon } from '../Icon'
import { SLASH_COMMANDS, blockName, slashSectionLabel, type SlashItem } from './overlayData'
import { toast } from '../Toaster'
import i18n from '../../i18n'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SlashListItem extends SlashItem {
  section: string
}

// ---------------------------------------------------------------------------
// Suggestion helpers (pure logic, no rendering)
// ---------------------------------------------------------------------------

const slashPluginKey = new PluginKey('slashCommand')

/** Flatten the sections, then filter + relevance-rank against the query.
 *  Empty query keeps the curated grouped order; a query collapses to one
 *  flat list ranked by exact > prefix > substring match (Notion behavior). */
function flatItems(query: string): SlashListItem[] {
  const flat: SlashListItem[] = SLASH_COMMANDS.flatMap((s) =>
    s.items.map((i) => ({ ...i, section: s.section })),
  )
  const q = query.trim().toLowerCase()
  if (!q) return flat
  return flat
    .filter((i) => {
      if (i.name.toLowerCase().includes(q)) return true
      if (blockName(i.id).toLowerCase().includes(q)) return true
      if (i.desc.toLowerCase().includes(q)) return true
      return i.keywords?.some((k) => k.toLowerCase().includes(q)) ?? false
    })
    .sort((a, b) => {
      const an = a.name.toLowerCase()
      const bn = b.name.toLowerCase()
      if (an === q && bn !== q) return -1
      if (bn === q && an !== q) return 1
      if (an.startsWith(q) && !bn.startsWith(q)) return -1
      if (bn.startsWith(q) && !an.startsWith(q)) return 1
      return 0
    })
}

/**
 * Delete the "/query" the user typed, computing the start from the LIVE
 * selection rather than trusting the Suggestion plugin's `range`.
 *
 * Why this matters for the Chinese-IME flicker: the floating menu is anchored
 * to the `<span data-decoration-id>` DOM node, and floating-ui's autoUpdate
 * keeps a ResizeObserver on it. When the IME commits a composition,
 * ProseMirror flushes and *redraws* the decorated region, detaching that span.
 * If we delete via a `.focus()`-prefixed combined chain using the plugin's
 * regex-derived `range`, the focus re-asserts the DOM selection mid-redraw and
 * the combined transform reflows in the same tick — the observer fires
 * `update()` against the now-detached span (getBoundingClientRect → 0,0) and
 * the menu snaps to the top-left corner before the close transition finishes.
 *
 * The reference instead deletes the query as its OWN, focus-free transaction
 * computed from the live cursor, then runs the block transform separately. No
 * focus re-assert, no coupled reflow → the observer never sees the stale node.
 */
function deleteSlashQuery(editor: Editor): void {
  const { state, view } = editor
  const { selection } = state
  const cursor = selection.$from.pos
  const before = selection.$head.nodeBefore
  const slashIndex = before?.text ? before.text.lastIndexOf('/') : -1
  const start =
    slashIndex === -1 || !before?.text
      ? selection.$from.start()
      : cursor - before.text.slice(slashIndex).length
  view.dispatch(state.tr.deleteRange(start, cursor))
}

function mathNodePos(editor: Editor, typeName: string): number {
  const { from } = editor.state.selection
  for (const p of [from - 1, from, from - 2]) {
    if (p < 0) continue
    const n = editor.state.doc.nodeAt(p)
    if (n && n.type.name === typeName) return p
  }
  return -1
}

function insertAndEditMath(editor: Editor, block: boolean) {
  const typeName = block ? 'blockMath' : 'inlineMath'
  editor
    .chain()
    .focus()
    .insertContent({ type: typeName, attrs: { latex: '' } })
    .run()
  const pos = mathNodePos(editor, typeName)
  if (pos < 0) return
  requestAnimationFrame(() => {
    window.dispatchEvent(
      new CustomEvent('melo:math-edit', { detail: { pos, latex: '', block, fresh: true } }),
    )
  })
}

function runSlash(editor: Editor, item: SlashListItem) {
  // Delete the "/query" first, as its own focus-free transaction (see
  // deleteSlashQuery). Item handlers below only run their block transform.
  deleteSlashQuery(editor)
  if (item.id === 'image') {
    // Native picker in the main process; the file is copied into .assets
    // and inserted by its workspace-relative path (same shape as paste).
    void window.api.invoke(IpcChannels.InvokeImportImage, undefined).then((res) => {
      if (!res.success) {
        toast(res.error || i18n.t('editor.imageSaveFailed'))
        return
      }
      if (!res.data) return // cancelled
      const node = editor.state.schema.nodes.image.create({ src: res.data.filePath })
      editor.view.dispatch(editor.state.tr.replaceSelectionWith(node).scrollIntoView())
    })
    return
  }
  if (item.id === 'link') {
    const caret = editor.view.coordsAtPos(editor.state.selection.from)
    window.dispatchEvent(
      new CustomEvent('melo:linkpicker', { detail: { x: caret.left, y: caret.bottom + 6 } }),
    )
    return
  }
  const chain = editor.chain().focus().clearNodes()
  switch (item.id) {
    case 'text':
      chain.setParagraph().run()
      break
    case 'h1':
      chain.setHeading({ level: 1 }).run()
      break
    case 'h2':
      chain.setHeading({ level: 2 }).run()
      break
    case 'h3':
      chain.setHeading({ level: 3 }).run()
      break
    case 'bullet':
      chain.toggleBulletList().run()
      break
    case 'num':
      chain.toggleOrderedList().run()
      break
    case 'task':
      chain.toggleTaskList().run()
      break
    case 'quote':
      chain.toggleBlockquote().run()
      break
    case 'code':
      chain.toggleCodeBlock().run()
      break
    case 'table':
      chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
      break
    case 'equation':
      insertAndEditMath(editor, true)
      break
    case 'inline-math':
      insertAndEditMath(editor, false)
      break
    case 'divider':
      chain.setHorizontalRule().run()
      break
    default:
      chain.run()
  }
}

// ---------------------------------------------------------------------------
// SlashMenu — pure React Suggestion popup: positioning/dismissal via
// useFloatingElement, keyboard nav via useMenuNavigation, deletion split out as
// a focus-free transaction, and onSelect closes the popup BEFORE running the
// command.
//
// The floating anchor is a clientRect fn, NOT the decoration DOM node:
// anchoring to the node makes floating-ui observe it with a ResizeObserver, and
// a Chinese-IME composition commit detaches that node — firing a recompute that
// reads rect 0,0 and snaps the menu to the corner. The clientRect fn re-queries
// the live node by id, so the observer never sits on the volatile node.
// ---------------------------------------------------------------------------

export function SlashMenu({ editor }: { editor: Editor }) {
  useTranslation()
  const [show, setShow] = useState(false)
  const [command, setCommand] = useState<((item: SlashListItem) => void) | null>(null)
  const [items, setItems] = useState<SlashListItem[]>([])
  const [query, setQuery] = useState('')
  // Anchor via suggestion's clientRect fn (re-queries the live "/query"
  // decoration by id) instead of holding the decoration DOM node. floating-ui's
  // autoUpdate then never attaches a ResizeObserver to that node, so the IME
  // tearing it out mid-composition can't fire a recompute against a detached
  // node (rect 0,0 → corner). Passing null while hidden freezes the position
  // for the close transition.
  const rectRef = useRef<(() => DOMRect | null) | null>(null)
  const reference = useCallback(() => rectRef.current?.() ?? null, [])
  // The floating hook's ref is a callback; keep our own handle for
  // scroll-into-view queries.
  const rootRef = useRef<HTMLDivElement | null>(null)

  const { ref, style, getFloatingProps, isMounted } = useFloatingElement(
    show,
    show ? reference : null,
    80,
    {
      placement: 'bottom-start',
      middleware: [
        offset(8),
        flip({ mainAxis: true, crossAxis: false, padding: 8 }),
        shift({ padding: 8 }),
        size({
          padding: 8,
          apply({ availableHeight, elements }) {
            elements.floating.style.setProperty(
              '--slash-max-height',
              `${Math.min(384, availableHeight)}px`,
            )
          },
        }),
      ],
      onOpenChange(open) {
        if (!open) setShow(false)
      },
    },
  )

  const closePopup = useCallback(() => setShow(false), [])

  // Stable identity — an inline merged ref would make React re-run the
  // floating-ui callback (null → node) on every render.
  const setRootRef = useCallback(
    (node: HTMLDivElement | null) => {
      ref(node)
      rootRef.current = node
    },
    [ref],
  )

  // -----------------------------------------------------------------------
  // Register the Suggestion plugin. Render callbacks are plain setState — no
  // ReactRenderer, no flushSync, so DragHandle re-renders can't cascade in.
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (editor.isDestroyed) return

    const existing = editor.state.plugins.find((p) => p.spec.key === slashPluginKey)
    if (existing) editor.unregisterPlugin(slashPluginKey)

    const plugin = Suggestion<SlashListItem>({
      editor,
      pluginKey: slashPluginKey,
      char: '/',
      startOfLine: true,
      decorationClass: 'slash-decoration',
      decorationContent: 'Filter…',
      allow: ({ editor: ed }) => !ed.isActive('codeBlock'),
      items: ({ query }) => flatItems(query),
      command: ({ editor: ed, props }) => runSlash(ed, props),
      render: () => ({
        onStart: ({
          command: cmd,
          items: list,
          query: q,
          clientRect,
        }: SuggestionProps<SlashListItem>) => {
          rectRef.current = clientRect ?? null
          setCommand(() => cmd)
          setItems(list)
          setQuery(q)
          setShow(true)
        },
        onUpdate: ({
          command: cmd,
          items: list,
          query: q,
          clientRect,
        }: SuggestionProps<SlashListItem>) => {
          rectRef.current = clientRect ?? null
          setCommand(() => cmd)
          setItems(list)
          setQuery(q)
        },
        onExit: () => {
          // DragHandle's plugin re-registration destroys ALL plugin views,
          // firing onExit even while the suggestion is still active. Skip
          // teardown so the popup survives the spurious destroy.
          try {
            const s = slashPluginKey.getState(editor.state)
            if (s?.active) return
          } catch {
            /* editor gone — fall through */
          }
          rectRef.current = null
          setCommand(null)
          setItems([])
          setQuery('')
          setShow(false)
        },
      }),
    })

    editor.registerPlugin(plugin)
    return () => {
      if (!editor.isDestroyed) editor.unregisterPlugin(slashPluginKey)
    }
  }, [editor])

  const onSelect = useCallback(
    (item: SlashListItem) => {
      // Close first, THEN run the command, so the menu starts its fade while
      // the decoration anchor is still valid (avoids the corner-snap).
      closePopup()
      command?.(item)
    },
    [closePopup, command],
  )

  const onClose = useCallback(() => {
    exitSuggestion(editor.view, slashPluginKey)
    closePopup()
  }, [editor, closePopup])

  const { selectedIndex } = useMenuNavigation({ editor, query, items, onSelect, onClose })

  // Keep the keyboard selection visible — arrowing past the fold scrolls
  // the list. `nearest` keeps the movement minimal; .slash-list is the only
  // scrollable ancestor with overflow, so in practice only it moves.
  useEffect(() => {
    if (selectedIndex === undefined) return
    rootRef.current
      ?.querySelector(`[data-index="${selectedIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  if (!isMounted || !show) return null
  if (!items.length) return null

  // Empty query keeps the curated section grouping; a query shows the flat
  // relevance-ranked list. The flat index always matches the visual order,
  // so keyboard selection lines up with what's on screen.
  const grouped = !query.trim()
  let flat = -1
  const sections: { section: string; items: { item: SlashListItem; index: number }[] }[] = []
  for (const item of items) {
    flat++
    const label = grouped ? item.section : ''
    const last = sections[sections.length - 1]
    if (last && last.section === label) last.items.push({ item, index: flat })
    else sections.push({ section: label, items: [{ item, index: flat }] })
  }

  return (
    <div
      ref={setRootRef}
      className="slash"
      style={style}
      {...getFloatingProps()}
      onPointerDown={(e) => e.preventDefault()}
    >
      <div className="slash-list">
        {sections.map((sec, si) => (
          <div key={sec.section || si}>
            {sec.section && (
              <div className="slash-section-label">{slashSectionLabel(sec.section)}</div>
            )}
            {sec.items.map(({ item, index }) => (
              <div
                key={item.id}
                className="slash-item"
                data-index={index}
                data-focus={index === selectedIndex}
                onClick={() => onSelect(item)}
              >
                <span className="slash-glyph">
                  {item.icon ? <Icon name={item.icon} size={14} /> : item.sample}
                </span>
                <div className="slash-body">
                  <div className="slash-name">{blockName(item.id)}</div>
                </div>
                {item.short && <span className="slash-shortcut">{item.short}</span>}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
