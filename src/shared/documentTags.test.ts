import { expect, it } from 'vitest'
import { assertTagOnlyChange, readDocumentTags, updateDocumentTags } from './documentTags'

it.each([
  '# Note\nBody',
  '---\ntags:\nauthor: A\n---\nBody',
  '---\ntags:\n- old\n- work\nauthor: A\n---\nBody',
  '---\n{author: A}\n---\nBody',
  '\n# Leading blank\n',
  '---\ntitle: "Keep quotes" # comment\ntags: [Old, Work] # tag comment\ncreated: 2026-11-05\n---\n\n# Body\n',
  '---\ntags:\n  - old\n  - Work\nauthor: Someone\n---\nBody\n',
  '---\r\ntags: old\r\nauthor: Someone\r\n---\r\nBody\r\n',
])('changes only tags and allows an exact undo of %s', (source) => {
  const changed = updateDocumentTags(source, ['#Travel', 'travel', '中文'])
  expect(readDocumentTags(changed)).toEqual(['travel', '中文'])
  assertTagOnlyChange(source, changed)
  assertTagOnlyChange(changed, source)
  if (source.includes('title:')) expect(changed).toContain('title: "Keep quotes" # comment')
  if (source.includes('author: Someone')) expect(changed).toContain('author: Someone')
  expect(updateDocumentTags(changed, ['travel', '中文'])).toBe(changed)
})
it.each([
  '---\ntags: [broken\n---\nBody',
  '---\ntags: old\ntags: new\n---\nBody',
  '---\n<<: {tags: old}\n---\nBody',
  '---\ntags: {a: b}\n---\nBody',
])('refuses ambiguous or malformed metadata', (source) => {
  expect(() => updateDocumentTags(source, ['work'])).toThrow()
})
it('rejects edits to the body or unrelated metadata', () => {
  expect(() => assertTagOnlyChange('Body', 'Changed')).toThrow()
  expect(() =>
    assertTagOnlyChange('---\nauthor: A\n---\nBody', '---\nauthor: B\n---\nBody'),
  ).toThrow()
})
