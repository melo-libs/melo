import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useEditorState, type Editor } from '@tiptap/react'
import { useAtomValue } from 'jotai'
import { getMarkRange } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import { CellSelection } from '@tiptap/pm/tables'
import { NodeRangeSelection } from '@tiptap/extension-node-range'
import { IpcChannels } from '@shared/types/ipc'
import { Icon } from '../Icon'
import { cn } from '../../lib/cn'
import { safeExternalUrl } from '../../lib/url'
import { useMenuNavigation } from '../../hooks/useMenuNavigation'
import { toast } from '../Toaster'
import i18n from '../../i18n'
import { workspacePathAtom } from '../../store/workspace'
import { appStore } from '../../store/appStore'
import { activeTabIdAtom } from '../../store/editor'
import { openImageView } from './ImageLightbox'
import { currentBlockType, turnInto } from './blockCommands'
import { FORMAT_OPTIONS, blockName } from './overlayData'
import type { BlockType } from './sampleDoc'

// Widest textual trigger face (by character count — close enough at one
// font size); the trigger reserves its width so the toolbar never resizes.
// Icon faces are 14px, narrower than "H1" — the ghost's min-width covers
// the all-icon case anyway.
const WIDEST_TRIGGER_TEXT = FORMAT_OPTIONS.map((o) => o.triggerText ?? '').reduce((a, b) =>
  b.length > a.length ? b : a,
)

const Caret = () => (
  <svg
    viewBox="0 0 12 12"
    width="10"
    height="10"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="bubble-caret"
  >
    <path d="M3 5l3 3 3-3" />
  </svg>
)

function FormatDropdown({
  editor,
  activeType,
  onClose,
}: {
  editor: Editor
  activeType: BlockType
  onClose: () => void
}) {
  // Same capture-phase keyboard handling as the slash menu — without it the
  // arrows keep moving the caret through the document under the open menu.
  const { selectedIndex, setSelectedIndex } = useMenuNavigation({
    editor,
    items: FORMAT_OPTIONS,
    onSelect: (opt) => {
      turnInto(editor, opt.id)
      onClose()
    },
    onClose,
  })

  // Open with the current type focused, not the first row.
  useEffect(() => {
    const i = FORMAT_OPTIONS.findIndex((o) => o.id === activeType)
    if (i >= 0) setSelectedIndex(i)
  }, [activeType, setSelectedIndex])

  return (
    <div className="bubble-dropdown bubble-format-dd" onMouseDown={(e) => e.preventDefault()}>
      <div className="bubble-dd-head">{i18n.t('editor.turnInto')}</div>
      {FORMAT_OPTIONS.map((opt, idx) => (
        <button
          key={opt.id}
          className={cn(
            'bubble-dd-item',
            opt.id === activeType && 'active',
            idx === selectedIndex && 'focused',
          )}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            turnInto(editor, opt.id)
            onClose()
          }}
        >
          <span className="bubble-dd-sample">
            {opt.icon ? <Icon name={opt.icon} size={14} /> : opt.sample}
          </span>
          <span className="bubble-dd-body">
            <span className="bubble-dd-name">{blockName(opt.id)}</span>
          </span>
          {opt.id === activeType && (
            <svg
              viewBox="0 0 18 18"
              width="13"
              height="13"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="bubble-dd-check"
            >
              <path d="M4 9.5l3.2 3.2L14 6" />
            </svg>
          )}
        </button>
      ))}
    </div>
  )
}

/** The link's full range (whole mark), or the current selection for a new link. */
function linkRange(editor: Editor, isActive: boolean): { from: number; to: number } {
  const { state } = editor
  if (isActive) {
    const range = getMarkRange(state.selection.$from, state.schema.marks.link)
    if (range) return range
  }
  return { from: state.selection.from, to: state.selection.to }
}

