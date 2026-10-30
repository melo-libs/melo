import { mkdtemp, mkdir, realpath, rm, symlink, writeFile, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, it, vi } from 'vitest'
import { WorkspaceAccess } from './workspaceAccess'
import { DocumentAccess } from './documentAccess'
import { ConversationStore } from '../storage/conversationStore'
import { ChangeJournal } from './changeJournal'
import { MemoryService } from '../storage/memory'
import type { RuntimeEvent, RuntimeRequest } from '../agentTypes'

let workspace = ''
vi.mock('../../api/indexer', () => ({ activeWorkspaceRoot: () => workspace, searchIndex: vi.fn() }))
vi.mock('../../api/fileOperations/fileOperations', async () => {
  const { rename } = await import('node:fs/promises')
  return { renameFile: rename, trashFile: vi.fn() }
})

it('records canonical paths for alias-based creates and moves so they remain undoable', async () => {
  workspace = await realpath(await mkdtemp(path.join(os.tmpdir(), 'melo-access-')))
  const store = new ConversationStore(path.join(workspace, 'history.db'))
  const documents = new DocumentAccess(() => null)
  vi.spyOn(documents, 'fileOperation').mockImplementation(async (_file, operation) => operation())
  const journal = new ChangeJournal(store, documents, workspace)
  const access = new WorkspaceAccess(documents, new MemoryService(workspace), journal, (query) =>
    store.searchHistory(query),
  )
  const events: RuntimeEvent[] = []
  const operations = access.operations({
    signal: new AbortController().signal,
    isActive: () => true,
    conversation: store.create(workspace, 'claude'),
    onEvent: (event) => events.push(event),
    authorize: async () => true,
  })
  try {
    await mkdir(path.join(workspace, 'Real'))
    await symlink(path.join(workspace, 'Real'), path.join(workspace, 'Alias'))
    await writeFile(path.join(workspace, 'Real/note.md'), 'Keep this content')
    await operations.actions!.create('Alias/Reference', '', true)
    await operations.actions!.move('Alias/note.md', 'Alias/Reference/note.md')
    const changes = events.flatMap((event) => (event.type === 'change' ? [event.change] : []))
    expect(changes.map((change) => [change.path, change.source])).toEqual([
      ['Real/Reference', undefined],
      ['Real/Reference/note.md', 'Real/note.md'],
    ])
    const conversation = store.list(workspace)[0]
    for (const change of changes.reverse()) await access.undo(change.id, conversation.id, workspace)
    expect(await readFile(path.join(workspace, 'Real/note.md'), 'utf8')).toBe('Keep this content')
  } finally {
    store.close()
    await rm(workspace, { recursive: true, force: true })
  }
})

it('shows a diff before approval and rejects a document changed during review', async () => {
  workspace = await realpath(await mkdtemp(path.join(os.tmpdir(), 'melo-edit-review-')))
  await writeFile(path.join(workspace, 'note.md'), 'Before')
  const store = new ConversationStore(path.join(workspace, 'history.db'))
  const documents = new DocumentAccess(() => null)
  let revision = 'original'
  vi.spyOn(documents, 'read').mockImplementation(async () => ({ content: 'Before', revision }))
  const edit = vi.spyOn(documents, 'edit')
  const authorize = vi.fn<RuntimeRequest['authorize']>(async () => {
    revision = 'changed-during-review'
    return true
  })
  const journal = new ChangeJournal(store, documents, workspace)
  const operations = new WorkspaceAccess(documents, new MemoryService(workspace), journal, () => ({
    messages: [],
    total: 0,
  })).operations({
    signal: new AbortController().signal,
    isActive: () => true,
    conversation: store.create(workspace, 'codex'),
    onEvent: () => {},
    authorize,
  })
  try {
    await expect(operations.documents.edit('note.md', 'original', 'After')).rejects.toThrow(
      'read again',
    )
    expect(edit).not.toHaveBeenCalled()
    const call = authorize.mock.calls[0]
    expect(call[0]).toMatchObject({ kind: 'edit', path: 'note.md' })
    expect(call[0].kind === 'edit' && call[0].diff).toContain('-Before')
    expect(call[0].kind === 'edit' && call[0].diff).toContain('+After')
  } finally {
    store.close()
    await rm(workspace, { recursive: true, force: true })
  }
})

