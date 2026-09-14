import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import i18n from '../../../i18n'
import type { Editor } from '@tiptap/react'
import type { Node as PMNode } from '@tiptap/pm/model'
import { TableMap } from '@tiptap/pm/tables'
import { CellSelection, moveTableRow, moveTableColumn } from '@tiptap/pm/tables'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'

import type { Orientation } from './tableUtils'
import {
  isValidPosition,
  selectCellsByCoords,
  getIndexCoordinates,
  setCellAttr,
} from './tableUtils'
import { Icon, type IconName } from '../../Icon'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TableHandleMenuProps {
  editor: Editor
  orientation: Orientation
  index: number | undefined
  tablePos: number
  tableNode: PMNode
  onToggleOtherHandle: (visible: boolean) => void
  onOpenChange: (open: boolean) => void
  children: React.ReactNode
}

interface ActionItem {
  icon: IconName
  label: string
  action: () => void
  disabled?: boolean
  destructive?: boolean
}

/** Reordering/cloning whole row or cell nodes can't preserve row/col spans, so
 *  the rebuild-based sort and duplicate bail on tables with any merged cell
 *  (otherwise prosemirror-tables' fixTables silently rewrites the result). */
function hasMergedCells(table: PMNode): boolean {
  let merged = false
  table.forEach((row) =>
    row.forEach((cell) => {
      if ((cell.attrs.colspan ?? 1) > 1 || (cell.attrs.rowspan ?? 1) > 1) merged = true
    }),
  )
  return merged
}

// ---------------------------------------------------------------------------
// Actions builder
// ---------------------------------------------------------------------------