function LinkDropdown({
  editor,
  isActive,
  onClose,
}: {
  editor: Editor
  isActive: boolean
  onClose: () => void
}) {
  const { t } = useTranslation()
  // Prefill with the whole linked text, not just the selected slice — the
  // panel edits the link as a unit.
  const [initial] = useState(() => {
    const { from, to } = linkRange(editor, isActive)
    return {
      text: editor.state.doc.textBetween(from, to, ' '),
      url: (editor.getAttributes('link').href as string) ?? '',
    }
  })
  const [text, setText] = useState(initial.text)
  const [url, setUrl] = useState(initial.url)
  const urlRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    urlRef.current?.focus()
    urlRef.current?.select()
  }, [])

  const apply = () => {
    // Same allowlist as open(): the raw attr ends up verbatim in the saved
    // Markdown, so a javascript: href must never be stored either.
    const href = safeExternalUrl(url)
    if (!href) return
    const finalText = text.trim() || href
    if (finalText === initial.text) {
      editor.chain().focus().extendMarkRange('link').setLink({ href }).run()
    } else {
      // Text changed: replace the whole link range with the new linked text.
      // Inner marks (bold inside the old text) don't survive — acceptable,
      // the user just rewrote the text.
      const { from, to } = linkRange(editor, isActive)
      editor
        .chain()
        .focus()
        .insertContentAt(
          { from, to },
          { type: 'text', text: finalText, marks: [{ type: 'link', attrs: { href } }] },
        )
        .run()
    }
    onClose()
  }
  const remove = () => {
    // preventAutolink so the autolinker doesn't immediately re-mark the
    // still-URL-shaped text we just unlinked.
    editor
      .chain()
      .focus()
      .extendMarkRange('link')
      .unsetLink()
      .setMeta('preventAutolink', true)
      .run()
    onClose()
  }
  const open = () => {
    const safe = safeExternalUrl(url)
    // window.open is intercepted by the main process and routed to the
    // system browser (setWindowOpenHandler → shell.openExternal).
    if (safe) window.open(safe, '_blank', 'noopener,noreferrer')
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      apply()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
      editor.commands.focus()
    }
  }

  return (
    <div className="link-pop">
      <div className="lk-fields">
        <input
          type="text"
          placeholder={t('editor.linkTextPlaceholder')}
          value={text}
          spellCheck={false}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
        />
        <input
          ref={urlRef}
          type="url"
          placeholder={t('editor.linkUrlPlaceholder')}
          value={url}
          spellCheck={false}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={onKey}
        />
      </div>
      <div className="lk-actions">
        <button
          className="bubble-btn"
          title={t('editor.openLink')}
          disabled={!safeExternalUrl(url)}
          onMouseDown={(e) => e.preventDefault()}
          onClick={open}
        >
          <Icon name="externalLink" size={14} />
        </button>
        <button
          className="bubble-btn"
          title={t('editor.removeLink')}
          disabled={!isActive}
          onMouseDown={(e) => e.preventDefault()}
          onClick={remove}
        >
          <Icon name="trash" size={14} />
        </button>
        <span className="lk-spacer" />
        <button
          className="lk-apply"
          disabled={!safeExternalUrl(url)}
          onMouseDown={(e) => e.preventDefault()}
          onClick={apply}
          title={t('editor.applyEnter')}
        >
          Apply
        </button>
      </div>
    </div>
  )
}

/** Anchor for the toolbar: selection center-x plus first-line top/bottom. */
interface BubbleAnchor {
  x: number
  top: number
  bottom: number
}

/** Stable default returned by the editor-state selector when the selection is
 *  empty (toolbar hidden) — avoids the per-keystroke isActive/getAttributes
 *  work and lets the deepEqual dedupe so the menu never re-renders. */
const BUBBLE_EMPTY_STATE = {
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  code: false,
  blockType: 'p' as BlockType,
  highlighted: false,
  link: false,
}

type BubbleDD = 'format' | 'link' | null

