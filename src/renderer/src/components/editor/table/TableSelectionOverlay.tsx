import { useEffect, useState, useCallback, useRef } from 'react'
import type { Editor } from '@tiptap/react'
import { CellSelection, cellAround, columnResizingPluginKey } from '@tiptap/pm/tables'
import type { Node as PMNode, ResolvedPos } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'
import { FloatingPortal, useFloating } from '@floating-ui/react'

import { domCellAround, getTable, rectEq } from './tableUtils'
import { CellHandleMenu } from './CellHandleMenu'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ResizeHandle = 'tl' | 'tr' | 'bl' | 'br' | null

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getSelectionBoundingRect(editor: Editor): DOMRect | null {
  const { selection } = editor.state
  if (!(selection instanceof CellSelection)) return null

  const cells: Element[] = []
  selection.forEachCell((_node: PMNode, pos: number) => {
    const dom = editor.view.nodeDOM(pos) as Element | null
    if (dom) cells.push(dom)
  })

  if (cells.length === 0) return null

  const bounds = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity }
  cells.forEach((cell) => {
    const rect = cell.getBoundingClientRect()
    bounds.left = Math.min(bounds.left, rect.left)
    bounds.top = Math.min(bounds.top, rect.top)
    bounds.right = Math.max(bounds.right, rect.right)
    bounds.bottom = Math.max(bounds.bottom, rect.bottom)
  })

  return new DOMRect(
    bounds.left,
    bounds.top,
    bounds.right - bounds.left,
    bounds.bottom - bounds.top,
  )
}

function getSingleCellBoundingRect(editor: Editor, cellPos: number): DOMRect | null {
  const dom = editor.view.nodeDOM(cellPos) as Element | null
  if (!dom) return null
  const r = dom.getBoundingClientRect()
  return new DOMRect(r.left, r.top, r.width, r.height)
}

function getCellAtCoordinates(editor: Editor, x: number, y: number): ResolvedPos | null {
  const pos = editor.view.posAtCoords({ left: x, top: y })?.pos
  if (pos == null) return null
  const $pos = editor.state.doc.resolve(pos)
  return cellAround($pos)
}

function findCornerCells(editor: Editor, selection: CellSelection, selRect: DOMRect) {
  const tolerance = 5
  const isNear = (a: number, b: number) => Math.abs(a - b) < tolerance
  const corners = {
    tl: null as number | null,
    tr: null as number | null,
    bl: null as number | null,
    br: null as number | null,
  }

  selection.forEachCell((_node: PMNode, pos: number) => {
    const dom = editor.view.nodeDOM(pos) as Element | null
    if (!dom) return
    const r = dom.getBoundingClientRect()

    if (isNear(r.left, selRect.left) && isNear(r.top, selRect.top)) corners.tl = pos
    if (isNear(r.right, selRect.right) && isNear(r.top, selRect.top)) corners.tr = pos
    if (isNear(r.left, selRect.left) && isNear(r.bottom, selRect.bottom)) corners.bl = pos
    if (isNear(r.right, selRect.right) && isNear(r.bottom, selRect.bottom)) corners.br = pos
  })

  return corners
}

const anchorMap: Record<NonNullable<Exclude<ResizeHandle, null>>, 'br' | 'bl' | 'tr' | 'tl'> = {
  tl: 'br',
  tr: 'bl',
  bl: 'tr',
  br: 'tl',
}

// ---------------------------------------------------------------------------
// Resize overlay hook (tracks column resizing)
// ---------------------------------------------------------------------------