function useTableActions(
  editor: Editor,
  orientation: Orientation,
  index: number | undefined,
  tablePos: number,
  tableNode: PMNode,
) {
  const { i18n: i18nSub } = useTranslation()
  const isRow = orientation === 'row'
  const map = useMemo(() => TableMap.get(tableNode), [tableNode])

  const selectRowOrColumn = useCallback(() => {
    if (!isValidPosition(index) || !isValidPosition(tablePos)) return
    const start = isRow ? { row: index, col: 0 } : { row: 0, col: index }
    const end = isRow ? { row: index, col: map.width - 1 } : { row: map.height - 1, col: index }
    selectCellsByCoords(editor, tablePos, [start, end], {
      mode: 'dispatch',
      dispatch: editor.view.dispatch.bind(editor.view),
    })
  }, [editor, isRow, index, tablePos, map])

  // Header action — one-way, rows only. GFM pipe tables have no header
  // COLUMN at all (th cells outside the first row serialize as plain
  // cells), and a header ROW can't be removed faithfully (GFM mandates
  // one — the doc reopens with a spurious empty header). What remains
  // is "Set as header row": real, and it repairs headerless tables
  // pasted from HTML into a serializable shape.
  const headerAction = useMemo((): ActionItem | null => {
    if (!isRow || index !== 0) return null
    const firstRow = tableNode.firstChild
    const isHeader = firstRow?.firstChild?.type.name === 'tableHeader'
    if (isHeader) return null

    return {
      icon: 'tableHeader',
      label: i18n.t('table.setHeaderRow'),
      action: () => {
        selectRowOrColumn()
        editor.commands.toggleHeaderRow()
      },
    }
  }, [editor, isRow, index, tableNode, selectRowOrColumn, i18nSub.language])

  const performMove = useCallback(
    (from: number, to: number) => {
      if (!isValidPosition(index) || !isValidPosition(tablePos)) return
      const orientation = isRow ? 'row' : 'column'
      const coords = getIndexCoordinates({ editor, index: from, orientation, tablePos })
      if (!coords) return
      const stateWithSel = selectCellsByCoords(editor, tablePos, coords, { mode: 'state' })
      if (!stateWithSel) return
      const dispatch = editor.view.dispatch.bind(editor.view)
      if (isRow) {
        moveTableRow({ from, to, select: true, pos: tablePos + 1 })(stateWithSel, dispatch)
      } else {
        moveTableColumn({ from, to, select: true, pos: tablePos + 1 })(stateWithSel, dispatch)
      }
    },
    [editor, isRow, index, tablePos],
  )

  // Move actions
  const moveActions = useMemo((): ActionItem[] => {
    if (!isValidPosition(index)) return []
    const items: ActionItem[] = []

    if (isRow) {
      items.push({
        icon: 'arrowUp',
        label: i18n.t('table.moveRowUp'),
        disabled: index === 0,
        action: () => performMove(index, index - 1),
      })
      items.push({
        icon: 'arrowDown',
        label: i18n.t('table.moveRowDown'),
        disabled: index === map.height - 1,
        action: () => performMove(index, index + 1),
      })
    } else {
      items.push({
        icon: 'arrowLeft',
        label: i18n.t('table.moveColLeft'),
        disabled: index === 0,
        action: () => performMove(index, index - 1),
      })
      items.push({
        icon: 'arrowRight',
        label: i18n.t('table.moveColRight'),
        disabled: index === map.width - 1,
        action: () => performMove(index, index + 1),
      })
    }
    return items
  }, [editor, isRow, index, map, performMove, i18nSub.language])

  // Add actions
  const addActions = useMemo((): ActionItem[] => {
    if (!isValidPosition(index)) return []

    if (isRow) {
      return [
        {
          icon: 'plus',
          label: i18n.t('table.addRowAbove'),
          action: () => {
            selectRowOrColumn()
            editor.commands.addRowBefore()
          },
        },
        {
          icon: 'plus',
          label: i18n.t('table.addRowBelow'),
          action: () => {
            selectRowOrColumn()
            editor.commands.addRowAfter()
          },
        },
      ]
    }
    return [
      {
        icon: 'plus',
        label: i18n.t('table.addColLeft'),
        action: () => {
          selectRowOrColumn()
          editor.commands.addColumnBefore()
        },
      },
      {
        icon: 'plus',
        label: i18n.t('table.addColRight'),
        action: () => {
          selectRowOrColumn()
          editor.commands.addColumnAfter()
        },
      },
    ]
  }, [editor, isRow, index, selectRowOrColumn, i18nSub.language])

  // Sort actions (column only)
  const sortActions = useMemo((): ActionItem[] => {
    if (isRow || !isValidPosition(index)) return []

    // A header *row* is a whole row of tableHeader cells (pinned, not sorted).
    // A header *column* leaves rows as normal body rows, so they still sort.
    const isHeaderRow = (row: PMNode) => {
      if (row.childCount === 0) return false
      let allHeader = true
      row.forEach((cell) => {
        if (cell.type.name !== 'tableHeader') allHeader = false
      })
      return allHeader
    }

    const sortByColumn = (direction: 'asc' | 'desc') => {
      const { state } = editor
      if (hasMergedCells(tableNode)) return

      const headerRows: PMNode[] = []
      const bodyRows: { rowNode: PMNode; text: string }[] = []
      for (let r = 0; r < tableNode.childCount; r++) {
        const rowNode = tableNode.child(r)
        if (isHeaderRow(rowNode)) {
          headerRows.push(rowNode)
          continue
        }
        const cellOffset = map.map[r * map.width + index]
        const cellNode = state.doc.nodeAt(tablePos + 1 + cellOffset)
        bodyRows.push({ rowNode, text: cellNode?.textContent ?? '' })
      }

      if (bodyRows.length <= 1) return

      const sorted = [...bodyRows].sort((a, b) => {
        const numA = parseFloat(a.text)
        const numB = parseFloat(b.text)
        if (!isNaN(numA) && !isNaN(numB)) {
          return direction === 'asc' ? numA - numB : numB - numA
        }
        return direction === 'asc' ? a.text.localeCompare(b.text) : b.text.localeCompare(a.text)
      })

      const alreadySorted = sorted.every((s, i) => s.rowNode === bodyRows[i].rowNode)
      if (alreadySorted) return

      const newTable = tableNode.type.create(tableNode.attrs, [
        ...headerRows,
        ...sorted.map((s) => s.rowNode),
      ])
      editor.view.dispatch(state.tr.replaceWith(tablePos, tablePos + tableNode.nodeSize, newTable))
    }

    return [
      { icon: 'sortAsc', label: i18n.t('table.sortAsc'), action: () => sortByColumn('asc') },
      { icon: 'sortDesc', label: i18n.t('table.sortDesc'), action: () => sortByColumn('desc') },
    ]
  }, [editor, isRow, index, tableNode, tablePos, map, i18nSub.language])

  // Alignment actions
  const alignActions = useMemo((): ActionItem[] => {
    return [
      {
        icon: 'alignLeft',
        label: i18n.t('table.alignLeft'),
        action: () => {
          selectRowOrColumn()
          setCellAttr('align', 'left')(editor.state, editor.view.dispatch)
        },
      },
      {
        icon: 'alignCenter',
        label: i18n.t('table.alignCenter'),
        action: () => {
          selectRowOrColumn()
          setCellAttr('align', 'center')(editor.state, editor.view.dispatch)
        },
      },
      {
        icon: 'alignRight',
        label: i18n.t('table.alignRight'),
        action: () => {
          selectRowOrColumn()
          setCellAttr('align', 'right')(editor.state, editor.view.dispatch)
        },
      },
    ]
  }, [editor, selectRowOrColumn, i18nSub.language])

  // Clear content
  const clearAction = useMemo((): ActionItem => {
    return {
      icon: 'eraser',
      label: isRow ? i18n.t('table.clearRow') : i18n.t('table.clearCol'),
      action: () => {
        selectRowOrColumn()
        const { state } = editor
        const { selection } = state
        if (!(selection instanceof CellSelection)) return

        const tr = state.tr
        selection.forEachCell((cell, pos) => {
          const emptyParagraph = state.schema.nodes.paragraph.create()
          tr.replaceWith(pos + 1, pos + cell.nodeSize - 1, emptyParagraph)
        })
        if (tr.docChanged) editor.view.dispatch(tr)
      },
    }
  }, [editor, isRow, selectRowOrColumn, i18nSub.language])

  // Duplicate — clone the row/column WITH its content by rebuilding the table
  // (reusing the existing cell nodes, so content + attrs carry over). Assumes
  // simple tables: row.child(c) maps to column c, so merged cells aren't
  // handled — acceptable for v1, same scope as sort.
  const duplicateAction = useMemo((): ActionItem => {
    return {
      icon: 'duplicate',
      label: isRow ? i18n.t('table.duplicateRow') : i18n.t('table.duplicateCol'),
      action: () => {
        if (!isValidPosition(index)) return
        const { state } = editor
        const table = state.doc.nodeAt(tablePos)
        if (!table) return
        if (hasMergedCells(table)) return
        const rows: PMNode[] = []
        for (let r = 0; r < table.childCount; r++) {
          const row = table.child(r)
          if (isRow) {
            rows.push(row)
            if (r === index) rows.push(row)
          } else {
            const cells: PMNode[] = []
            for (let c = 0; c < row.childCount; c++) {
              cells.push(row.child(c))
              if (c === index) cells.push(row.child(c))
            }
            rows.push(row.type.create(row.attrs, cells))
          }
        }
        const newTable = table.type.create(table.attrs, rows)
        editor.view.dispatch(state.tr.replaceWith(tablePos, tablePos + table.nodeSize, newTable))
      },
    }
  }, [editor, isRow, index, tablePos, i18nSub.language])

  // Delete
  const deleteAction = useMemo((): ActionItem => {
    const canDelete = isRow ? map.height > 1 : map.width > 1
    return {
      icon: 'trash',
      label: isRow ? i18n.t('table.deleteRow') : i18n.t('table.deleteCol'),
      disabled: !canDelete,
      destructive: true,
      action: () => {
        selectRowOrColumn()
        if (isRow) {
          editor.commands.deleteRow()
        } else {
          editor.commands.deleteColumn()
        }
      },
    }
  }, [editor, isRow, map, selectRowOrColumn, i18nSub.language])

  return {
    selectRowOrColumn,
    headerAction,
    moveActions,
    addActions,
    sortActions,
    alignActions,
    clearAction,
    duplicateAction,
    deleteAction,
  }
}