/** Selection toolbar wired to real editor commands. */
export const EditorBubbleMenu = ({ editor, onShare }: { editor: Editor; onShare: () => void }) => {
  const { t } = useTranslation()
  const [openDD, setOpenDD] = useState<BubbleDD>(null)
  // Mirror for event handlers that fire before React re-renders (editor blur
  // fires the instant the link input steals focus).
  const openDDRef = useRef<BubbleDD>(null)
  const setDD = useCallback((v: BubbleDD) => {
    openDDRef.current = v
    setOpenDD(v)
  }, [])

  const [anchor, setAnchor] = useState<BubbleAnchor | null>(null)
  const elRef = useRef<HTMLDivElement>(null)
  const pressing = useRef(false)
  // Tracks whether the toolbar is currently visible so we can skip
  // repositioning during keyboard selection extension (the expensive
  // coordsAtPos + offsetWidth reflows only run on initial show or scroll).
  const visibleRef = useRef(false)

  const shouldShow = useCallback(() => {
    const sel = editor.state.selection
    // Any NodeSelection means "block grabbed as an object" (drag-handle press,
    // block menu open) — the text-formatting toolbar has no business there.
    if (sel instanceof NodeSelection) return false
    if (sel instanceof CellSelection) return false
    return (
      !sel.empty &&
      !(sel instanceof NodeRangeSelection) &&
      !editor.isActive('codeBlock') &&
      !editor.isActive('image')
    )
  }, [editor])

  const place = useCallback(() => {
    const { from, to } = editor.state.selection
    const start = editor.view.coordsAtPos(from)
    const end = editor.view.coordsAtPos(to)
    const sameLine = Math.abs(start.top - end.top) < 4
    const x = sameLine ? (start.left + end.right) / 2 : (start.left + start.right) / 2 + 60
    setAnchor({ x, top: start.top, bottom: start.bottom })
  }, [editor])

  useEffect(() => {
    const update = () => {
      if (pressing.current) return
      if (shouldShow()) {
        if (!visibleRef.current) {
          visibleRef.current = true
          place()
        }
      } else {
        visibleRef.current = false
        setAnchor(null)
      }
    }
    const hide = () => {
      // Editor blur fired by the link input taking focus — the toolbar (and
      // panel) must stay up while the user types the URL.
      if (openDDRef.current === 'link') return
      visibleRef.current = false
      setAnchor(null)
    }
    const onMouseDown = () => {
      pressing.current = true
    }
    const onMouseUp = () => {
      if (!pressing.current) return
      pressing.current = false
      visibleRef.current = false
      requestAnimationFrame(update)
    }
    const reposition = () => {
      if (shouldShow()) place()
    }
    editor.on('selectionUpdate', update)
    editor.on('blur', hide)
    editor.view.dom.addEventListener('mousedown', onMouseDown)
    document.addEventListener('mouseup', onMouseUp)
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      editor.off('selectionUpdate', update)
      editor.off('blur', hide)
      editor.view.dom.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('mouseup', onMouseUp)
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [editor, shouldShow, place])

  // This selector runs on every transaction (every keystroke), so it must be
  // cheap when the toolbar can't be shown. With an empty selection the menu is
  // hidden (see shouldShow), so bail before the ~16 isActive/getAttributes
  // calls and return a stable default the deepEqual can dedupe.
  const s = useEditorState({
    editor,
    selector: ({ editor }) => {
      if (editor.state.selection.empty) return BUBBLE_EMPTY_STATE
      return {
        bold: editor.isActive('bold'),
        italic: editor.isActive('italic'),
        underline: editor.isActive('underline'),
        strike: editor.isActive('strike'),
        code: editor.isActive('code'),
        blockType: currentBlockType(editor),
        highlighted: editor.isActive('highlight'),
        link: editor.isActive('link'),
      }
    },
  })

  // Text-sized buttons can measure fractional widths and push later
  // separators off the pixel grid, so snap them to whole pixels.
  useLayoutEffect(() => {
    const el = elRef.current
    if (!el || !anchor) return
    el.querySelectorAll<HTMLElement>('.bubble-turn').forEach((btn) => {
      btn.style.width = 'auto'
      // offsetWidth, not getBoundingClientRect: this runs during the pop
      // entry animation, whose scale(0.98) shrinks measured rects — the
      // snapped width can otherwise come up short. offsetWidth is layout-based
      // and immune to transforms.
      btn.style.width = `${btn.offsetWidth}px`
    })
  }, [anchor, s.blockType])

  useLayoutEffect(() => {
    const el = elRef.current
    if (!el || !anchor) return
    const pad = 8
    // Clamp within the editor surface, not the window — the bar overhanging
    // the sidebar read as broken. Falls back to the pane's left edge when
    // the pane is narrower than the bar.
    const pane = editor.view.dom.getBoundingClientRect()
    const minLeft = Math.max(pad, pane.left + pad)
    const maxLeft = Math.min(window.innerWidth - pad, pane.right) - el.offsetWidth
    const left = Math.max(minLeft, Math.min(anchor.x - el.offsetWidth / 2, maxLeft))
    let top = anchor.top - el.offsetHeight - 8
    if (top < pad) top = anchor.bottom + 8
    // coordsAtPos returns fractional coords; on a sub-pixel position the
    // toolbar's 1px border, separators and text all rasterize as soft
    // two-pixel smears. Snap to the pixel grid.
    el.style.left = `${Math.round(left)}px`
    el.style.top = `${Math.round(top)}px`
  }, [anchor, editor])

  // Close any open dropdown when the selection moves, so it doesn't carry
  // over onto a different selection.
  useEffect(() => {
    const close = () => setDD(null)
    editor.on('selectionUpdate', close)
    return () => {
      editor.off('selectionUpdate', close)
    }
  }, [editor, setDD])

  // While the link panel is open the editor is blurred (focus lives in the
  // URL input), so the usual blur/selection paths can't dismiss the toolbar.
  // Close on any press outside the bubble; hide entirely when that press is
  // also outside the editor.
  useEffect(() => {
    if (openDD !== 'link') return
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (elRef.current?.contains(target)) return
      setDD(null)
      if (!editor.view.dom.contains(target)) {
        visibleRef.current = false
        setAnchor(null)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [openDD, editor, setDD])

  // ⌘K with the toolbar up opens the link panel (matches the button hint).
  useEffect(() => {
    if (!anchor) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setDD('link')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [anchor, setDD])

  // Hide the toolbar while a block is being dragged (it would otherwise sit
  // over the document mid-drag). Toggle a body class rather than unmounting
  // the Tiptap BubbleMenu — unmount/remount per drag leaks its DOM element.
  useEffect(() => {
    const start = () => document.body.classList.add('melo-dragging')
    const end = () => document.body.classList.remove('melo-dragging')
    document.addEventListener('dragstart', start)
    document.addEventListener('dragend', end)
    document.addEventListener('drop', end)
    return () => {
      document.removeEventListener('dragstart', start)
      document.removeEventListener('dragend', end)
      document.removeEventListener('drop', end)
      document.body.classList.remove('melo-dragging')
    }
  }, [])

  const current = FORMAT_OPTIONS.find((f) => f.id === s.blockType) ?? FORMAT_OPTIONS[0]
  const cmd = (fn: (c: ReturnType<Editor['chain']>) => void) => () => {
    fn(editor.chain().focus())
  }

  if (!anchor) return null

  return (
    <div ref={elRef} className="bubble" style={{ position: 'fixed' }}>
      <button
        className={cn('bubble-btn bubble-turn', openDD === 'format' && 'open')}
        onMouseDown={(e) => {
          e.preventDefault()
          setDD(openDD === 'format' ? null : 'format')
        }}
      >
        <span className="bubble-turn-label">
          {/* Invisible widest face fixes the trigger width, so converting
              block types never resizes the toolbar. */}
          <span className="bubble-turn-ghost" aria-hidden="true">
            {WIDEST_TRIGGER_TEXT}
          </span>
          <span className="bubble-turn-current">
            {current.icon ? <Icon name={current.icon} size={14} /> : current.triggerText}
          </span>
        </span>
        <Caret />
      </button>
      {openDD === 'format' && (
        <FormatDropdown editor={editor} activeType={s.blockType} onClose={() => setDD(null)} />
      )}

      <span className="bubble-sep" />

      <button
        className="bubble-btn"
        data-active={s.bold}
        onMouseDown={(e) => e.preventDefault()}
        onClick={cmd((c) => c.toggleBold().run())}
        title={t('editor.bold')}
      >
        <Icon name="bold" size={14} />
      </button>
      <button
        className="bubble-btn"
        data-active={s.italic}
        onMouseDown={(e) => e.preventDefault()}
        onClick={cmd((c) => c.toggleItalic().run())}
        title={t('editor.italic')}
      >
        <Icon name="italic" size={14} />
      </button>
      <button
        className="bubble-btn"
        data-active={s.underline}
        onMouseDown={(e) => e.preventDefault()}
        onClick={cmd((c) => c.toggleUnderline().run())}
        title={t('editor.underline')}
      >
        <Icon name="underline" size={14} />
      </button>
      <button
        className="bubble-btn"
        data-active={s.strike}
        onMouseDown={(e) => e.preventDefault()}
        onClick={cmd((c) => c.toggleStrike().run())}
        title={t('editor.strikethrough')}
      >
        <Icon name="strike" size={14} />
      </button>
      <button
        className="bubble-btn"
        data-active={s.code}
        onMouseDown={(e) => e.preventDefault()}
        onClick={cmd((c) => c.toggleCode().run())}
        title={t('editor.inlineCode')}
      >
        <Icon name="code" size={14} />
      </button>

      <span className="bubble-sep" />

      <button
        className="bubble-btn"
        data-active={s.link}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (openDD === 'link') {
            setDD(null)
            // Focus sits in the URL input; hand it back so the blur-driven
            // dismiss paths work again (the toolbar would otherwise linger).
            editor.commands.focus()
          } else {
            setDD('link')
          }
        }}
        title={t('editor.addLink')}
      >
        <Icon name="link" size={14} />
      </button>
      {openDD === 'link' && (
        <LinkDropdown editor={editor} isActive={s.link} onClose={() => setDD(null)} />
      )}
      <button
        className="bubble-btn bubble-hl-btn"
        data-active={s.highlighted}
        onMouseDown={(e) => e.preventDefault()}
        onClick={cmd((c) => c.toggleHighlight().run())}
        title={t('editor.highlight')}
      >
        <span className="bubble-hl-letter-trigger">A</span>
      </button>

      <span className="bubble-sep" />
      <button
        className="bubble-btn"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onShare}
        title={t('editor.shareAsImage')}
      >
        <Icon name="share" size={14} />
      </button>
    </div>
  )
}

/* ============================================================
   Image bubble — appears when an image node is selected. Edits the
   address (workspace-relative path or https URL) and the alt text
   (rendered as the caption), plus open / copy / delete.
   ============================================================ */

/** Allowlist for the src attr: http(s), or a scheme-less workspace-relative
 *  path. Anything else (javascript:, file:, data:) is refused — the raw attr
 *  is saved verbatim into the Markdown, and the relative form is later joined
 *  onto the workspace root (app:// and Reveal), so `..` segments, absolute
 *  paths and backslashes are rejected too. */
function safeImageSrc(raw: string): string | null {
  const s = raw.trim()
  if (!s) return null
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(s)?.[1]?.toLowerCase()
  if (scheme) return scheme === 'http' || scheme === 'https' ? s : null
  const rel = s.replace(/^\.\//, '')
  if (rel.startsWith('/') || rel.includes('\\') || /(^|\/)\.\.(\/|$)/.test(rel)) return null
  return rel
}

export const ImageBubble = ({ editor }: { editor: Editor }) => {
  const [sel, setSel] = useState<{ pos: number; src: string; alt: string } | null>(null)
  const [anchor, setAnchor] = useState<BubbleAnchor | null>(null)
  const elRef = useRef<HTMLDivElement>(null)
  const workspacePath = useAtomValue(workspacePathAtom)

  const readSel = useCallback(() => {
    const s = editor.state.selection
    if (s instanceof NodeSelection && s.node.type.name === 'image') {
      return {
        pos: s.from,
        src: (s.node.attrs.src as string | null) ?? '',
        alt: (s.node.attrs.alt as string | null) ?? '',
      }
    }
    return null
  }, [editor])

  const place = useCallback(
    (pos: number) => {
      const dom = editor.view.nodeDOM(pos) as HTMLElement | null
      if (!dom) return
      const r = dom.getBoundingClientRect()
      setAnchor({ x: r.left + r.width / 2, top: r.top, bottom: r.bottom })
    },
    [editor],
  )

  useEffect(() => {
    const update = () => {
      const s = readSel()
      setSel(s)
      if (s) place(s.pos)
      else setAnchor(null)
    }
    const hide = () => {
      // Focus moving into the panel's own inputs must not dismiss it; the
      // move lands after blur, hence the frame delay.
      requestAnimationFrame(() => {
        if (elRef.current?.contains(document.activeElement)) return
        setSel(null)
        setAnchor(null)
      })
    }
    const reposition = () => {
      const s = readSel()
      if (s) place(s.pos)
    }
    editor.on('selectionUpdate', update)
    // Attribute-only edits (Apply) don't move the selection, so
    // selectionUpdate alone would leave Open/Copy on the old address.
    editor.on('update', update)
    editor.on('blur', hide)
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      editor.off('selectionUpdate', update)
      editor.off('update', update)
      editor.off('blur', hide)
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [editor, readSel, place])

  // While an input holds focus the editor is blurred and stays blurred —
  // a later click on the sidebar produces no second blur, so dismissal
  // needs an explicit outside-press check (same as the link panel).
  useEffect(() => {
    if (!sel) return
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (elRef.current?.contains(target)) return
      if (editor.view.dom.contains(target)) return
      setSel(null)
      setAnchor(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [sel, editor])

  // Same clamp-and-snap placement as the text toolbar.
  useLayoutEffect(() => {
    const el = elRef.current
    if (!el || !anchor) return
    const pad = 8
    const pane = editor.view.dom.getBoundingClientRect()
    const minLeft = Math.max(pad, pane.left + pad)
    const maxLeft = Math.min(window.innerWidth - pad, pane.right) - el.offsetWidth
    const left = Math.max(minLeft, Math.min(anchor.x - el.offsetWidth / 2, maxLeft))
    let top = anchor.top - el.offsetHeight - 8
    if (top < pad) top = anchor.bottom + 8
    el.style.left = `${Math.round(left)}px`
    el.style.top = `${Math.round(top)}px`
  }, [anchor, editor])

  if (!sel || !anchor) return null
  return (
    <div ref={elRef} className="bubble img-pop" style={{ position: 'fixed' }}>
      <ImagePanel
        key={`${sel.pos}:${sel.src}`}
        sel={sel}
        editor={editor}
        workspacePath={workspacePath}
        onClose={() => {
          setSel(null)
          setAnchor(null)
        }}
      />
    </div>
  )
}

function ImagePanel({
  sel,
  editor,
  workspacePath,
  onClose,
}: {
  sel: { pos: number; src: string; alt: string }
  editor: Editor
  workspacePath: string | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [src, setSrc] = useState(sel.src)
  const [alt, setAlt] = useState(sel.alt)
  const [busy, setBusy] = useState(false)
  const isRemote = /^https?:/i.test(sel.src)

  const download = async () => {
    setBusy(true)
    const tabAtStart = appStore.get(activeTabIdAtom)
    const res = await window.api.invoke(IpcChannels.InvokeDownloadRemoteImage, { url: sel.src })
    setBusy(false)
    if (!res.success || !res.data) {
      toast(t('editor.imageDownloadFailed'))
      return
    }
    // The doc may have shifted (or been swapped by a tab switch) during
    // the download — never write through a stale numeric position.
    if (appStore.get(activeTabIdAtom) !== tabAtStart) {
      toast(t('editor.imageKeptRemoteDocChanged'))
      return
    }
    const { doc } = editor.state
    let target: number | null = null
    const at = doc.nodeAt(sel.pos)
    if (at?.type.name === 'image' && at.attrs.src === sel.src) target = sel.pos
    else
      doc.descendants((n, p) => {
        if (target == null && n.type.name === 'image' && n.attrs.src === sel.src) {
          target = p
          return false
        }
        return true
      })
    if (target == null) {
      toast(t('editor.imageNotFound'))
      return
    }
    editor
      .chain()
      .focus()
      .setNodeSelection(target)
      .updateAttributes('image', { src: res.data.filePath })
      .run()
    toast(t('editor.imageSaved'))
  }

  const apply = () => {
    const safe = safeImageSrc(src)
    if (!safe) return
    editor
      .chain()
      .focus()
      .setNodeSelection(sel.pos)
      .updateAttributes('image', { src: safe, alt: alt.trim() || null })
      .run()
  }
  const open = () => {
    const safe = safeImageSrc(sel.src)
    if (!safe) return
    if (/^https?:/i.test(safe)) {
      window.open(safe, '_blank', 'noopener,noreferrer')
    } else if (workspacePath) {
      window.api.invoke(IpcChannels.InvokeRevealInFinder, { path: `${workspacePath}/${safe}` })
    }
  }
  const copy = () => {
    navigator.clipboard.writeText(sel.src)
    toast(t('editor.addressCopied'))
  }
  const remove = () => {
    editor.chain().focus().setNodeSelection(sel.pos).deleteSelection().run()
    onClose()
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      apply()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
      editor.commands.focus()
    }
  }

  return (
    <>
      <div className="lk-fields">
        <input
          type="text"
          placeholder={t('editor.imageAddressPlaceholder')}
          value={src}
          spellCheck={false}
          onChange={(e) => setSrc(e.target.value)}
          onKeyDown={onKey}
        />
        <input
          type="text"
          placeholder={t('editor.imageAltPlaceholder')}
          value={alt}
          spellCheck={false}
          onChange={(e) => setAlt(e.target.value)}
          onKeyDown={onKey}
        />
      </div>
      <div className="lk-actions">
        <button
          className="bubble-btn"
          title={t('editor.viewImage')}
          disabled={!safeImageSrc(sel.src)}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => openImageView(/^https?:/i.test(sel.src) ? sel.src : `app://${sel.src}`)}
        >
          <Icon name="eye" size={14} />
        </button>
        {isRemote && (
          <button
            className="bubble-btn"
            title={t('editor.downloadToWorkspace')}
            disabled={busy}
            onMouseDown={(e) => e.preventDefault()}
            onClick={download}
          >
            <Icon name="download" size={14} />
          </button>
        )}
        <button
          className="bubble-btn"
          title={isRemote ? t('editor.openInBrowser') : t('ctx.revealInFinder')}
          disabled={!safeImageSrc(sel.src) || (!isRemote && !workspacePath)}
          onMouseDown={(e) => e.preventDefault()}
          onClick={open}
        >
          <Icon name="externalLink" size={14} />
        </button>
        <button
          className="bubble-btn"
          title={t('editor.copyAddress')}
          disabled={!sel.src}
          onMouseDown={(e) => e.preventDefault()}
          onClick={copy}
        >
          <Icon name="copy" size={14} />
        </button>
        <button
          className="bubble-btn"
          title={t('editor.deleteImage')}
          onMouseDown={(e) => e.preventDefault()}
          onClick={remove}
        >
          <Icon name="trash" size={14} />
        </button>
        <span className="lk-spacer" />
        <button
          className="lk-apply"
          disabled={!safeImageSrc(src)}
          onMouseDown={(e) => e.preventDefault()}
          onClick={apply}
          title={t('editor.applyEnter')}
        >
          Apply
        </button>
      </div>
    </>
  )
}
