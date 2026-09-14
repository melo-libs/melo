import type { Editor } from '@tiptap/core'
import type { Node as PMNode, ResolvedPos } from '@tiptap/pm/model'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { TextSelection } from '@tiptap/pm/state'
import { CellSelection, TableMap } from '@tiptap/pm/tables'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const RESIZE_MIN_WIDTH = 35
export const EMPTY_CELL_WIDTH = 120
export const EMPTY_CELL_HEIGHT = 40

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Orientation = 'row' | 'column'

export interface CellInfo {
  node: PMNode | null
  pos: number
}

export interface CellCoordinates {
  row: number
  col: number
}

export interface TableInfo {
  node: PMNode
  pos: number
  map: TableMap
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

export function isHTMLElement(el: unknown): el is HTMLElement {
  return el instanceof HTMLElement
}

export function safeClosest<T extends Element = Element>(
  el: Element | null,
  selector: string,
): T | null {
  return el?.closest<T>(selector) ?? null
}

/**
 * Walk up from an element to find a TD/TH or the tableWrapper.
 * Returns the kind of element found and the tbody for coordinate lookups.
 */
export function domCellAround(target: Element): {
  type: 'cell' | 'wrapper'
  domNode: Element
  tbodyNode: HTMLElement | null
} | null {
  let el: Element | null = target
  while (el && el.nodeName !== 'TD' && el.nodeName !== 'TH') {
    if (el.classList?.contains('tableWrapper')) {
      const tbody = el.querySelector('tbody')
      return { type: 'wrapper', domNode: el, tbodyNode: tbody }
    }
    el = el.parentElement
  }
  if (!el) return null
  const table = el.closest('table')
  const tbody = table?.querySelector('tbody') ?? null
  return { type: 'cell', domNode: el, tbodyNode: tbody }
}

// ---------------------------------------------------------------------------
// Core table resolution
// ---------------------------------------------------------------------------

export function isTableNode(node: PMNode): boolean {
  return node.type.name === 'table'
}

export function isValidPosition(pos: unknown): pos is number {
  return typeof pos === 'number' && pos >= 0
}

/**
 * Find the table node closest to the current selection.
 */
export function getTable(editor: Editor): { node: PMNode; pos: number } | null {
  const { state } = editor
  const { selection } = state

  let $pos: ResolvedPos
  if (selection instanceof CellSelection) {
    $pos = selection.$anchorCell
  } else {
    $pos = selection.$anchor
  }

  for (let d = $pos.depth; d >= 0; d--) {
    const node = $pos.node(d)
    if (isTableNode(node)) {
      return { node, pos: d === 0 ? 0 : $pos.before(d) }
    }
  }
  return null
}

/**
 * Resolve table node from a DOM element.
 */
export function getTableFromDOM(
  tableElement: HTMLElement,
  editor: Editor,
): { node: PMNode; pos: number } | null {
  const pos = editor.view.posAtDOM(tableElement, 0)
  if (pos == null) return null

  const $pos = editor.state.doc.resolve(pos)
  for (let d = $pos.depth; d >= 0; d--) {
    const node = $pos.node(d)
    if (isTableNode(node)) {
      return { node, pos: d === 0 ? 0 : $pos.before(d) }
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Cell index resolution from DOM
// ---------------------------------------------------------------------------

export function getCellIndicesFromDOM(
  cellEl: HTMLTableCellElement,
  tableNode: PMNode,
  editor: Editor,
): { rowIndex: number; colIndex: number } | null {
  const cellPos = editor.view.posAtDOM(cellEl, 0)
  if (cellPos == null) return null

  const map = TableMap.get(tableNode)
  const $cell = editor.state.doc.resolve(cellPos)

  // Walk up to find the cell node
  for (let d = $cell.depth; d >= 0; d--) {
    const node = $cell.node(d)
    if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
      const pos = $cell.before(d)
      // Find the table pos to compute the cell offset relative to table
      for (let td = d - 1; td >= 0; td--) {
        if (isTableNode($cell.node(td))) {
          const tablePos = td === 0 ? 0 : $cell.before(td)
          const cellOffset = pos - tablePos - 1
          const idx = map.map.indexOf(cellOffset)
          if (idx === -1) return null
          return {
            rowIndex: Math.floor(idx / map.width),
            colIndex: idx % map.width,
          }
        }
      }
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Cell collection
// ---------------------------------------------------------------------------

interface CellCollectionResult {
  cells: CellInfo[]
}

export function getRowCells(
  editor: Editor,
  rowIndex: number,
  tablePos: number,
): CellCollectionResult {
  const resolved = editor.state.doc.resolve(tablePos + 1)
  let tableNode: PMNode | null = null
  for (let d = resolved.depth; d >= 0; d--) {
    if (isTableNode(resolved.node(d))) {
      tableNode = resolved.node(d)
      break
    }
  }
  if (!tableNode) tableNode = editor.state.doc.nodeAt(tablePos)
  if (!tableNode || !isTableNode(tableNode)) return { cells: [] }

  const map = TableMap.get(tableNode)
  if (rowIndex < 0 || rowIndex >= map.height) return { cells: [] }

  const cells: CellInfo[] = []
  const seen = new Set<number>()
  for (let col = 0; col < map.width; col++) {
    const cellOffset = map.map[rowIndex * map.width + col]
    if (seen.has(cellOffset)) continue
    seen.add(cellOffset)
    const cellPos = tablePos + 1 + cellOffset
    cells.push({ node: editor.state.doc.nodeAt(cellPos), pos: cellPos })
  }
  return { cells }
}

export function getColumnCells(
  editor: Editor,
  colIndex: number,
  tablePos: number,
): CellCollectionResult {
  const resolved = editor.state.doc.resolve(tablePos + 1)
  let tableNode: PMNode | null = null
  for (let d = resolved.depth; d >= 0; d--) {
    if (isTableNode(resolved.node(d))) {
      tableNode = resolved.node(d)
      break
    }
  }
  if (!tableNode) tableNode = editor.state.doc.nodeAt(tablePos)
  if (!tableNode || !isTableNode(tableNode)) return { cells: [] }

  const map = TableMap.get(tableNode)
  if (colIndex < 0 || colIndex >= map.width) return { cells: [] }

  const cells: CellInfo[] = []
  const seen = new Set<number>()
  for (let row = 0; row < map.height; row++) {
    const cellOffset = map.map[row * map.width + colIndex]
    if (seen.has(cellOffset)) continue
    seen.add(cellOffset)
    const cellPos = tablePos + 1 + cellOffset
    cells.push({ node: editor.state.doc.nodeAt(cellPos), pos: cellPos })
  }
  return { cells }
}

// ---------------------------------------------------------------------------
// Index coordinates (for drag/drop selection)
// ---------------------------------------------------------------------------

export function getIndexCoordinates(opts: {
  editor: Editor
  index: number
  orientation: 'row' | 'column'
  tablePos: number
}): CellCoordinates[] | null {
  const { editor, index, orientation, tablePos } = opts
  const tableNode = editor.state.doc.nodeAt(tablePos)
  if (!tableNode || !isTableNode(tableNode)) return null

  const map = TableMap.get(tableNode)
  const coords: CellCoordinates[] = []

  if (orientation === 'row') {
    coords.push({ row: index, col: 0 })
    coords.push({ row: index, col: map.width - 1 })
  } else {
    coords.push({ row: 0, col: index })
    coords.push({ row: map.height - 1, col: index })
  }
  return coords
}

// ---------------------------------------------------------------------------
// Selection helpers
// ---------------------------------------------------------------------------

type SelectionMode = 'dispatch' | 'state'

export function selectCellsByCoords(
  editor: Editor,
  tablePos: number,
  coords: CellCoordinates[],
  opts?: { mode?: SelectionMode; dispatch?: (tr: Transaction) => void },
): EditorState | null {
  if (coords.length < 2) return null
  const tableNode = editor.state.doc.nodeAt(tablePos)
  if (!tableNode || !isTableNode(tableNode)) return null

  const map = TableMap.get(tableNode)
  const [start, end] = coords

  const startIdx = start.row * map.width + start.col
  const endIdx = end.row * map.width + end.col
  if (startIdx < 0 || startIdx >= map.map.length) return null
  if (endIdx < 0 || endIdx >= map.map.length) return null

  const anchorPos = tablePos + 1 + map.map[startIdx]
  const headPos = tablePos + 1 + map.map[endIdx]

  const sel = CellSelection.create(editor.state.doc, anchorPos, headPos)
  const mode = opts?.mode ?? 'dispatch'

  if (mode === 'dispatch') {
    const dispatch = opts?.dispatch ?? editor.view.dispatch.bind(editor.view)
    dispatch(editor.state.tr.setSelection(sel))
    return null
  }

  return editor.state.apply(editor.state.tr.setSelection(sel))
}

/**
 * Select the last cell in the given orientation (bottom row or rightmost col)
 * so that addRowAfter / addColumnAfter work correctly.
 */
export function selectLastCell(
  editor: Editor,
  tableNode: PMNode,
  tablePos: number,
  orientation: Orientation,
): void {
  const map = TableMap.get(tableNode)
  const lastRow = map.height - 1
  const lastCol = map.width - 1

  const targetOffset = orientation === 'row' ? map.map[lastRow * map.width] : map.map[lastCol]

  const cellPos = tablePos + 1 + targetOffset
  const sel = CellSelection.create(editor.state.doc, cellPos, cellPos)
  editor.view.dispatch(editor.state.tr.setSelection(sel))
}

// ---------------------------------------------------------------------------
// Cursor preservation
// ---------------------------------------------------------------------------

export function runPreservingCursor(editor: Editor, fn: () => void): void {
  const { state } = editor
  const { selection } = state
  const isCellSel = selection instanceof CellSelection

  fn()

  if (!isCellSel) {
    try {
      const $pos = editor.state.doc.resolve(
        Math.min(selection.anchor, editor.state.doc.content.size),
      )
      const newSel = TextSelection.near($pos)
      editor.view.dispatch(editor.state.tr.setSelection(newSel))
    } catch {
      // position no longer valid after structural change
    }
  }
}

// ---------------------------------------------------------------------------
// Empty cell / row / column detection
// ---------------------------------------------------------------------------

export function isCellEmpty(node: PMNode): boolean {
  if (node.childCount === 0) return true
  if (node.childCount > 1) return false
  const child = node.firstChild!
  return child.type.name === 'paragraph' && child.content.size === 0
}

export function countEmptyRowsFromEnd(editor: Editor, tablePos: number): number {
  const tableNode = editor.state.doc.nodeAt(tablePos)
  if (!tableNode || !isTableNode(tableNode)) return 0

  let count = 0
  for (let r = tableNode.childCount - 1; r >= 0; r--) {
    const row = tableNode.child(r)
    let rowEmpty = true
    for (let c = 0; c < row.childCount; c++) {
      if (!isCellEmpty(row.child(c))) {
        rowEmpty = false
        break
      }
    }
    if (!rowEmpty) break
    count++
  }
  return count
}

export function countEmptyColumnsFromEnd(editor: Editor, tablePos: number): number {
  const tableNode = editor.state.doc.nodeAt(tablePos)
  if (!tableNode || !isTableNode(tableNode)) return 0

  const map = TableMap.get(tableNode)
  let count = 0

  for (let c = map.width - 1; c >= 0; c--) {
    let colEmpty = true
    for (let r = 0; r < map.height; r++) {
      const cellOffset = map.map[r * map.width + c]
      const cellNode = editor.state.doc.nodeAt(tablePos + 1 + cellOffset)
      if (cellNode && !isCellEmpty(cellNode)) {
        colEmpty = false
        break
      }
    }
    if (!colEmpty) break
    count++
  }
  return count
}

// ---------------------------------------------------------------------------
// Misc utilities
// ---------------------------------------------------------------------------

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/**
 * Rounds with a dead-zone near 0 to prevent jitter during drag.
 */
export function marginRound(value: number, margin: number): number {
  const floor = Math.floor(value)
  const frac = value - floor
  if (frac < margin) return floor
  if (frac > 1 - margin) return floor + 1
  return floor
}

export function rectEq(a: DOMRect | null, b: DOMRect | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

/**
 * Command to set a cell attribute on all cells in a CellSelection.
 */
export function setCellAttr(name: string, value: unknown) {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    const { selection } = state
    if (!(selection instanceof CellSelection)) return false

    const tr = state.tr
    selection.forEachCell((node, pos) => {
      if (node.attrs[name] !== value) {
        tr.setNodeMarkup(pos, null, { ...node.attrs, [name]: value })
      }
    })

    if (tr.docChanged && dispatch) dispatch(tr)
    return true
  }
}