// ---------------------------------------------------------------------------
// Menu item rendering
// ---------------------------------------------------------------------------

function MenuItem({ item, onClose }: { item: ActionItem; onClose: () => void }) {
  return (
    <DropdownMenu.Item
      disabled={item.disabled}
      onSelect={() => {
        item.action()
        onClose()
      }}
      className={item.destructive ? 'destructive' : undefined}
    >
      <Icon name={item.icon} size={15} />
      <span>{item.label}</span>
    </DropdownMenu.Item>
  )
}

// ---------------------------------------------------------------------------
// TableHandleMenu component
// ---------------------------------------------------------------------------

export function TableHandleMenu({
  editor,
  orientation,
  index,
  tablePos,
  tableNode,
  onToggleOtherHandle,
  onOpenChange,
  children,
}: TableHandleMenuProps) {
  const actions = useTableActions(editor, orientation, index, tablePos, tableNode)

  const handleOpenChange = useCallback(
    (open: boolean) => {
      onOpenChange(open)
      if (open) {
        editor.commands.freezeHandles()
        onToggleOtherHandle(false)
        actions.selectRowOrColumn()
      } else {
        editor.commands.unfreezeHandles()
        onToggleOtherHandle(true)
      }
    },
    [editor, onOpenChange, onToggleOtherHandle, actions],
  )

  const close = useCallback(() => handleOpenChange(false), [handleOpenChange])

  return (
    <DropdownMenu.Root onOpenChange={handleOpenChange}>
      <DropdownMenu.Trigger asChild>{children}</DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="table-handle-dropdown"
          side={orientation === 'row' ? 'right' : 'bottom'}
          align="start"
          sideOffset={4}
        >
          {/* Header toggle */}
          {actions.headerAction && (
            <>
              <MenuItem item={actions.headerAction} onClose={close} />
              <DropdownMenu.Separator />
            </>
          )}

          {/* Move */}
          {actions.moveActions.length > 0 && (
            <>
              {actions.moveActions.map((item, i) => (
                <MenuItem key={`move-${i}`} item={item} onClose={close} />
              ))}
              <DropdownMenu.Separator />
            </>
          )}

          {/* Add */}
          {actions.addActions.length > 0 && (
            <>
              {actions.addActions.map((item, i) => (
                <MenuItem key={`add-${i}`} item={item} onClose={close} />
              ))}
              <DropdownMenu.Separator />
            </>
          )}

          {/* Sort (column only) */}
          {actions.sortActions.length > 0 && (
            <>
              {actions.sortActions.map((item, i) => (
                <MenuItem key={`sort-${i}`} item={item} onClose={close} />
              ))}
              <DropdownMenu.Separator />
            </>
          )}

          {/* Alignment */}
          {actions.alignActions.map((item, i) => (
            <MenuItem key={`align-${i}`} item={item} onClose={close} />
          ))}
          <DropdownMenu.Separator />

          {/* Clear + Duplicate */}
          <MenuItem item={actions.clearAction} onClose={close} />
          <MenuItem item={actions.duplicateAction} onClose={close} />

          {/* Delete */}
          <DropdownMenu.Separator />
          <MenuItem item={actions.deleteAction} onClose={close} />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
