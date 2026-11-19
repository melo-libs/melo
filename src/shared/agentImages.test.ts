import { expect, it } from 'vitest'
import { agentImageSource } from './agentImages'

it.each([
  ['https://example.com/photo.jpg?size=large', 'remote'],
  ['http://example.com/photo', 'remote'],
  ['data:image/png;base64,aGVsbG8=', 'data'],
  ['.assets/2026/11/图片.png', 'workspace'],
  ['./Inbox/a%20b.gif', 'workspace'],
])('recognizes supported image source %s', (source, kind) => {
  expect(agentImageSource(source)?.kind).toBe(kind)
})

it.each([
  'javascript:alert(1)',
  'file:///etc/image.png',
  'app://image.png',
  'https://user:secret@example.com/image.png',
  '//example.com/image.png',
  '../image.png',
  '%2e%2e/image.png',
  '.assets/../secret.png',
  '.melo/secret.png',
  'folder\\image.png',
  '/tmp/image.png',
  'data:text/html;base64,aGVsbG8=',
  'data:image/svg+xml;base64,aGVsbG8=',
  'image%.png',
])('rejects unsupported or escaping image source %s', (source) => {
  expect(agentImageSource(source)).toBeNull()
})
