import { describe, expect, it } from 'vitest'
import { formatFrontmatterDate, formatSize } from './format'
import { parseClipSource } from '../components/editor/ClipBanner'

describe('formatFrontmatterDate', () => {
  it('renders a full ISO instant as a calendar date', () => {
    const out = formatFrontmatterDate('2026-08-03T10:30:00.000Z', 'en-US')
    expect(out).toContain('2026')
    expect(out).not.toContain('T10:30')
  })

  it('falls back to the raw string for unparseable input', () => {
    expect(formatFrontmatterDate('soonish', 'en-US')).toBe('soonish')
  })
})

describe('parseClipSource', () => {
  it('extracts a full ISO created value (colons and all)', () => {
    const fm = [
      'title: x',
      'source: https://example.com/a',
      'created: 2026-08-03T10:30:00.000Z',
    ].join('\n')
    const src = parseClipSource(fm)
    expect(src?.url).toBe('https://example.com/a')
    expect(src?.created).toBe('2026-08-03T10:30:00.000Z')
  })
})

describe('formatSize', () => {
  it('scales units', () => {
    expect(formatSize(512)).toBe('512 B')
    expect(formatSize(2048)).toBe('2.0 KB')
  })
})
