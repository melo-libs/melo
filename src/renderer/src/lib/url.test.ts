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
