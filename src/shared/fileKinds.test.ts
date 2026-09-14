import { describe, expect, it } from 'vitest'
import { isMarkdownPath, isTextDocumentPath, stripMarkdownExtension } from './fileKinds'

describe('markdown file helpers', () => {
  it('recognizes both standard markdown extensions case-insensitively', () => {
    expect(isMarkdownPath('/notes/one.md')).toBe(true)
    expect(isMarkdownPath('/notes/two.MARKDOWN')).toBe(true)
    expect(isMarkdownPath('/notes/three.txt')).toBe(false)
  })

  it('strips either markdown extension from display names', () => {
    expect(stripMarkdownExtension('one.md')).toBe('one')
    expect(stripMarkdownExtension('two.MARKDOWN')).toBe('two')
    expect(stripMarkdownExtension('three.txt')).toBe('three.txt')
  })

  it('limits system document opens to editable text formats', () => {
    expect(isTextDocumentPath('/notes/one.md')).toBe(true)
    expect(isTextDocumentPath('/notes/two.markdown')).toBe(true)
    expect(isTextDocumentPath('/notes/three.txt')).toBe(true)
    expect(isTextDocumentPath('/notes/four.pdf')).toBe(false)
  })
})
