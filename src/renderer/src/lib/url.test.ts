import { describe, expect, it } from 'vitest'
import { classifyDocumentHref } from '@shared/documentLinks'
import { normalizeLinkInput } from './url'

describe('document hrefs versus typed web addresses', () => {
  it.each([
    'other.md',
    'notes/a.md',
    './image.png',
    '../a.md',
    '/notes/a.md',
    'file:///notes/a.md',
    'C:\\notes\\a.md',
    'example.com/image.png',
  ])('keeps stored %s as a local reference', (href) => {
    expect(classifyDocumentHref(href)).toEqual({ kind: 'local', href })
    expect(normalizeLinkInput(href, href)).toBe(href)
  })
  it('completes newly typed website addresses without changing stored hrefs', () => {
    expect(normalizeLinkInput('example.com')).toBe('https://example.com/')
    expect(normalizeLinkInput('example.com/path')).toBe('https://example.com/path')
    expect(classifyDocumentHref('example.com')).toEqual({ kind: 'local', href: 'example.com' })
    expect(normalizeLinkInput('notes/next.md')).toBe('notes/next.md')
  })
  it.each([
    'example.com/docs/guide.pdf',
    'example.com/image.png',
    'example.com/readme.md',
    'docs.example.co.uk/guide.pdf?download=1#page=2',
    'xn--fsqu00a.xn--0zwm56d/guide.pdf',
  ])('completes new website input before checking its file extension: %s', (href) => {
    expect(normalizeLinkInput(href)).toBe(`https://${href}`)
  })
  it('completes Unicode domains with document paths', () => {
    expect(normalizeLinkInput('例子.测试/guide.pdf')).toBe(
      'https://xn--fsqu00a.xn--0zwm56d/guide.pdf',
    )
  })
  it.each([
    '.assets/image.png',
    'notes.v2/image.png',
    'notes/guide.pdf',
    './example.com/image.png',
    '/example.com/guide.pdf',
    'guide.pdf',
  ])('preserves newly entered local paths: %s', (href) => {
    expect(normalizeLinkInput(href)).toBe(href)
  })
  it('recognizes explicit external URLs and heading fragments', () => {
    expect(classifyDocumentHref('https://example.com')).toEqual({
      kind: 'external',
      url: 'https://example.com/',
    })
    expect(classifyDocumentHref('#%E6%A0%87%E9%A2%98')).toEqual({
      kind: 'fragment',
      fragment: '标题',
    })
    expect(classifyDocumentHref('mailto:test@example.com').kind).toBe('external')
  })
  it.each([
    '',
    'javascript:alert(1)',
    'data:text/html,test',
    'obsidian://note',
    'java\tscript:alert(1)',
    '#%xx',
  ])('rejects unsafe or unsupported input %s', (href) => {
    expect(classifyDocumentHref(href).kind).toBe('unsupported')
    expect(normalizeLinkInput(href)).toBeNull()
  })
})
