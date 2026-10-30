import { expect, it } from 'vitest'
import { editPreview } from './editPreview'

it('previews only changed lines and nearby context without dropping the proposed edit', () => {
  const before = Array.from({ length: 100 }, (_, i) => `Line ${i}`).join('\n') + '\n'
  const after = before.replace('Line 50', 'A clearer line')
  const diff = editPreview('Note.md', before, after)
  expect(diff).toContain('-Line 50')
  expect(diff).toContain('+A clearer line')
  expect(diff).toContain(' Line 49')
  expect(diff).not.toContain('Line 90')
})
