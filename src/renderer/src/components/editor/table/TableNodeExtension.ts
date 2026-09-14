import { Extension, type AnyExtension, type Editor } from '@tiptap/core'
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table'
import { TableView, TableMap } from '@tiptap/pm/tables'
import { cellAround, columnResizing, tableEditing } from '@tiptap/pm/tables'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Fragment, Slice, type Node as PMNode } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'
import { TableHandleExtension } from './TableHandlePlugin'
import { RESIZE_MIN_WIDTH, EMPTY_CELL_WIDTH } from './tableUtils'

// ---------------------------------------------------------------------------
// Persistence guards — GFM pipe tables are the storage format
// ---------------------------------------------------------------------------

/** Strip col/rowspan from pasted cells: the merge UI is gone (pipe tables
 *  can't express spans), but pasted HTML could still smuggle them in and
 *  shred column alignment on save. Cells a span used to cover are filled
 *  back in by prosemirror-tables' fixTables normalization. */
function flattenSpans(fragment: Fragment): Fragment {
  const nodes: PMNode[] = []
  fragment.forEach((child) => {
    let node = child
    const isCell = child.type.name === 'tableCell' || child.type.name === 'tableHeader'
    if (isCell && ((child.attrs.colspan as number) > 1 || (child.attrs.rowspan as number) > 1)) {
      node = child.type.create(
        { ...child.attrs, colspan: 1, rowspan: 1, colwidth: null },
        flattenSpans(child.content),
        child.marks,
      )
    } else if (child.content.childCount > 0) {
      node = child.copy(flattenSpans(child.content))
    }
    nodes.push(node)
  })
  return Fragment.fromArray(nodes)
}

/** Enter inside a cell moves to the cell below (creating a row on the last
 *  one) — the Obsidian/Typora convention. The default paragraph split would
 *  put a second block in the cell, and the markdown serializer glues cell
 *  blocks together with no separator: the "line break" evaporates on save. */
function selectCellBelow(editor: Editor): boolean {
  const { state } = editor
  const $cell = cellAround(state.selection.$anchor)
  if (!$cell) return false

  const table = $cell.node(-1)
  const tableStart = $cell.start(-1)
  const rect = TableMap.get(table).findCell($cell.pos - tableStart)
  if (rect.bottom >= TableMap.get(table).height) {
    if (!editor.chain().addRowAfter().run()) return false
  }

  // Re-resolve — addRowAfter may have rewritten the table.
  const s = editor.state
  const $c = cellAround(s.selection.$anchor)
  if (!$c) return false
  const t = $c.node(-1)
  const start = $c.start(-1)
  const map = TableMap.get(t)
  const r = map.findCell($c.pos - start)
  const below = start + map.positionAt(r.top + 1, r.left, t)
  editor.view.dispatch(
    s.tr.setSelection(TextSelection.near(s.doc.resolve(below + 1), 1)).scrollIntoView(),
  )
  return true
}

// ---------------------------------------------------------------------------
// Custom TableView — adds container with slots for handles & overlay
// ---------------------------------------------------------------------------

class MeloTableView extends TableView {
  public blockContainer: HTMLElement
  public innerTableContainer: HTMLElement
  public widgetsContainer: HTMLElement
  public overlayContainer: HTMLElement

  constructor(node: PMNode, cellMinWidth: number) {
    super(node, cellMinWidth)

    this.blockContainer = document.createElement('div')
    this.blockContainer.setAttribute('data-content-type', 'table')

    this.innerTableContainer = this.dom as HTMLElement

    this.widgetsContainer = document.createElement('div')
    this.widgetsContainer.className = 'table-controls'
    this.widgetsContainer.contentEditable = 'false'

    this.overlayContainer = document.createElement('div')
    this.overlayContainer.className = 'table-selection-overlay-container'
    this.overlayContainer.contentEditable = 'false'

    this.innerTableContainer.appendChild(this.widgetsContainer)
    this.innerTableContainer.appendChild(this.overlayContainer)

    this.blockContainer.appendChild(this.innerTableContainer)
    ;(this as unknown as { dom: HTMLElement }).dom = this.blockContainer
  }

