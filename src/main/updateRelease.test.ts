import { describe, expect, it } from 'vitest'
import { isNewerVersion, updateRelease } from './updateRelease'
import type { UpdateInfo } from 'electron-updater'

const info: UpdateInfo = {
  version: '2.0.2',
  releaseDate: '2026-10-22',
  files: [],
  path: '',
  sha512: '',
}

describe('release descriptions', () => {
  it('compares stable versions numerically', () => {
    expect(isNewerVersion('2.0.10', '2.0.9')).toBe(true)
    expect(isNewerVersion('2.0.2', '2.0.2')).toBe(false)
    expect(isNewerVersion('2.0.1', '2.0.2')).toBe(false)
    expect(isNewerVersion('../2.0.2', '2.0.1')).toBe(false)
  })
  it('keeps readable release notes but never passes HTML or active content to the renderer', () => {
    const result = updateRelease({
      ...info,
      releaseNotes:
        '<h2>New</h2><ul><li>Search</li><li>Editing</li></ul><script>bad()</script><img src="https://tracking.invalid/a" onerror="bad()">',
    })
    expect(result.notes).toContain('• Search\n• Editing')
    expect(result.notes).not.toMatch(/bad|<|tracking/)
  })
  it('accepts Markdown and selects only the current release from a changelog', () => {
    expect(updateRelease({ ...info, releaseNotes: '## Fixes\n- **Search** works' }).notes).toBe(
      'Fixes\n- Search works',
    )
    expect(
      updateRelease({
        ...info,
        releaseNotes: [
          { version: '2.0.1', note: 'Old' },
          { version: '2.0.2', note: 'New' },
        ],
      }).notes,
    ).toBe('New')
  })
  it('handles empty notes and invalid dates without inventing release highlights', () => {
    expect(updateRelease({ ...info, releaseDate: 'invalid' })).toEqual({
      version: '2.0.2',
      date: null,
      notes: '',
    })
  })
})
