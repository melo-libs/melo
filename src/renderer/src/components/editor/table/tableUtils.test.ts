import { describe, expect, it } from 'vitest'
import { getSchema } from '@tiptap/core'
import { MarkdownManager } from '@tiptap/markdown'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { CellSelection, TableMap } from '@tiptap/pm/tables'
import { history, redo, undo } from '@tiptap/pm/history'
import { editorExtensions } from '../tiptapExtensions'
import { setColumnAlignment } from './tableUtils'

const schema = getSchema(editorExtensions)
const markdown = new MarkdownManager({ extensions: editorExtensions })

function tableState(row: number, column: number, end?: [number, number]): EditorState {
  const doc = schema.nodeFromJSON(
    markdown.parse('| Item | Status |\n| :--- | ---: |\n| First | One |\n| Second | Two |'),
  )
  const table = doc.firstChild!
  const map = TableMap.get(table)
  const pos = 1 + map.positionAt(row, column, table)
  const selection = end
    ? CellSelection.create(doc, pos, 1 + map.positionAt(end[0], end[1], table))
    : TextSelection.create(doc, pos + 2)
  return EditorState.create({ doc, selection, plugins: [history()] })
}

function alignments(state: EditorState): (string | null)[][] {
  const rows: (string | null)[][] = []
  state.doc.firstChild!.forEach((row) => {
    const cells: (string | null)[] = []
    row.forEach((cell) => cells.push(cell.attrs.align as string | null))
    rows.push(cells)
  })
  return rows
}

describe('table column alignment', () => {
  it.each(['left', 'center', 'right'] as const)(
    'sets %s from a text cursor and preserves it through Markdown saves',
    (alignment) => {
      for (const row of [0, 1]) {
        let state = tableState(row, 0)
        expect(setColumnAlignment(alignment)(state, (tr) => (state = state.apply(tr)))).toBe(true)
        expect(alignments(state)).toEqual([
          [alignment, 'right'],
          [alignment, 'right'],
          [alignment, 'right'],
        ])
        const saved = markdown.serialize(state.doc.toJSON())
        const reopened = schema.nodeFromJSON(markdown.parse(saved))
        expect(reopened.eq(state.doc)).toBe(true)
      }
    },
  )

  it('aligns all columns touched by a multi-cell selection', () => {
    let state = tableState(1, 0, [2, 1])
    setColumnAlignment('center')(state, (tr) => (state = state.apply(tr)))
    expect(alignments(state)).toEqual([
      ['center', 'center'],
      ['center', 'center'],
      ['center', 'center'],
    ])
  })

  it('keeps a whole-column selection confined to that column', () => {
    let state = tableState(0, 0, [2, 0])
    setColumnAlignment('center')(state, (tr) => (state = state.apply(tr)))
    expect(alignments(state)).toEqual([
      ['center', 'right'],
      ['center', 'right'],
      ['center', 'right'],
    ])
  })

  it('undoes and redoes the whole alignment change in one step', () => {
    let state = tableState(1, 0)
    const original = state.doc
    setColumnAlignment('center')(state, (tr) => (state = state.apply(tr)))
    const aligned = state.doc
    expect(undo(state, (tr) => (state = state.apply(tr)))).toBe(true)
    expect(state.doc.eq(original)).toBe(true)
    expect(redo(state, (tr) => (state = state.apply(tr)))).toBe(true)
    expect(state.doc.eq(aligned)).toBe(true)
  })

  it('does not dispatch for an already aligned column or a dry run', () => {
    const state = tableState(1, 1)
    expect(setColumnAlignment('right')(state, () => expect.unreachable())).toBe(true)
    expect(setColumnAlignment('center')(state)).toBe(true)
    expect(alignments(state)[1]).toEqual(['left', 'right'])
  })

  it('does not handle a cursor outside a table', () => {
    const doc = schema.node('doc', null, [schema.node('paragraph')])
    const state = EditorState.create({ doc })
    expect(setColumnAlignment('center')(state, () => expect.unreachable())).toBe(false)
  })
})
