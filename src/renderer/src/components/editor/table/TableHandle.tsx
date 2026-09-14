import { useCallback, useMemo, useState } from 'react'
import i18n from '../../../i18n'
import type { Editor } from '@tiptap/react'
import { FloatingPortal } from '@floating-ui/react'
import { offset, size, useFloating, useTransitionStyles } from '@floating-ui/react'
import { useEffect } from 'react'

import { colDragStart, rowDragStart, dragEnd } from './TableHandlePlugin'
import { useTableHandleState } from './useTableHandleState'
import { clamp } from './tableUtils'
import { TableHandleMenu } from './TableHandleMenu'
import { Icon } from '../../Icon'

// ---------------------------------------------------------------------------
// Positioning hooks
// ---------------------------------------------------------------------------

type DraggingState = {
  draggedCellOrientation: 'row' | 'col'
  mousePos: number
  initialOffset?: number
}

function makeRowRect(cell: DOMRect, table: DOMRect, dragging?: DraggingState): DOMRect {
  if (dragging?.draggedCellOrientation === 'row') {
    const adjustedY = dragging.mousePos + (dragging.initialOffset ?? 0)
    const clampedY = clamp(adjustedY, table.y, table.bottom - cell.height)
    return new DOMRect(table.x, clampedY, table.width, cell.height)
  }
  return new DOMRect(table.x, cell.y, table.width, cell.height)
}

function makeColRect(cell: DOMRect, table: DOMRect, dragging?: DraggingState): DOMRect {
  if (dragging?.draggedCellOrientation === 'col') {
    const adjustedX = dragging.mousePos + (dragging.initialOffset ?? 0)
    const clampedX = clamp(adjustedX, table.x, table.right - cell.width)
    return new DOMRect(clampedX, table.y, cell.width, table.height)
  }
  return new DOMRect(cell.x, table.y, cell.width, table.height)
}

function useHandlePosition(
  orientation: 'row' | 'col',
  show: boolean,
  referencePosCell: DOMRect | null,
  referencePosTable: DOMRect | null,
  draggingState?: DraggingState,
) {
  const placement = orientation === 'row' ? ('left' as const) : ('top' as const)

  const { refs, update, context, floatingStyles } = useFloating({
    open: show,
    placement,
    middleware: [
      offset(4),
      size({
        apply({ elements }) {
          if (!elements.floating) return
          const refWidth =
            (orientation === 'col' ? referencePosCell?.width : referencePosTable?.width) ?? 80
          const refHeight =
            (orientation === 'row' ? referencePosCell?.height : referencePosTable?.height) ?? 32
          elements.floating.style.setProperty('--table-handle-ref-width', `${refWidth}px`)
          elements.floating.style.setProperty('--table-handle-ref-height', `${refHeight}px`)
        },
      }),
    ],
  })

  const { isMounted, styles } = useTransitionStyles(context)

  useEffect(() => {
    update()
  }, [update, show, orientation, referencePosCell, referencePosTable, draggingState])

  useEffect(() => {
    if (!referencePosCell || !referencePosTable) return
    if (draggingState && orientation !== draggingState.draggedCellOrientation) return

    const rectFn =
      orientation === 'row'
        ? () => makeRowRect(referencePosCell, referencePosTable, draggingState)
        : () => makeColRect(referencePosCell, referencePosTable, draggingState)

    refs.setReference({ getBoundingClientRect: rectFn })
  }, [refs, orientation, referencePosCell, referencePosTable, draggingState])

  return useMemo(
    () => ({
      isMounted,
      ref: refs.setFloating,
      style: { display: 'flex', ...styles, ...floatingStyles },
    }),
    [isMounted, refs.setFloating, styles, floatingStyles],
  )
}

// ---------------------------------------------------------------------------
// TableHandle component
// ---------------------------------------------------------------------------

export function TableHandle({ editor }: { editor: Editor }) {
  const state = useTableHandleState(editor)

  const [isRowVisible, setIsRowVisible] = useState(true)
  const [isColumnVisible, setIsColumnVisible] = useState(true)
  const [menuOpen, setMenuOpen] = useState<null | 'row' | 'column'>(null)

  const draggingState = useMemo(() => {
    if (!state?.draggingState) return undefined
    return {
      draggedCellOrientation: state.draggingState.draggedCellOrientation,
      mousePos: state.draggingState.mousePos,
      initialOffset: state.draggingState.initialOffset,
    }
  }, [state?.draggingState])

  const rowHandle = useHandlePosition(
    'row',
    state?.show || false,
    state?.referencePosCell || null,
    state?.referencePosTable || null,
    draggingState,
  )

  const colHandle = useHandlePosition(
    'col',
    state?.show || false,
    state?.referencePosCell || null,
    state?.referencePosTable || null,
    draggingState,
  )

  const handleMenuOpenChange = useCallback((type: 'row' | 'column', open: boolean) => {
    setMenuOpen(open ? type : null)
  }, [])

  const handleRowDragStart = useCallback((e: React.DragEvent) => {
    rowDragStart(e)
  }, [])

  const handleColDragStart = useCallback((e: React.DragEvent) => {
    colDragStart(e)
  }, [])

  const handleDragEnd = useCallback(() => {
    dragEnd()
  }, [])

  if (!editor || !state) return null

  const hasValidRowIndex = typeof state.rowIndex === 'number'
  const hasValidColIndex = typeof state.colIndex === 'number'

  const shouldShowRow =
    (isRowVisible && rowHandle.isMounted && hasValidRowIndex) || menuOpen === 'row'
  const shouldShowCol =
    (isColumnVisible && colHandle.isMounted && hasValidColIndex) || menuOpen === 'column'

  return (
    <FloatingPortal root={state.widgetContainer}>
      {shouldShowRow && (
        <div ref={rowHandle.ref} style={rowHandle.style}>
          <TableHandleMenu
            editor={editor}
            orientation="row"
            index={state.rowIndex}
            tablePos={state.blockPos}
            tableNode={state.block}
            onToggleOtherHandle={setIsColumnVisible}
            onOpenChange={(open) => handleMenuOpenChange('row', open)}
          >
            <button
              className={`tiptap-table-handle-menu row${menuOpen === 'row' ? ' menu-opened' : ''}`}
              draggable
              onDragStart={handleRowDragStart}
              onDragEnd={handleDragEnd}
              aria-label={i18n.t('table.rowActions')}
            >
              <Icon name="moreV" size={12} className="tiptap-button-icon" />
            </button>
          </TableHandleMenu>
        </div>
      )}

      {shouldShowCol && (
        <div ref={colHandle.ref} style={colHandle.style}>
          <TableHandleMenu
            editor={editor}
            orientation="column"
            index={state.colIndex}
            tablePos={state.blockPos}
            tableNode={state.block}
            onToggleOtherHandle={setIsRowVisible}
            onOpenChange={(open) => handleMenuOpenChange('column', open)}
          >
            <button
              className={`tiptap-table-handle-menu column${menuOpen === 'column' ? ' menu-opened' : ''}`}
              draggable
              onDragStart={handleColDragStart}
              onDragEnd={handleDragEnd}
              aria-label={i18n.t('table.colActions')}
            >
              <Icon name="moreV" size={12} className="tiptap-button-icon" />
            </button>
          </TableHandleMenu>
        </div>
      )}
    </FloatingPortal>
  )
}
