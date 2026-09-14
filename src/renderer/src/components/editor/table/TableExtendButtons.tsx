import { useCallback, useEffect, useRef, useState, useMemo } from 'react'
import i18n from '../../../i18n'
import type { Editor } from '@tiptap/react'
import { TableMap } from '@tiptap/pm/tables'
import {
  FloatingPortal,
  autoUpdate,
  offset,
  size,
  useFloating,
  useTransitionStyles,
} from '@floating-ui/react'

import { useTableHandleState } from './useTableHandleState'
import {
  EMPTY_CELL_HEIGHT,
  EMPTY_CELL_WIDTH,
  countEmptyColumnsFromEnd,
  countEmptyRowsFromEnd,
  marginRound,
  runPreservingCursor,
  selectLastCell,
  type Orientation,
} from './tableUtils'
import { Icon } from '../../Icon'

// ---------------------------------------------------------------------------
// Positioning hook
// ---------------------------------------------------------------------------

function useExtendButtonPosition(
  orientation: Orientation,
  show: boolean,
  referenceEl: HTMLElement | null,
) {
  const placement = orientation === 'row' ? ('bottom' as const) : ('right' as const)
  const sizeProp = orientation === 'row' ? 'width' : 'height'

  // The reference is the LIVE tbody element with autoUpdate (its
  // ResizeObserver fires the instant a row/column lands). The previous
  // DOMRect snapshot went stale during rapid edits — plugin re-measure →
  // emit → effect → async computePosition is a relay, and the "+" strip
  // sat at the old edge until it caught up.
  const { refs, context, floatingStyles } = useFloating({
    open: show,
    placement,
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(4),
      size({
        apply({ rects, elements }) {
          if (!elements.floating) return
          elements.floating.style[sizeProp] = `${rects.reference[sizeProp]}px`
        },
      }),
    ],
  })

  const { isMounted, styles } = useTransitionStyles(context)

  useEffect(() => {
    refs.setReference(referenceEl)
  }, [referenceEl, refs])

  return useMemo(
    () => ({
      isMounted,
      ref: refs.setFloating,
      style: { display: 'flex', ...styles, ...floatingStyles } as React.CSSProperties,
    }),
    [floatingStyles, isMounted, refs.setFloating, styles],
  )
}

// ---------------------------------------------------------------------------
// Single extend button
// ---------------------------------------------------------------------------

function ExtendButton({
  editor,
  orientation,
  onMouseDown,
  onMouseUp,
}: {
  editor: Editor
  orientation: Orientation
  onMouseDown: () => void
  onMouseUp: () => void
}) {
  const state = useTableHandleState(editor)
  const isRow = orientation === 'row'

  const movedRef = useRef(false)
  const [dragState, setDragState] = useState<{
    startPos: number
    originalHeight: number
    originalWidth: number
  } | null>(null)

  const startDrag = useCallback(
    (ev: React.MouseEvent) => {
      if (!state) return
      const dims = TableMap.get(state.block)
      movedRef.current = false
      setDragState({
        startPos: isRow ? ev.clientY : ev.clientX,
        originalHeight: dims.height,
        originalWidth: dims.width,
      })
      onMouseDown()
      ev.preventDefault()
    },
    [state, isRow, onMouseDown],
  )

  const handleClick = useCallback(() => {
    if (movedRef.current || !editor || !state) return

    runPreservingCursor(editor, () => {
      selectLastCell(editor, state.block, state.blockPos, orientation)
      if (isRow) {
        editor.commands.addRowAfter()
      } else {
        editor.commands.addColumnAfter()
      }
    })
  }, [editor, isRow, orientation, state])

  useEffect(() => {
    if (!dragState || !editor || !state) return

    const handleMove = (ev: MouseEvent) => {
      movedRef.current = true

      const currentPos = isRow ? ev.clientY : ev.clientX
      const diff = currentPos - dragState.startPos
      const cellSize = isRow ? EMPTY_CELL_HEIGHT : EMPTY_CELL_WIDTH

      const currentDims = TableMap.get(state.block)
      const currentCount = isRow ? currentDims.height : currentDims.width
      const originalCount = isRow ? dragState.originalHeight : dragState.originalWidth

      const newCount = Math.max(1, originalCount + marginRound(diff / cellSize, 0.3))
      const delta = newCount - currentCount
      if (delta === 0) return

      if (delta > 0) {
        runPreservingCursor(editor, () => {
          selectLastCell(editor, state.block, state.blockPos, orientation)
          for (let i = 0; i < delta; i++) {
            if (isRow) editor.commands.addRowAfter()
            else editor.commands.addColumnAfter()
          }
        })
      } else {
        runPreservingCursor(editor, () => {
          const absDelta = Math.abs(delta)
          const emptyCount = isRow
            ? countEmptyRowsFromEnd(editor, state.blockPos)
            : countEmptyColumnsFromEnd(editor, state.blockPos)
          const safeToRemove = Math.min(absDelta, emptyCount, currentCount - 1)

          selectLastCell(editor, state.block, state.blockPos, orientation)
          for (let i = 0; i < safeToRemove; i++) {
            if (isRow) editor.commands.deleteRow()
            else editor.commands.deleteColumn()
          }
        })
      }
    }

    const handleUp = () => {
      setDragState(null)
      onMouseUp()
    }

    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [dragState, editor, isRow, orientation, onMouseUp, state])

  if (!editor?.isEditable) return null

  return (
    <button
      className={`tiptap-table-extend-row-column-button ${isRow ? 'tiptap-table-row-end-add-remove' : 'tiptap-table-column-end-add-remove'} ${dragState ? 'editing' : ''}`}
      onClick={handleClick}
      onMouseDown={startDrag}
      type="button"
      aria-label={isRow ? i18n.t('table.addRemoveRows') : i18n.t('table.addRemoveCols')}
    >
      <Icon name="plus" size={12} className="tiptap-button-icon" />
    </button>
  )
}

// ---------------------------------------------------------------------------
// TableExtendButtons — positions both row and column extend buttons
// ---------------------------------------------------------------------------

export function TableExtendButtons({ editor }: { editor: Editor }) {
  const state = useTableHandleState(editor)

  const tbody = useMemo(() => {
    if (!state) return null
    try {
      const dom = editor.view.nodeDOM(state.blockPos) as HTMLElement | null
      return dom?.querySelector('tbody') ?? null
    } catch {
      return null
    }
  }, [editor, state])

  const rowButton = useExtendButtonPosition('row', state?.showAddOrRemoveRowsButton ?? false, tbody)
  const colButton = useExtendButtonPosition(
    'column',
    state?.showAddOrRemoveColumnsButton ?? false,
    tbody,
  )

  const handleDown = useCallback(() => {
    editor.commands.freezeHandles()
  }, [editor])

  const handleUp = useCallback(() => {
    editor.commands.unfreezeHandles()
  }, [editor])

  if (!state) return null

  return (
    <FloatingPortal root={state.widgetContainer}>
      <div ref={rowButton.ref} style={rowButton.style}>
        <ExtendButton
          editor={editor}
          orientation="row"
          onMouseDown={handleDown}
          onMouseUp={handleUp}
        />
      </div>
      <div ref={colButton.ref} style={colButton.style}>
        <ExtendButton
          editor={editor}
          orientation="column"
          onMouseDown={handleDown}
          onMouseUp={handleUp}
        />
      </div>
    </FloatingPortal>
  )
}
