import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AgentService } from '../agentService'
import { ConversationStore } from '../storage/conversationStore'
import { MemoryService } from '../storage/memory'
import { ChangeJournal } from './changeJournal'
import type { WorkspaceDocumentAccess } from './workspaceTypes'

vi.mock('node:fs/promises', async (original) => {
  const fs = await original<typeof import('node:fs/promises')>()
  return { ...fs, rm: vi.fn(fs.rm) }
})
vi.mock('../../api/fileOperations/fileOperations', () => ({
  renameFile: (from: string, to: string) => rename(from, to),
  trashFile: (file: string) => rm(file),
}))
const revision = (content: string) => createHash('sha256').update(content).digest('hex')
let directory: string, root: string, store: ConversationStore, journal: ChangeJournal
let documents: WorkspaceDocumentAccess, conversation: ReturnType<ConversationStore['create']>
let service: AgentService
beforeEach(async () => {
  directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'melo-filing-recovery-')))
  root = path.join(directory, 'workspace')
  await mkdir(path.join(root, 'Inbox'), { recursive: true })
  await mkdir(path.join(root, 'Filed'))
  store = new ConversationStore(':memory:')
  conversation = store.create(root, 'claude')
  documents = {
    read: async (file) => {
      const content = await readFile(file, 'utf8')
      return { content, revision: revision(content) }
    },
    edit: vi.fn(async (file, expected, content) => {
      if (revision(await readFile(file, 'utf8')) !== expected) throw new Error('Revision changed')
      await writeFile(file, content)
      return { content, revision: revision(content) }
    }),
    fileOperation: async (_file, operation) => operation(),
  }
  journal = new ChangeJournal(store, documents, directory)
  service = new AgentService(
    store,
    new MemoryService(directory),
    async () => ({ prompt: async () => {}, close: async () => {} }),
    () => {},
    new Set(),
    async (id, owner, workspace) => {
      await journal.undo(id, owner, workspace)
    },
  )
})
afterEach(async () => {
  vi.restoreAllMocks()
  store.close()
  await rm(directory, { recursive: true, force: true })
})

it('retains an uncheckpointed move as unresolved after undoing confirmed changes', async () => {
  for (const name of ['a.pdf', 'b.pdf']) await writeFile(path.join(root, 'Inbox', name), name)
  const writeChange = store.writeChange.bind(store)
  let failCheckpoint = true
  vi.spyOn(store, 'writeChange').mockImplementation((id, owner, workspace, data, batch) => {
    const record = JSON.parse(data)
    if (failCheckpoint && record.path === 'Filed/b.pdf' && record.state === 'applied') {
      failCheckpoint = false
      throw new Error('applied checkpoint failed')
    }
    writeChange(id, owner, workspace, data, batch)
  })
  let batchId = ''
  await expect(
    journal.filing(
      conversation,
      2,
      (id) => {
        batchId = id
      },
      async (id) => {
        for (const name of ['a.pdf', 'b.pdf'])
          await documents.fileOperation(path.join(root, 'Inbox', name), () =>
            journal.apply(
              conversation,
              { kind: 'move', source: `Inbox/${name}`, path: `Filed/${name}`, batchId: id },
              () => rename(path.join(root, 'Inbox', name), path.join(root, 'Filed', name)),
            ),
          )
      },
    ),
  ).rejects.toThrow('applied checkpoint failed')
  const result = await service.undoFiling(conversation.id, batchId)
  const filing = result.messages.find((message) => message.filing)!.filing!
  expect(filing.changes.every((change) => change.undone)).toBe(true)
  expect(filing.unresolved.map((change) => change.path)).toEqual(['Filed/b.pdf'])
  expect(await stat(path.join(root, 'Inbox/a.pdf'))).toBeTruthy()
  expect(await readFile(path.join(root, 'Filed/b.pdf'), 'utf8')).toBe('b.pdf')
  await expect(stat(path.join(root, 'Inbox/b.pdf'))).rejects.toMatchObject({ code: 'ENOENT' })
})

it('publishes the committed inverse when backup cleanup fails, including on retry', async () => {
  const file = path.join(root, 'note.md')
  await writeFile(file, 'Original')
  let batchId = ''
  await journal.filing(
    conversation,
    0,
    (id) => {
      batchId = id
    },
    async (id) => {
      const before = await documents.read(file)
      await journal.apply(
        conversation,
        { kind: 'edit', path: 'note.md', batchId: id },
        () => documents.edit(file, before.revision, 'Updated'),
        before,
        (snapshot) => snapshot.revision,
      )
    },
  )
  service.open(conversation.id)
  vi.mocked(rm).mockRejectedValueOnce(new Error('backup cleanup failed'))
  await expect(service.undoFiling(conversation.id, batchId)).rejects.toThrow(
    'AGENT_UNDO_BACKUP_CLEANUP_FAILED',
  )
  expect(await readFile(file, 'utf8')).toBe('Original')
  expect(
    service.open(conversation.id).messages.find((message) => message.filing)!.filing!.changes[0]
      .undone,
  ).toBe(true)
  const retried = await service.undoFiling(conversation.id, batchId)
  expect(retried.messages.find((message) => message.filing)!.filing!.changes[0].undone).toBe(true)
  expect(documents.edit).toHaveBeenCalledTimes(2)
})

it('refreshes an old live snapshot when every journal entry is already undone', async () => {
  const batchId = store.startFiling(conversation, 1)
  const change = {
    id: randomUUID(),
    kind: 'move',
    source: 'Inbox/a.pdf',
    path: 'Filed/a.pdf',
    batchId,
    undone: false,
    state: 'applied',
  }
  store.writeChange(change.id, conversation.id, root, JSON.stringify(change), batchId)
  store.finishFiling(batchId, 'completed')
  service.open(conversation.id)
  store.writeChange(
    change.id,
    conversation.id,
    root,
    JSON.stringify({ ...change, undone: true, state: 'undone' }),
    batchId,
  )
  const result = await service.undoFiling(conversation.id, batchId)
  expect(result.messages.find((message) => message.filing)!.filing!.changes[0].undone).toBe(true)
})
