import { describe, expect, it } from 'vitest'
import { MarkdownManager } from '@tiptap/markdown'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import type { JSONContent } from '@tiptap/core'
import { Wikilink } from './Wikilink'

const manager = new MarkdownManager({ extensions: [Document, Paragraph, Text, Wikilink] })

function firstParagraph(doc: JSONContent): JSONContent[] {
  return doc.content?.[0]?.content ?? []
}

describe('wikilink markdown round-trip', () => {
  it('parses [[Target]] into a wikilink node', () => {
    const inline = firstParagraph(manager.parse('See [[Weekly Review]] tomorrow'))
    expect(inline).toEqual([
      { type: 'text', text: 'See ' },
      { type: 'wikilink', attrs: { target: 'Weekly Review', label: null } },
      { type: 'text', text: ' tomorrow' },
    ])
  })

  it('parses [[Target|alias]] with a label', () => {
    const inline = firstParagraph(manager.parse('[[The CODE Method|CODE]]'))
    expect(inline[0]).toEqual({
      type: 'wikilink',
      attrs: { target: 'The CODE Method', label: 'CODE' },
    })
  })

  it('leaves heading-level and empty targets as plain text', () => {
    for (const src of ['[[Note#Section]]', '[[ ]]', '[[]]']) {
      const inline = firstParagraph(manager.parse(src))
      expect(inline.every((n) => n.type === 'text')).toBe(true)
    }
  })

  it('serializes back to [[Target]] and [[Target|alias]]', () => {
    const doc: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'wikilink', attrs: { target: 'A', label: null } },
            { type: 'text', text: ' and ' },
            { type: 'wikilink', attrs: { target: 'B', label: 'bee' } },
          ],
        },
      ],
    }
    expect(manager.serialize(doc)).toBe('[[A]] and [[B|bee]]')
  })

  it('drops a label identical to the target', () => {
    const doc: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'wikilink', attrs: { target: 'Same', label: 'Same' } }],
        },
      ],
    }
    expect(manager.serialize(doc)).toBe('[[Same]]')
  })

  it('round-trips through parse → serialize unchanged', () => {
    const md = 'Before [[One]] mid [[Two|alias]] after'
    expect(manager.serialize(manager.parse(md))).toBe(md)
  })

  it('sanitizes unrepresentable characters so serialize → parse is closed', () => {
    const doc: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'wikilink', attrs: { target: 'A|B [x] #tag', label: null } }],
        },
      ],
    }
    const md = manager.serialize(doc)
    expect(md).toBe('[[A B x tag]]')
    const inline = firstParagraph(manager.parse(md))
    expect(inline[0]).toEqual({ type: 'wikilink', attrs: { target: 'A B x tag', label: null } })
  })

  // Documented tradeoffs, matching Obsidian: the wikilink tokenizer wins
  // over a standard md link reading of the same brackets, and nested
  // brackets resolve to the innermost [[…]].
  it('preempts [[A]](url) as wikilink + literal text', () => {
    const inline = firstParagraph(manager.parse('[[A]](url)'))
    expect(inline[0]).toEqual({ type: 'wikilink', attrs: { target: 'A', label: null } })
    expect(inline[1]).toEqual({ type: 'text', text: '(url)' })
  })

  it('resolves [[[A]]] to the innermost wikilink', () => {
    const inline = firstParagraph(manager.parse('[[[A]]]'))
    expect(inline).toContainEqual({ type: 'wikilink', attrs: { target: 'A', label: null } })
  })
})
