import { expect, it } from 'vitest'
import { agentFilePath, findAgentFile } from './agentFiles'
import type { FileNode } from '../sidebar/types'

it('decodes workspace citations without allowing paths outside the workspace', () => {
  expect(agentFilePath('./notes/Weekend%20plan.md#packing')).toBe('notes/Weekend plan.md')
  for (const href of [
    '../outside.md',
    '%2e%2e/outside.md',
    '/etc/passwd',
    '//example.com/a',
    'javascript:alert(1)',
    '.melo/memory.md',
    'notes\\outside.md',
    'broken%',
  ])
    expect(agentFilePath(href)).toBeNull()
})
it('opens only existing files from the current workspace tree', () => {
  const file = { id: '/notes/Travel/100% ready.md', name: '100% ready.md', kind: 'md' } as FileNode
  const tree: FileNode[] = [
    { id: '/notes/Travel', name: 'Travel', kind: 'folder', children: [file] },
  ]
  expect(findAgentFile(tree, '/notes', 'Travel/100% ready.md')).toBe(file)
  expect(findAgentFile(tree, '/notes', '../outside.md')).toBeUndefined()
  expect(findAgentFile(tree, '/notes', 'Travel')).toBeUndefined()
  expect(findAgentFile(tree, '/other', 'Travel/100% ready.md')).toBeUndefined()
})
