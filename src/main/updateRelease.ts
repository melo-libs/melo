import type { UpdateInfo } from 'electron-updater'
import { parseHTML } from 'linkedom'
import type { UpdateRelease } from '../shared/types/ipc'

export function isNewerVersion(candidate: string, current: string): boolean {
  if (!/^\d+\.\d+\.\d+$/.test(candidate) || !/^\d+\.\d+\.\d+$/.test(current)) return false
  const a = candidate.split('.').map(Number)
  const b = current.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i]
  }
  return false
}

export function updateRelease(info: UpdateInfo): UpdateRelease {
  const source = Array.isArray(info.releaseNotes)
    ? (info.releaseNotes.find((entry) => entry.version === info.version)?.note ?? '')
    : (info.releaseNotes ?? '')
  // GitHub's feed supplies HTML, while channel files may supply Markdown.
  // Only text crosses IPC: remote images, links and HTML never execute in the app.
  const { document } = parseHTML(`<html><body>${source.slice(0, 40000)}</body></html>`)
  for (const node of document.querySelectorAll('script, style, iframe, img')) node.remove()
  for (const node of document.querySelectorAll('br')) node.replaceWith('\n')
  for (const node of document.querySelectorAll('li')) node.prepend('• ')
  for (const node of document.querySelectorAll('p, div, li, h1, h2, h3, h4, pre')) {
    node.append('\n')
  }
  const notes = (document.body.textContent ?? '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^\n)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 20000)
  const date = Number.isNaN(Date.parse(info.releaseDate)) ? null : info.releaseDate
  return { version: info.version, date, notes }
}
