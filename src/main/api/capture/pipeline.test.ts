import { expect, it } from 'vitest'
import { extractFaviconUrl } from './pipeline'

it('resolves the page icon relative to its URL', () => {
  expect(
    extractFaviconUrl('<link href="../brand.svg" rel="icon">', 'https://example.com/blog/post'),
  ).toBe('https://example.com/brand.svg')
  expect(
    extractFaviconUrl(
      '<link rel="shortcut icon" href="//cdn.example.com/icon.png">',
      'https://example.com',
    ),
  ).toBe('https://cdn.example.com/icon.png')
})

it('falls back to the origin favicon for missing or unsafe icon URLs', () => {
  for (const html of [
    '',
    '<link rel="icon" href="file:///etc/passwd">',
    '<link rel="icon" href="javascript:alert(1)">',
  ]) {
    expect(extractFaviconUrl(html, 'https://example.com/article')).toBe(
      'https://example.com/favicon.ico',
    )
  }
})
