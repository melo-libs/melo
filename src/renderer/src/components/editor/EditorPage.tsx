import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import i18n from '../../i18n'
import { EditorContent, useEditor } from '@tiptap/react'
import { EditorState, NodeSelection, Selection } from '@tiptap/pm/state'
import { offset } from '@floating-ui/dom'
import { DragHandle } from '@tiptap/extension-drag-handle-react'
import { TableOfContents, getHierarchicalIndexes } from '@tiptap/extension-table-of-contents'
import type { Node as PMNode } from '@tiptap/pm/model'
import { useAtomValue, useSetAtom } from 'jotai'
import { workspacePathAtom } from '../../store/workspace'
import { editorExtensions } from './tiptapExtensions'
import { EditorBubbleMenu, ImageBubble } from './BubbleMenu'
import { ImageLightbox } from './ImageLightbox'
import { FindBar } from './FindBar'
import { CodeLangPicker } from './CodeLangPicker'
import { downloadRemoteImages } from './localizeImages'
import { exportHtml, exportMarkdown, exportPdf } from './exporters'
import { BlockMenu } from './BlockMenu'
import { Icon } from '../Icon'
import { tocAtom } from '../../store/toc'
import { wordCountAtom } from '../../store/editor'
import { ClipBanner, parseClipSource, type ClipSource } from './ClipBanner'
import { WikilinkLayer } from './links/WikilinkLayer'
import { LinkPicker, type LinkPick } from './links/LinkPicker'
import { sanitizeWikilinkTarget } from './links/Wikilink'
import { Backlinks } from './links/Backlinks'
import { MathEditor } from './MathEditor'
import type { SharePayload } from './ShareCard'
import { SlashMenu } from './SlashMenu'
import { TableHandle } from './table/TableHandle'
import { TableExtendButtons } from './table/TableExtendButtons'
import { TableSelectionOverlay } from './table/TableSelectionOverlay'
import {
  attachEditor,
  activateSession,
  flush,
  getFrontmatter,
  noteEdited,
  registerReloadApplier,
  setDisplayedSession,
  snapshotDisplayed,
} from '../../store/documentSession'
import './links/links.scss'

export interface EditorPageProps {
  activeTabId: string | null
  title: string
  width: 'narrow' | 'default' | 'wide' | 'full'
  onShare: (payload: SharePayload) => void
}

type BlockMenuState = { node: PMNode; pos: number; x: number; y: number }

/**
 * The writing surface — a real Tiptap editor. Title (first H1) and subtitle
 * (lede paragraph) are editable document content. Bubble menu (selection),
 * slash command, and the drag handle + block menu are layered on top.
 */