  ignoreMutation(record: MutationRecord | { type: 'selection'; target: Node }): boolean {
    if (
      this.widgetsContainer.contains(record.target) ||
      this.overlayContainer.contains(record.target)
    ) {
      return true
    }
    return super.ignoreMutation(record)
  }
}

// ---------------------------------------------------------------------------
// TableNode — extends Table with custom NodeView
// ---------------------------------------------------------------------------

const TableNode = Table.extend({
  addProseMirrorPlugins() {
    const isResizable = this.options.resizable
    const defaultCellMinWidth = Math.max(this.options.cellMinWidth, EMPTY_CELL_WIDTH)

    return [
      ...(isResizable
        ? [
            columnResizing({
              handleWidth: this.options.handleWidth,
              cellMinWidth: RESIZE_MIN_WIDTH,
              defaultCellMinWidth,
              lastColumnResizable: this.options.lastColumnResizable,
            }),
          ]
        : []),
      tableEditing({ allowTableNodeSelection: this.options.allowTableNodeSelection }),
      new Plugin({
        key: new PluginKey('tableFlattenSpans'),
        props: {
          transformPasted: (slice) =>
            new Slice(flattenSpans(slice.content), slice.openStart, slice.openEnd),
        },
      }),
    ]
  },

  addNodeView() {
    const defaultCellMinWidth = Math.max(this.options.cellMinWidth, EMPTY_CELL_WIDTH)
    return ({ node }: { node: PMNode; view: EditorView }) => {
      return new MeloTableView(node, defaultCellMinWidth)
    }
  },
})

// ---------------------------------------------------------------------------
// TableCellNode — Cmd-A selects text within a cell, not the whole document
// ---------------------------------------------------------------------------

const TableCellNode = TableCell.extend({
  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),
      // Select the cell's TEXT (not the cell's block boundaries) so a
      // subsequent Backspace deletes the content and leaves an empty
      // paragraph, instead of removing the paragraph node and bouncing the
      // cursor to the next cell. TextSelection.between(..., 1) snaps the
      // endpoints inside the textblock; TextSelection.create with the cell's
      // content edges would span the block boundary and cause the bounce.
      'Mod-a': () => {
        const { state, view } = this.editor
        const { selection, doc } = state

        const cell = cellAround(selection.$anchor)
        if (!cell) return false

        const cellNode = doc.nodeAt(cell.pos)
        if (!cellNode || !cellNode.textContent) return false

        const from = cell.pos + 1
        const to = cell.pos + cellNode.nodeSize - 1
        if (from >= to) return true

        const sel = TextSelection.between(doc.resolve(from), doc.resolve(to), 1)
        if (state.selection.eq(sel)) return true

        view.dispatch(state.tr.setSelection(sel))
        return true
      },
      Enter: () => selectCellBelow(this.editor),
    }
  },
})

// Header cells get the same Enter behavior (move into the body below).
const TableHeaderNode = TableHeader.extend({
  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),
      Enter: () => selectCellBelow(this.editor),
    }
  },
})

// ---------------------------------------------------------------------------
// TableKit — bundles all table extensions into one
// ---------------------------------------------------------------------------

export interface TableKitOptions {
  table: false | Record<string, unknown>
  tableCell: false | Record<string, unknown>
  tableHeader: false | Record<string, unknown>
  tableRow: false | Record<string, unknown>
}

export const TableKit = Extension.create<TableKitOptions>({
  name: 'tableKit',

  addExtensions() {
    const extensions: AnyExtension[] = []

    if (this.options.table !== false) {
      extensions.push(
        TableNode.configure({
          resizable: true,
          cellMinWidth: RESIZE_MIN_WIDTH,
          ...this.options.table,
        }),
      )
    }

    if (this.options.tableCell !== false) {
      extensions.push(TableCellNode.configure(this.options.tableCell ?? {}))
    }

    if (this.options.tableHeader !== false) {
      extensions.push(TableHeaderNode.configure(this.options.tableHeader ?? {}))
    }

    if (this.options.tableRow !== false) {
      extensions.push(TableRow.configure(this.options.tableRow ?? {}))
    }

    extensions.push(TableHandleExtension)

    return extensions
  },
})