function useResizeOverlay(editor: Editor | null, updateRect: () => void) {
  const rafId = useRef<number | null>(null)

  const stopLoop = useCallback(() => {
    if (rafId.current != null) {
      cancelAnimationFrame(rafId.current)
      rafId.current = null
    }
  }, [])

  const startLoop = useCallback(() => {
    if (rafId.current != null) return
    const tick = () => {
      const st = columnResizingPluginKey.getState(editor!.state)
      const dragging = !!st?.dragging
      updateRect()
      if (dragging) {
        rafId.current = requestAnimationFrame(tick)
      } else {
        stopLoop()
        updateRect()
      }
    }
    rafId.current = requestAnimationFrame(tick)
  }, [editor, updateRect, stopLoop])

  useEffect(() => {
    if (!editor) return

    const onTx = ({ transaction }: { transaction: Transaction }) => {
      // Selection-driven rect updates already come from the 'selectionUpdate'
      // handler, so don't reflow here on every transaction. Only react to
      // column-resize metas (the rAF loop tracks the live drag). This drops a
      // forced reflow on every keystroke while typing in a cell.
      const meta = transaction.getMeta(columnResizingPluginKey)
      if (!meta) return
      if (meta.setDragging) startLoop()
      if (meta.setDragging == null) {
        stopLoop()
        updateRect()
      }
    }

    editor.on('transaction', onTx)
    return () => {
      editor.off('transaction', onTx)
      stopLoop()
    }
  }, [editor, startLoop, stopLoop, updateRect])
}

// ---------------------------------------------------------------------------
// Corner handle styles
// ---------------------------------------------------------------------------

function cornerHandleStyle(pos: 'tl' | 'tr' | 'bl' | 'br', isActive: boolean): React.CSSProperties {
  const base: React.CSSProperties = {
    position: 'absolute',
    width: 15,
    height: 15,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    pointerEvents: 'auto',
    zIndex: 10,
  }
  const cursors: Record<string, string> = {
    tl: 'nwse-resize',
    tr: 'nesw-resize',
    bl: 'nesw-resize',
    br: 'nwse-resize',
  }
  const posStyles: Record<string, React.CSSProperties> = {
    tl: { top: -7.5, left: -7.5 },
    tr: { top: -7.5, right: -7.5 },
    bl: { bottom: -7.5, left: -7.5 },
    br: { bottom: -7.5, right: -7.5 },
  }
  return {
    ...base,
    ...posStyles[pos],
    cursor: cursors[pos],
    opacity: isActive ? 1 : 0.5,
  }
}

// ---------------------------------------------------------------------------
// TableSelectionOverlay component
// ---------------------------------------------------------------------------