export const EditorPage = ({ activeTabId, title, width, onShare }: EditorPageProps) => {
  const setToc = useSetAtom(tocAtom)
  const setWordCount = useSetAtom(wordCountAtom)
  const prevTocKey = useRef('')

  // TableOfContents needs a closure over setToc + the scroll container, so
  // it's added here rather than in the shared extension list.
  const extensions = useMemo(
    () => [
      ...editorExtensions,
      TableOfContents.configure({
        getIndex: getHierarchicalIndexes,
        // The extension only adds its own `data-toc-id` attribute and
        // preserves the heading's real `id`, so existing #anchor links keep
        // working. anchorTypes defaults to ['heading'] (matches StarterKit).
        scrollParent: () => document.querySelector<HTMLElement>('.ed-scroll') ?? window,
        onUpdate: (content) => {
          const toc = content.map((i) => ({
            id: i.id,
            level: Math.min(i.level, 3),
            text: i.textContent,
            active: i.isActive,
          }))
          const key = JSON.stringify(toc)
          if (key === prevTocKey.current) return
          prevTocKey.current = key
          setToc(toc)
        },
      }),
    ],
    [setToc],
  )

  // Loaded per-document metadata for the clip banner (frontmatter lives in
  // the session; this mirrors it into React on each load).
  const [docInfo, setDocInfo] = useState<{ frontmatter: string; body: string } | null>(null)
  const clipSource = useMemo<ClipSource | null>(
    () => (docInfo ? parseClipSource(docInfo.frontmatter) : null),
    [docInfo],
  )

  const editor = useEditor({
    extensions,
    content: '',
    autofocus: 'start',
  })

  // Register the editor and its edit notifications with the session module.
  // Only document-changing transactions count as edits — `update` also
  // fires for state swaps like setEditable, which must not mark dirty.
  useEffect(() => {
    if (!editor) return
    attachEditor(editor)
    const onUpdate = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (transaction.docChanged) noteEdited()
    }
    editor.on('update', onUpdate)
    return () => {
      editor.off('update', onUpdate)
      attachEditor(null)
    }
  }, [editor])

  const updateWordCount = useRef(() => {})
  useEffect(() => {
    if (!editor) return
    let idle = 0
    const count = () => {
      const text = editor.state.doc.textContent
      const cjk = (text.match(/[一-鿿㐀-䶿豈-﫿]/g) || []).length
      const latin = text
        .replace(/[一-鿿㐀-䶿豈-﫿]/g, ' ')
        .split(/\s+/)
        .filter(Boolean).length
      setWordCount(cjk + latin)
    }
    updateWordCount.current = count
    const schedule = () => {
      cancelIdleCallback(idle)
      idle = requestIdleCallback(count)
    }
    count()
    editor.on('update', schedule)
    return () => {
      editor.off('update', schedule)
      cancelIdleCallback(idle)
    }
  }, [editor, setWordCount])

  // Current block under the drag handle, tracked for the gutter actions.
  const current = useRef<{ node: PMNode; pos: number } | null>(null)

  // Vertically center the handle on the block's *first line* instead of the
  // default `left-start` top-alignment, which reads as misaligned next to tall
  // lines (an H1's line box is ~2× the handle's height). First-line center =
  // padding-top + line-height / 2, measured off the hovered block's DOM
  // (onNodeChange fires before the extension repositions, so `current` is
  // fresh here). Blocks shorter than their line box (hr) center on the block.
  const dragHandlePosition = useMemo(
    () => ({
      middleware: [
        offset(({ rects }) => {
          let firstLineCenter = rects.reference.height / 2
          const pos = current.current?.pos
          if (editor && pos !== undefined && pos >= 0) {
            const dom = editor.view.nodeDOM(pos)
            if (dom instanceof HTMLElement) {
              const style = window.getComputedStyle(dom)
              const lineHeight = parseFloat(style.lineHeight)
              if (Number.isFinite(lineHeight)) {
                const paddingTop = parseFloat(style.paddingTop) || 0
                firstLineCenter = Math.min(paddingTop + lineHeight / 2, firstLineCenter)
              }
            }
          }
          // mainAxis 2: the caret is a 2px bar shifted 1px left of the
          // insertion point, and the handle's opaque paper backdrop sits
          // above it in paint order — flush against the text it clipped
          // the caret's left pixel at block starts.
          return { mainAxis: 2, crossAxis: firstLineCenter - rects.floating.height / 2 }
        }),
      ],
    }),
    [editor],
  )
  const [blockMenu, setBlockMenu] = useState<BlockMenuState | null>(null)
  // LinkPicker popover, opened by the "Link to note" slash item.
  const [linkPicker, setLinkPicker] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const open = (e: Event) => {
      const { x, y } = (e as CustomEvent).detail ?? {}
      setLinkPicker({ x, y })
    }
    window.addEventListener('melo:linkpicker', open)
    return () => window.removeEventListener('melo:linkpicker', open)
  }, [])

  const insertWikilink = (pick: LinkPick) => {
    setLinkPicker(null)
    const target = sanitizeWikilinkTarget(pick.title)
    if (!target) return
    editor
      ?.chain()
      .focus()
      .insertContent({
        type: 'wikilink',
        attrs: { target, label: null },
      })
      .run()
  }
  // Put a document body into the editor: setContent, then rebuild the
  // EditorState so undo history never crosses documents. External-change
  // reloads keep the caret and scroll position best-effort; tab switches
  // reset both.
  const applyBody = useCallback(
    (body: string, opts?: { preserveView?: boolean }) => {
      if (!editor) return
      const scrollEl = document.querySelector<HTMLElement>('.ed-scroll')
      const prevScroll = opts?.preserveView ? (scrollEl?.scrollTop ?? 0) : 0
      const prevFrom = opts?.preserveView ? editor.state.selection.from : null
      editor.commands.setContent(body, { contentType: 'markdown', emitUpdate: false })
      const freshState = EditorState.create({
        doc: editor.state.doc,
        plugins: editor.state.plugins,
      })
      editor.view.updateState(freshState)
      if (prevFrom !== null) {
        try {
          const pos = Math.min(prevFrom, editor.state.doc.content.size)
          editor.view.dispatch(
            editor.state.tr.setSelection(Selection.near(editor.state.doc.resolve(pos))),
          )
        } catch {
          // Position no longer resolvable in the reloaded document.
        }
      }
      if (scrollEl) scrollEl.scrollTop = prevScroll
      updateWordCount.current()
      setBlockMenu(null)
    },
    [editor],
  )

  useEffect(() => {
    registerReloadApplier((body) => {
      applyBody(body, { preserveView: true })
      setDocInfo((d) => (d ? { ...d, body } : d))
    })
    return () => registerReloadApplier(null)
  }, [applyBody])

  // "Download remote images" from the top-bar More menu.
  useEffect(() => {
    if (!editor) return
    const run = () => void downloadRemoteImages(editor)
    window.addEventListener('melo:download-remote-images', run)
    return () => window.removeEventListener('melo:download-remote-images', run)
  }, [editor])

  // Export from the top-bar menu. Guarded on an editable document — with
  // a viewer tab (or no tab) in front, the hidden editor must not export.
  const wsPathForExport = useAtomValue(workspacePathAtom)
  useEffect(() => {
    if (!editor) return
    const run = (e: Event) => {
      const { format } = (e as CustomEvent<{ format: 'md' | 'html' | 'pdf' }>).detail
      if (!activeTabId || !editor.isEditable || !wsPathForExport) return
      if (format === 'md') {
        void exportMarkdown(editor, title, wsPathForExport, getFrontmatter(activeTabId))
      } else {
        void (format === 'html' ? exportHtml : exportPdf)(editor, title, wsPathForExport)
      }
    }
    window.addEventListener('melo:export', run)
    return () => window.removeEventListener('melo:export', run)
  }, [editor, activeTabId, title, wsPathForExport])

  // Tab switch: snapshot the outgoing document (identified by what the
  // editor actually displays, not the tab id — they differ mid-switch)
  // and hand it to its session; the write happens in the background, so
  // switching never waits on disk. Then load and apply the incoming
  // document. The editor is read-only in between so stray keystrokes
  // can't land in limbo, and stays read-only when a file fails to load
  // (a failed read must never become a savable empty document).
  const prevTabRef = useRef<string | null>(null)
  useEffect(() => {
    if (!editor) return
    let cancelled = false
    const prev = prevTabRef.current
    prevTabRef.current = activeTabId
    if (prev && prev !== activeTabId) {
      snapshotDisplayed()
      void flush(prev)
    }
    if (!activeTabId) {
      // A viewer tab (or no tab) took the column — the editor is parked
      // hidden. Nothing is displayed, so nothing may be snapshotted onto
      // a session until a document is applied again.
      setDisplayedSession(null)
      editor.setEditable(false, false)
      return
    }
    editor.setEditable(false, false)
    // While the outgoing document is still on screen at its old height,
    // suppress scrolling so the height collapse on swap doesn't flash a
    // scrollbar through.
    const scrollEl = document.querySelector<HTMLElement>('.ed-scroll')
    scrollEl?.classList.add('ed-switching')
    ;(async () => {
      const doc = await activateSession(activeTabId)
      if (cancelled) return
      applyBody(doc?.body ?? '')
      const loadFailed = doc === null && !activeTabId.startsWith('untitled-')
      // Edits belong to the new document only from this point on.
      setDisplayedSession(loadFailed ? null : activeTabId)
      setDocInfo(doc ? { frontmatter: getFrontmatter(activeTabId), body: doc.body } : null)
      editor.setEditable(!loadFailed, false)
      scrollEl?.classList.remove('ed-switching')
      // Caret at the start — documents open at the top (focus('end')
      // also scrolled long documents to the bottom).
      if (!loadFailed) editor.commands.focus('start')
    })()
    return () => {
      cancelled = true
      scrollEl?.classList.remove('ed-switching')
    }
  }, [editor, activeTabId, applyBody])

  // Share the current selection as a card (bubble-menu entry).
  const shareSelection = () => {
    if (!editor) return
    const { from, to } = editor.state.selection
    const text = editor.state.doc.textBetween(from, to, '\n', ' ').trim()
    if (!text) return
    // Title = the live first H1 (editable content), falling back to the sample.
    const first = editor.state.doc.firstChild
    const liveTitle =
      first?.type.name === 'heading' && first.attrs.level === 1 ? first.textContent.trim() : ''
    onShare({
      title: liveTitle || title,
      body: text,
      date: new Date().toLocaleDateString(i18n.language, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }),
    })
  }

  // "+" — insert an empty paragraph below the current block and focus it.
  const insertBelow = () => {
    if (!editor || !current.current) return
    const after = current.current.pos + current.current.node.nodeSize
    editor
      .chain()
      .insertContentAt(after, { type: 'paragraph' })
      .focus(after + 1)
      .run()
  }

  // Grip mousedown — select the hovered block as a NodeSelection before the
  // drag starts, so the drag handle moves it instead of copying it (the
  // extension deletes the source via the active selection, and a pre-set
  // NodeSelection is DOM-stable, so it isn't reverted to a caret mid-drag).
  const selectBlock = () => {
    if (!editor || !current.current) return
    const { state, view } = editor
    const { pos, node } = current.current
    // Keep an existing multi-block selection that already spans the hovered
    // block, so the handle drags the whole selection rather than just one block.
    const { from, to, empty } = state.selection
    if (!empty && pos < to && pos + node.nodeSize > from) return
    if (pos < 0 || pos > state.doc.content.size) return
    try {
      view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, pos)))
    } catch {
      // Node isn't directly selectable (rare) — leave the selection as-is;
      // the drag handle still falls back to coordinate-based detection.
    }
  }

  // Grip — open the block menu anchored to the handle.
  const openBlockMenu = (e: React.MouseEvent) => {
    if (!current.current) return
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setBlockMenu({ ...current.current, x: r.right + 6, y: r.top })
  }

  // Closing the menu also releases the block highlight: the grip's mousedown
  // set a NodeSelection (so a drag would move the block), and after a plain
  // open-then-dismiss it would linger. Menu actions leave a caret themselves.
  const closeBlockMenu = () => {
    setBlockMenu(null)
    if (!editor) return
    const { selection, doc, tr } = editor.state
    if (selection instanceof NodeSelection) {
      editor.view.dispatch(tr.setSelection(Selection.near(doc.resolve(selection.from), 1)))
    }
  }

  return (
    <div className="ed-page" data-width={width} data-has-clip={clipSource ? true : undefined}>
      {clipSource && docInfo && <ClipBanner source={clipSource} markdown={docInfo.body} />}
      <EditorContent editor={editor} className="ed-prose">
        {editor && <SlashMenu editor={editor} />}
      </EditorContent>
      <Backlinks />
      <WikilinkLayer />
      {linkPicker && (
        <LinkPicker
          x={linkPicker.x}
          y={linkPicker.y}
          onPick={insertWikilink}
          onClose={() => setLinkPicker(null)}
        />
      )}

      {editor && (
        <>
          <EditorBubbleMenu editor={editor} onShare={shareSelection} />
          <ImageBubble editor={editor} />
          <ImageLightbox />
          <FindBar editor={editor} />
          <CodeLangPicker editor={editor} />
          <TableHandle editor={editor} />
          <TableExtendButtons editor={editor} />
          <TableSelectionOverlay editor={editor} />

          <DragHandle
            editor={editor}
            className="drag-handle"
            computePositionConfig={dragHandlePosition}
            onNodeChange={({ node, pos }) => {
              current.current = node ? { node, pos } : null
            }}
            // Refocus after a drag so the editor doesn't get stuck blurred
            // (matches the tiptap notion-like template). Guard against the
            // editor being torn down mid-drag (tab switch / unmount).
            onElementDragEnd={() => {
              // ProseMirror only hears dragend on the editor DOM, but this
              // drag's source is the handle (outside it) — forward the event
              // so its stale `view.dragging` gets cleared on cancelled drags.
              editor.view.dom.dispatchEvent(new DragEvent('dragend'))
              setTimeout(() => {
                if (editor.isDestroyed) return
                editor.view.dom.blur()
                editor.view.focus()
                // Done dragging — collapse the block selection to a caret in
                // the dropped block so the selection tint doesn't linger.
                const { selection, doc, tr } = editor.state
                if (!selection.empty) {
                  editor.view.dispatch(
                    tr.setSelection(Selection.near(doc.resolve(selection.from), 1)),
                  )
                }
              }, 0)
            }}
          >
            <div className="block-gutter">
              <button
                className="gutter-btn"
                aria-label={i18n.t('misc.insertBelow')}
                onClick={insertBelow}
              >
                <Icon name="plus" size={14} />
              </button>
              <button
                className="gutter-btn drag"
                aria-label={i18n.t('misc.openBlockMenu')}
                // Select the whole block before the drag begins. This is what
                // makes the drag reliably *move* (not copy): the drag handle
                // extension deletes the source via the active selection, and a
                // pre-set NodeSelection is DOM-stable so it isn't reverted to a
                // caret mid-drag. Mirrors the reference's selectNodeAndHideFloating.
                onMouseDown={selectBlock}
                onClick={openBlockMenu}
              >
                <Icon name="grip" size={14} />
              </button>
            </div>
          </DragHandle>

          {blockMenu && (
            <BlockMenu
              editor={editor}
              node={blockMenu.node}
              pos={blockMenu.pos}
              anchor={{ x: blockMenu.x, y: blockMenu.y }}
              onClose={closeBlockMenu}
            />
          )}

          <MathEditor editor={editor} />
        </>
      )}
    </div>
  )
}
