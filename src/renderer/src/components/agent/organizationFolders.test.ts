import { expect, it } from 'vitest'
import {
  folderPrefixes,
  organizationFolders,
  renamePlannedFolder,
  validOrganizationName,
} from './organizationFolders'

it('includes every new ancestor and drops unused draft folders when a file changes destination', () => {
  const existing = ['', 'Family', 'Family/Baby', 'Inbox']
  expect(organizationFolders(existing, ['Family/Baby/2026/Checkups/report.pdf', null])).toEqual([
    '',
    'Family',
    'Family/Baby',
    'Family/Baby/2026',
    'Family/Baby/2026/Checkups',
    'Inbox',
  ])
  expect(organizationFolders(existing, ['Inbox/report.pdf'])).toEqual(existing)
  expect(folderPrefixes('Family/Baby/2026')).toEqual(['Family', 'Family/Baby', 'Family/Baby/2026'])
})

it('renames the entire planned subtree without changing similarly named siblings or filenames', () => {
  const destinations = new Map([
    ['report', 'Family/Baby/2026/report.pdf'],
    ['photo', 'Family/Baby/photo.jpg'],
    ['sibling', 'Family/Baby photos/image.jpg'],
    ['unread', null],
  ])
  expect([...renamePlannedFolder(destinations, 'Family/Baby', 'Child')]).toEqual([
    ['report', 'Family/Child/2026/report.pdf'],
    ['photo', 'Family/Child/photo.jpg'],
    ['sibling', 'Family/Baby photos/image.jpg'],
    ['unread', null],
  ])
  expect(destinations.get('report')).toBe('Family/Baby/2026/report.pdf')
})

it.each(['', '   ', '.', '..', ' .hidden', 'a/b', 'a\\b', 'a\0b', 'a\nb'])(
  'rejects an invalid file or folder name: %j',
  (name) => expect(validOrganizationName(name)).toBe(false),
)

it('accepts visible names without treating punctuation or Unicode as paths', () => {
  expect(validOrganizationName(' 体检 (2026).v2 ')).toBe(true)
})