it.each([
  '../outside.md',
  'linked.md',
  '.melo/memory.md',
  '/tmp/outside.md',
  'note.txt',
  'hidden-alias.md',
  'plain-alias.md',
  'directory.md',
])('rejects unsafe or unsupported document path %s without a transport', async (relative) => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'melo-path-boundary-')))
  workspace = path.join(root, 'workspace')
  await mkdir(path.join(workspace, '.private'), { recursive: true })
  await writeFile(path.join(root, 'outside.md'), 'Private')
  await symlink(path.join(root, 'outside.md'), path.join(workspace, 'linked.md'))
  await writeFile(path.join(workspace, '.private/secret.md'), 'Private')
  await symlink(path.join(workspace, '.private/secret.md'), path.join(workspace, 'hidden-alias.md'))
  await writeFile(path.join(workspace, 'plain.txt'), 'Unsupported')
  await symlink(path.join(workspace, 'plain.txt'), path.join(workspace, 'plain-alias.md'))
  await mkdir(path.join(workspace, 'directory.md'))
  const store = new ConversationStore(path.join(root, 'history.db'))
  const documents = new DocumentAccess(() => null)
  const read = vi.spyOn(documents, 'read')
  const access = new WorkspaceAccess(
    documents,
    new MemoryService(root),
    new ChangeJournal(store, documents, root),
    () => ({ messages: [], total: 0 }),
  )
  const operations = access.operations({
    signal: new AbortController().signal,
    isActive: () => true,
    conversation: store.create(workspace, 'claude'),
    onEvent: () => {},
    authorize: async () => true,
  })
  try {
    await expect(operations.documents.read(relative)).rejects.toThrow()
    expect(read).not.toHaveBeenCalled()
  } finally {
    store.close()
    await rm(root, { recursive: true, force: true })
  }
})

it('refuses a cancelled request immediately before mutation while its turn is still active', async () => {
  workspace = await realpath(await mkdtemp(path.join(os.tmpdir(), 'melo-call-cancel-')))
  await writeFile(path.join(workspace, 'note.md'), 'Before')
  const store = new ConversationStore(path.join(workspace, 'history.db'))
  const documents = new DocumentAccess(() => null)
  const controller = new AbortController()
  const edit = vi.spyOn(documents, 'edit')
  vi.spyOn(documents, 'read')
    .mockResolvedValueOnce({ content: 'Before', revision: 'r1' })
    .mockImplementationOnce(async () => {
      controller.abort(new Error('Tool request cancelled'))
      return { content: 'Before', revision: 'r1' }
    })
  const authorize = vi.fn<RuntimeRequest['authorize']>(async () => true)
  const operations = new WorkspaceAccess(
    documents,
    new MemoryService(workspace),
    new ChangeJournal(store, documents, workspace),
    () => ({ messages: [], total: 0 }),
  ).operations(
    {
      signal: new AbortController().signal,
      isActive: () => true,
      conversation: store.create(workspace, 'claude'),
      onEvent: () => {},
      authorize,
    },
    controller.signal,
  )
  try {
    await expect(operations.documents.edit('note.md', 'r1', 'After')).rejects.toThrow(
      'Tool request cancelled',
    )
    expect(authorize.mock.calls[0][1]).toBe(controller.signal)
    expect(edit).not.toHaveBeenCalled()
    expect(await readFile(path.join(workspace, 'note.md'), 'utf8')).toBe('Before')
  } finally {
    store.close()
    await rm(workspace, { recursive: true, force: true })
  }
})
