import { describe, expect, it } from 'vitest'
import type { FileNode } from './types'
import type { FlatFolder } from './treeOps'
import {
  canBrowseMoveFolder,
  canMoveToFolder,
  isInsidePath,
  moveFolderBreadcrumbs,
  parentFolderId,
  searchMoveFolders,
} from './moveDestination'

const file = { id: '/ws/notes/a.md', name: 'a.md', kind: 'md' } as FileNode
const folder = { id: '/ws/notes', name: 'notes', kind: 'folder' } as FileNode

describe('move destination helpers', () => {
  it('finds parents with either path separator', () => {
    expect(parentFolderId('/ws/notes/a.md')).toBe('/ws/notes')
    expect(parentFolderId('C:\\ws\\notes\\a.md')).toBe('C:\\ws\\notes')
    expect(parentFolderId('C:\\a.md')).toBe('C:\\')
  })

  it('uses path boundaries when detecting descendants', () => {
    expect(isInsidePath('/ws/notes/deep', '/ws/notes')).toBe(true)
    expect(isInsidePath('/ws/notes-old', '/ws/notes')).toBe(false)
  })

  it('excludes a folder and its descendants from browsing', () => {
    expect(canBrowseMoveFolder(folder, '/ws/notes')).toBe(false)
    expect(canBrowseMoveFolder(folder, '/ws/notes/deep')).toBe(false)
    expect(canBrowseMoveFolder(folder, '/ws/archive')).toBe(true)
    expect(canBrowseMoveFolder(file, '/ws/notes/deep')).toBe(true)
  })

  it('does not allow moving into the current parent', () => {
    expect(canMoveToFolder(file, '/ws/notes')).toBe(false)
    expect(canMoveToFolder(file, '/ws/archive')).toBe(true)
    expect(
      canMoveToFolder({ ...file, id: 'C:\\a.md' } as FileNode, 'C:\\'),
    ).toBe(false)
  })

  it('searches names and complete paths while excluding invalid targets', () => {
    const folders: FlatFolder[] = [
      { id: '/ws/notes', name: 'notes', path: 'notes' },
      { id: '/ws/archive', name: 'archive', path: 'archive' },
      { id: '/ws/archive/ideas', name: 'ideas', path: 'archive / ideas' },
    ]
    expect(searchMoveFolders(folders, file, 'archive ideas').map((item) => item.id)).toEqual([
      '/ws/archive/ideas',
    ])
    expect(searchMoveFolders(folders, file, 'notes')).toEqual([])
  })

  it('builds a workspace-rooted breadcrumb', () => {
    const entries: FlatFolder[] = [
      { id: '/ws', name: 'Workspace', path: 'Workspace' },
      { id: '/ws/a', name: 'a', path: 'a' },
      { id: '/ws/a/b', name: 'b', path: 'a / b' },
    ]
    const map = new Map(entries.map((entry) => [entry.id, entry]))
    expect(moveFolderBreadcrumbs('/ws/a/b', '/ws', map).map((entry) => entry.name)).toEqual([
      'Workspace',
      'a',
      'b',
    ])
  })
})
