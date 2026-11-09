import { describe, expect, it } from 'vitest'
import { getSchema } from '@tiptap/core'
import { MarkdownManager } from '@tiptap/markdown'
import { Fragment, Slice } from '@tiptap/pm/model'
import { CellSelection, TableMap } from '@tiptap/pm/tables'
import { AllSelection, NodeSelection, TextSelection } from '@tiptap/pm/state'
import { editorExtensions } from './tiptapExtensions'
import {
  GENERIC_CLIPBOARD_NODES,
  hasProseMirrorSlice,
  isSingleImageSlice,
  shouldPreferClipboardHtml,
  sliceToMarkdown,
  sliceToPlainText,
} from './clipboard'

const manager = new MarkdownManager({ extensions: editorExtensions })
const schema = getSchema(editorExtensions)
const slice = (markdown: string) =>
  new Slice(schema.nodeFromJSON(manager.parse(markdown)).content, 0, 0)

describe('clipboard representations', () => {
  it.each([
    ['text with an image', 'Before ![Image](https://example.com/image.png) after', true],
    ['a table', '| A | B |\n| --- | --- |\n| One | Two |', true],
    ['text without an image', 'Selected text', true],
    ['a list containing only an image', '- ![Image](https://example.com/image.png)', true],
    [
      'multiple images',
      '![First](https://example.com/a.png) ![Second](https://example.com/b.png)',
      true,
    ],
    ['a single image', '![Image](https://example.com/image.png)', false],
    ['empty markup', '', false],
  ] as const)('selects the appropriate format for %s', (_label, markdown, expected) => {
    expect(shouldPreferClipboardHtml('<div>Clipboard HTML</div>', slice(markdown))).toBe(expected)
  })

  it('keeps native image slices but does not prefer a text-derived slice without HTML', () => {
    const image = slice('![Image](.assets/image.png)')
    expect(shouldPreferClipboardHtml('<p data-pm-slice="1 1 []"><img></p>', image)).toBe(true)
    expect(shouldPreferClipboardHtml('', slice('Text'))).toBe(false)
    expect(shouldPreferClipboardHtml('<p><br></p>', new Slice(Fragment.empty, 0, 0))).toBe(false)
  })

  it('requires every non-generic node to declare a text representation', () => {
    const missing = Object.values(schema.nodes)
      .filter((node) => !GENERIC_CLIPBOARD_NODES.has(node.name) && !node.spec.toText)
      .map((node) => node.name)
    expect(missing).toEqual([])
  })

  it('keeps literal punctuation without adding file-format escaping', () => {
    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, schema.text('1. text # *literal* \\path')),
    ])
    const content = new Slice(doc.content, 0, 0)
    expect(sliceToPlainText(content)).toBe('1. text # *literal* \\path')
    expect(sliceToMarkdown(manager, content)).toContain('1\\. text')
  })

  it('preserves lists, starting numbers, nested items and task status as readable text', () => {
    expect(sliceToPlainText(slice('3. First\n4. Second'))).toBe('3. First\n4. Second')
    expect(sliceToPlainText(slice('- Parent\n  - Child\n- Next'))).toBe(
      '• Parent\n  • Child\n• Next',
    )
    expect(sliceToPlainText(slice('- [x] Done\n- [ ] Pending'))).toBe('☑ Done\n☐ Pending')
  })

  it('keeps a clipped list item as selected text', () => {
    const doc = schema.nodeFromJSON(manager.parse('- clipped item'))
    const selection = TextSelection.create(doc, 5, 15)
    expect(sliceToPlainText(selection.content(), selection.$from)).toBe('ipped item')
  })

  it('keeps the original number when copying later ordered-list items', () => {
    const doc = schema.nodeFromJSON(manager.parse('3. First\n4. Second\n5. Third'))
    const second = 2 + doc.firstChild!.firstChild!.nodeSize
    const selection = TextSelection.create(doc, second + 1, doc.content.size - 3)
    expect(sliceToPlainText(selection.content(), selection.$from)).toBe('4. Second\n5. Third')
  })

  it('does not emit unselected parent markers or indentation around nested list selections', () => {
    const paragraph = (text: string) => schema.nodes.paragraph.create(null, schema.text(text))
    const item = (text: string) => schema.nodes.listItem.create(null, paragraph(text))
    const doc = schema.nodes.doc.create(
      null,
      schema.nodes.orderedList.create({ start: 1 }, [
        schema.nodes.listItem.create(null, [
          paragraph('Outer'),
          schema.nodes.orderedList.create({ start: 7 }, [
            item('InnerA'),
            item('InnerB'),
            item('InnerC'),
          ]),
        ]),
      ]),
    )
    let from = 0,
      to = 0
    doc.descendants((node, pos) => {
      if (node.text === 'InnerB') from = pos
      if (node.text === 'InnerC') to = pos + node.nodeSize
    })
    const selection = TextSelection.create(doc, from, to)
    expect(sliceToPlainText(selection.content(), selection.$from)).toBe('8. InnerB\n9. InnerC')
    const partial = TextSelection.create(doc, from + 2, to)
    expect(sliceToPlainText(partial.content(), partial.$from)).toBe('nerB\n9. InnerC')
  })

  it('detects a single image by content, including select-all and trailing blank paragraphs', () => {
    const image = schema.nodes.image.create({ src: '.assets/picture.png', alt: 'Caption' })
    const paragraph = schema.nodes.paragraph.create(null, image)
    const doc = schema.nodes.doc.create(null, [paragraph, schema.nodes.paragraph.create()])
    expect(isSingleImageSlice(new AllSelection(doc).content())).toBe(true)
    expect(isSingleImageSlice(TextSelection.create(doc, 1, 2).content())).toBe(true)
    expect(isSingleImageSlice(NodeSelection.create(doc, 1).content())).toBe(true)
    expect(isSingleImageSlice(new Slice(Fragment.fromArray([paragraph, paragraph]), 0, 0))).toBe(
      false,
    )
    expect(isSingleImageSlice(slice('Text ![Image](.assets/x.png)'))).toBe(false)
  })

  it('uses tab-separated rows for a table and preserves only selected cells', () => {
    const doc = schema.nodeFromJSON(
      manager.parse(
        '| A | B | C |\n| --- | --- | --- |\n| One | Two | Three |\n| Four | Five | Six |',
      ),
    )
    const table = doc.firstChild!
    const map = TableMap.get(table)
    const selected = CellSelection.create(
      doc,
      1 + map.positionAt(1, 1, table),
      1 + map.positionAt(2, 2, table),
    ).content()
    expect(sliceToPlainText(selected)).toBe('Two\tThree\nFive\tSix')
    expect(sliceToMarkdown(manager, selected)).toContain('Two')
    expect(sliceToMarkdown(manager, selected)).not.toContain('One')
    expect(manager.parse(sliceToMarkdown(manager, selected)!).content?.[0].type).toBe('table')
  })

  it('includes atom nodes and preserves code indentation and hard breaks', () => {
    expect(sliceToPlainText(slice('See [[Target|Label]] and $x^2$.\n\n$$\ny = x\n$$'))).toBe(
      'See Label and $x^2$.\n\n$$y = x$$',
    )
    expect(sliceToPlainText(slice('```ts\n  x\n    y\n```'))).toBe('  x\n    y')
    expect(sliceToPlainText(slice('First  \nSecond'))).toBe('First\nSecond')
  })

  it('serializes image and formula NodeSelections instead of treating them as empty', () => {
    for (const node of [
      schema.nodes.image.create({ src: '.assets/image.png', alt: 'Caption' }),
      schema.nodes.inlineMath.create({ latex: 'x' }),
    ]) {
      const doc = schema.node('doc', null, [schema.node('paragraph', null, node)])
      const selection = NodeSelection.create(doc, 1)
      expect(selection.empty).toBe(false)
      expect(sliceToPlainText(selection.content())).toBe(
        node.type.name === 'image' ? 'Caption' : '$x$',
      )
      expect(sliceToMarkdown(manager, selection.content())).toBeTruthy()
    }
    expect(sliceToPlainText(new Slice(Fragment.empty, 0, 0))).toBe('')
  })

  it('recognizes native clipboard metadata before external Markdown heuristics', () => {
    expect(hasProseMirrorSlice('<p data-pm-slice="1 1 []">1. literal</p>')).toBe(true)
    expect(hasProseMirrorSlice('<p>1. literal</p>')).toBe(false)
  })
})