export function TableSelectionOverlay({ editor }: { editor: Editor }) {
  const [isVisible, setIsVisible] = useState(false)
  const [selectionRect, setSelectionRect] = useState<DOMRect | null>(null)
  const [activeHandle, setActiveHandle] = useState<ResizeHandle>(null)
  const [tableDom, setTableDom] = useState<HTMLElement | null>(null)
  const [isCellMenuOpen, setIsCellMenuOpen] = useState(false)
  const anchorCellRef = useRef<number | null>(null)
  // floating-ui keys its portal off `root` reactively, so it must be state,
  // not a ref — otherwise switching tables leaves the portal on the old/null
  // container and it falls back to document.body.
  const [container, setContainer] = useState<HTMLElement | null>(null)

  const { refs, floatingStyles, update } = useFloating({ placement: 'top-start' })

  useEffect(() => {
    if (selectionRect) {
      refs.setPositionReference({ getBoundingClientRect: () => selectionRect })
    }
  }, [selectionRect, refs])

  const updateSelectionRect = useCallback(() => {
    if (!editor) return

    const { selection } = editor.state

    if (selection instanceof CellSelection) {
      const rect = getSelectionBoundingRect(editor)
      if (!rect) {
        setIsVisible(false)
        setSelectionRect((prev) => (prev ? null : prev))
        return
      }
      setSelectionRect((prev) => (rectEq(prev, rect) ? prev : rect))
      setIsVisible(true)
      return
    }

    // Single cell: show border around the cell the cursor is in
    const cell = cellAround(selection.$anchor)
    if (cell) {
      const rect = getSingleCellBoundingRect(editor, cell.pos)
      if (rect) {
        setSelectionRect((prev) => (rectEq(prev, rect) ? prev : rect))
        setIsVisible(true)
        return
      }
    }

    setIsVisible(false)
    setSelectionRect((prev) => (prev ? null : prev))
  }, [editor])

  useResizeOverlay(editor, updateSelectionRect)

  useEffect(() => {
    if (update && selectionRect) update()
  }, [update, selectionRect])

  const updateTableDom = useCallback(() => {
    if (!editor) {
      setTableDom(null)
      return
    }
    const table = getTable(editor)
    if (!table) {
      setTableDom(null)
      return
    }
    setTableDom((prev) => {
      const newDom = editor.view.nodeDOM(table.pos) as HTMLElement | null
      return prev === newDom ? prev : newDom
    })
  }, [editor])

  useEffect(() => {
    if (!editor) return
    const handleSelectionUpdate = () => {
      updateSelectionRect()
      updateTableDom()
    }
    editor.on('selectionUpdate', handleSelectionUpdate)
    updateSelectionRect()
    updateTableDom()
    return () => {
      editor.off('selectionUpdate', handleSelectionUpdate)
    }
  }, [editor, updateSelectionRect, updateTableDom])

  useEffect(() => {
    const c = tableDom?.querySelector('.table-selection-overlay-container') as HTMLElement | null
    setContainer(c ?? null)
  }, [tableDom])

  const createResizeHandler = useCallback(
    (handle: ResizeHandle) => (event: React.MouseEvent) => {
      if (!editor || !handle || !selectionRect) return

      event.preventDefault()
      event.stopPropagation()

      const { selection } = editor.state
      let cellSelection: CellSelection | null = null

      if (selection instanceof CellSelection) {
        cellSelection = selection
      } else {
        const cell = cellAround(selection.$anchor)
        if (cell) {
          try {
            cellSelection = CellSelection.create(editor.state.doc, cell.pos, cell.pos)
          } catch {
            return
          }
        }
      }
      if (!cellSelection) return

      const corners = findCornerCells(editor, cellSelection, selectionRect)
      const anchorKey = anchorMap[handle]
      const anchorPos = corners[anchorKey]
      if (anchorPos == null) return

      setActiveHandle(handle)
      anchorCellRef.current = anchorPos

      const handleMouseMove = (ev: MouseEvent) => {
        if (anchorCellRef.current == null) return

        const target = domCellAround(ev.target as Element)
        if (!target || target.type !== 'cell') return

        const targetCell = getCellAtCoordinates(editor, ev.clientX, ev.clientY)
        if (!targetCell) return

        try {
          const newSel = CellSelection.create(
            editor.state.doc,
            anchorCellRef.current,
            targetCell.pos,
          )
          editor.view.dispatch(editor.state.tr.setSelection(newSel))
        } catch {
          // invalid position during drag
        }
      }

      const handleMouseUp = () => {
        setActiveHandle(null)
        anchorCellRef.current = null
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
      }

      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
    },
    [editor, selectionRect],
  )

  if (!isVisible || !selectionRect) return null

  const isCellSelection = editor.state.selection instanceof CellSelection

  return (
    <FloatingPortal root={container}>
      <div ref={refs.setFloating} style={{ ...floatingStyles, pointerEvents: 'none', zIndex: 10 }}>
        <div className="tiptap-table-selection-overlay">
          {/* Background layer */}
          <div
            style={{
              position: 'absolute',
              width: selectionRect.width,
              height: selectionRect.height,
              zIndex: 2,
              borderRadius: 2,
              top: 0,
              left: 0,
            }}
          />

          {/* Border + resize handles */}
          <div
            style={{
              position: 'absolute',
              width: selectionRect.width,
              height: selectionRect.height,
              border: '2px solid var(--tt-table-selected-stroke)',
              borderRadius: 2,
              zIndex: 3,
              top: 0,
              left: 0,
            }}
          >
            {/* Cell handle menu — shows on single cell */}
            {!isCellSelection && (
              <span onMouseDown={(e) => e.stopPropagation()} style={{ pointerEvents: 'auto' }}>
                <CellHandleMenu editor={editor} onOpenChange={setIsCellMenuOpen} />
              </span>
            )}

            {/* Corner resize handles — only for multi-cell selection */}
            {isCellSelection &&
              !isCellMenuOpen &&
              (['tl', 'tr', 'bl', 'br'] as const).map((pos) => (
                <div
                  key={pos}
                  style={cornerHandleStyle(pos, !activeHandle || activeHandle === pos)}
                  onMouseDown={createResizeHandler(pos)}
                />
              ))}
          </div>
        </div>
      </div>
    </FloatingPortal>
  )
}
