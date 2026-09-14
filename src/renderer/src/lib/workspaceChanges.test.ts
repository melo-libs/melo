import { describe, expect, it } from 'vitest'
import type { FileNode as DiskNode, WorkspaceFilesystemChange } from '@shared/types/ipc'
import type { FileNode } from '../components/sidebar/types'
import { applyWorkspaceChanges, applyWorkspaceSources } from './workspace'

const root = '/notes'

const diskFile = (path: string, modifiedTime = 1): DiskNode => ({
  name: path.slice(path.lastIndexOf('/') + 1),
  path,
  type: 'text/markdown',
  isDirectory: false,
  size: 10,
  modifiedTime,
  createdTime: 1,
})

const diskFolder = (path: string, children?: DiskNode[]): DiskNode => ({
  name: path.slice(path.lastIndexOf('/') + 1),
  path,
  type: 'directory',
  isDirectory: true,
  children,
  size: 0,
  modifiedTime: 1,
  createdTime: 1,
})

const initialTree = (): FileNode[] => [
  {
    id: '/notes/Folder',
    name: 'Folder',
    kind: 'folder',
    children: [
      {
        id: '/notes/Folder/a.md',
        name: 'a.md',
        kind: 'md',
        size: 10,
        mtime: 1,
        btime: 1,
      },
    ],
  },
  { id: '/notes/keep.md', name: 'keep.md', kind: 'md', size: 10, mtime: 1, btime: 1 },
]

describe('applyWorkspaceChanges', () => {
  it('updates one node and its capture source without rebuilding siblings', () => {
    const before = initialTree()
    const changes: WorkspaceFilesystemChange[] = [
      { type: 'upsert', node: diskFile('/notes/Folder/a.md', 2) },
    ]
    const result = applyWorkspaceChanges(before, root, changes, {
      '/notes/Folder/a.md': { url: 'https://example.com/article' },
    })

    expect(result.complete).toBe(true)
    expect(result.tree[1]).toBe(before[1])
    expect(result.tree[0].children?.[0]).toMatchObject({
      id: '/notes/Folder/a.md',
      mtime: 2,
      source: { url: 'https://example.com/article', host: 'example.com' },
    })
  })

  it('removes a deleted node and inserts root and nested files', () => {
    const changes: WorkspaceFilesystemChange[] = [
      { type: 'remove', path: '/notes/Folder/a.md' },
      { type: 'upsert', node: diskFile('/notes/root.md') },
      { type: 'upsert', node: diskFile('/notes/Folder/new.md') },
    ]
    const result = applyWorkspaceChanges(initialTree(), root, changes, {})

    expect(result.complete).toBe(true)
    expect(result.tree.map((node) => node.id)).toContain('/notes/root.md')
    expect(result.tree[0].children?.map((node) => node.id)).toEqual(['/notes/Folder/new.md'])
  })

  it('uses a scanned new directory as authoritative and avoids duplicate descendants', () => {
    const child = diskFile('/notes/Imported/inside.md')
    const changes: WorkspaceFilesystemChange[] = [
      { type: 'upsert', node: diskFolder('/notes/Imported', [child]) },
      { type: 'upsert', node: child },
    ]
    const result = applyWorkspaceChanges(initialTree(), root, changes, {})
    const imported = result.tree.find((node) => node.id === '/notes/Imported')

    expect(result.complete).toBe(true)
    expect(imported?.children?.map((node) => node.id)).toEqual(['/notes/Imported/inside.md'])
  })

  it('requests a conservative reload when an event has an unknown parent', () => {
    const result = applyWorkspaceChanges(
      initialTree(),
      root,
      [{ type: 'upsert', node: diskFile('/notes/Missing/inside.md') }],
      {},
    )

    expect(result.complete).toBe(false)
  })
})

describe('applyWorkspaceSources', () => {
  it('hydrates the initial index result and removes stale source metadata', () => {
    const before = initialTree()
    before[1] = {
      ...before[1],
      source: { url: 'https://stale.example', host: 'stale.example' },
    }

    const result = applyWorkspaceSources(before, {
      '/notes/Folder/a.md': {
        url: 'https://example.com/article',
        capturedAt: '2026-08-09T00:00:00Z',
      },
    })

    expect(result[0].children?.[0].source).toEqual({
      url: 'https://example.com/article',
      host: 'example.com',
      capturedAt: '2026-08-09T00:00:00Z',
    })
    expect(result[1].source).toBeUndefined()
  })
})
