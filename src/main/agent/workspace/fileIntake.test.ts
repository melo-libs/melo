import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  realpath,
  symlink,
  readdir,
  stat,
} from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { FileIntake } from '../storage/fileIntake'
import { ConversationStore } from '../storage/conversationStore'
import { WorkspaceAccess } from './workspaceAccess'
import { ChangeJournal } from './changeJournal'
import { DocumentAccess } from './documentAccess'
import { MemoryService } from '../storage/memory'
import { AgentService } from '../agentService'
import type { AgentAttachment, AgentChange } from '../../../shared/types/agent'

it.each([false, true])(
  'executes agreed filing without another approval and keeps attachment identity through undo (backup cleanup failure: %s)',
  async (cleanupFails) => {
    const conversation = store.create(workspace, 'claude')
    const files: AgentAttachment[] = []
    for (const name of ['reservation.txt', 'unknown.bin']) {
      await writeFile(path.join(root, name), 'fixture')
      const draft = await intake.stageFile(workspace, path.join(root, name))
      files.push(await receive(conversation, draft.id))
    }
    const authorize = vi.fn(async () => false)
    const operations = access.operations({
      conversation,
      signal: new AbortController().signal,
      isActive: () => true,
      onEvent: (event) => {
        if (event.type === 'change') changes.push(event.change)
      },
      authorize,
    })
    const result = await operations.actions!.organize!({
      files: files.map((file) => ({
        id: file.id,
        destination: file.id === files[0].id ? 'Travel/杭州/Hotel.txt' : 'Filed/unknown.bin',
        reading: file.id === files[0].id ? ('read' as const) : ('unread' as const),
      })),
    })
    expect(authorize).not.toHaveBeenCalled()
    expect(result.files.map((file) => file.path)).toEqual([
      'Travel/杭州/Hotel.txt',
      'Inbox/unknown.bin',
    ])
    expect(intake.get(workspace, files[0].id).path).toBe('Travel/杭州/Hotel.txt')
    expect(await readFile(path.join(workspace, 'Travel/杭州/Hotel.txt'), 'utf8')).toBe('fixture')
    const move = changes.filter((change) => change.kind === 'move').at(-1)!
    expect(move.batchId).toBeTruthy()
    expect(changes.filter((change) => change.batchId === move.batchId)).toHaveLength(3)
    expect(
      changes.filter((change) => change.kind === 'import').every((change) => !change.batchId),
    ).toBe(true)
    expect(store.filing(move.batchId!, conversation.id, workspace)).toMatchObject({
      state: 'completed',
      fileCount: 1,
    })
    if (cleanupFails) {
      await mkdir(path.join(directory, 'change-backups', move.id), { recursive: true })
      await expect(access.undo(move.id, conversation.id, workspace)).rejects.toThrow(
        'AGENT_UNDO_BACKUP_CLEANUP_FAILED',
      )
    } else await access.undo(move.id, conversation.id, workspace)
    expect(intake.get(workspace, files[0].id).path).toBe('Inbox/reservation.txt')
  },
)

it.each(['../escape.txt', '.hidden/file.txt', 'Travel/note.pdf', 'Alias/file.txt'])(
  'rejects an invalid agreed destination before creating any folders: %s',
  async (destination) => {
    const conversation = store.create(workspace, 'claude')
    await writeFile(path.join(root, 'note.txt'), 'fixture')
    const draft = await intake.stageFile(workspace, path.join(root, 'note.txt'))
    await receive(conversation, draft.id)
    await symlink(root, path.join(workspace, 'Alias'))
    const operations = access.operations({
      conversation,
      signal: new AbortController().signal,
      isActive: () => true,
      onEvent: () => {},
      authorize: async () => false,
    })
    await expect(
      operations.actions!.organize!({
        files: [{ id: draft.id, destination, reading: 'read' }],
      }),
    ).rejects.toThrow()
    await expect(stat(path.join(workspace, 'Travel'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(path.join(workspace, 'Inbox/note.txt'), 'utf8')).toBe('fixture')
  },
)

it.each(['existing file', 'duplicate destination', 'file used as folder'])(
  'validates all agreed destinations before any move (%s)',
  async (conflict) => {
    const conversation = store.create(workspace, 'claude')
    const files: AgentAttachment[] = []
    for (const name of ['one.txt', 'two.txt']) {
      await writeFile(path.join(root, name), name)
      const draft = await intake.stageFile(workspace, path.join(root, name))
      files.push(await receive(conversation, draft.id))
    }
    await mkdir(path.join(workspace, 'Reference'))
    await writeFile(path.join(workspace, 'Reference/existing.txt'), 'keep this')
    const onEvent = vi.fn()
    const operations = access.operations({
      conversation,
      signal: new AbortController().signal,
      isActive: () => true,
      onEvent,
      authorize: async () => false,
    })
    await expect(
      operations.actions!.organize!({
        files: files.map((file, index) => ({
          id: file.id,
          reading: 'read',
          destination:
            index === 0
              ? 'Filed/one.txt'
              : conflict === 'existing file'
                ? 'Reference/existing.txt'
                : conflict === 'duplicate destination'
                  ? 'Filed/one.txt'
                  : 'Filed/one.txt/two.txt',
        })),
      }),
    ).rejects.toThrow()
    expect(onEvent).not.toHaveBeenCalled()
    await expect(stat(path.join(workspace, 'Filed'))).rejects.toMatchObject({ code: 'ENOENT' })
    for (const file of files)
      expect(await readFile(path.join(workspace, file.path!), 'utf8')).toBe(file.name)
    expect(await readFile(path.join(workspace, 'Reference/existing.txt'), 'utf8')).toBe('keep this')
  },
)

let root = '',
  workspace = '',
  directory = ''
let store: ConversationStore, intake: FileIntake, access: WorkspaceAccess, journal: ChangeJournal
let changes: AgentChange[]
vi.mock('../../api/indexer', () => ({ activeWorkspaceRoot: () => workspace, searchIndex: vi.fn() }))
vi.mock('../../api/fileOperations/fileOperations', async () => {
  const { rename, rm } = await import('node:fs/promises')
  return { renameFile: rename, trashFile: (file: string) => rm(file) }
})
beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'melo-intake-')))
  workspace = path.join(root, 'workspace')
  directory = path.join(root, 'agent')
  await mkdir(workspace)
  await mkdir(directory)
  store = new ConversationStore(path.join(directory, 'history.db'))
  intake = new FileIntake(path.join(directory, 'history.db'), directory)
  const documents = new DocumentAccess(() => null)
  vi.spyOn(documents, 'fileOperation').mockImplementation(async (_path, operation) => operation())
  journal = new ChangeJournal(store, documents, directory, intake)
  access = new WorkspaceAccess(
    documents,
    new MemoryService(directory),
    journal,
    () => ({ messages: [], total: 0 }),
    intake,
  )
  changes = []
})
afterEach(async () => {
  intake.close()
  store.close()
  vi.restoreAllMocks()
  await rm(root, { recursive: true, force: true })
})
const receive = async (conversation: ReturnType<ConversationStore['create']>, id: string) => {
  const file = await access.receiveAttachment(conversation, id, new AbortController().signal)
  changes.push({ id, kind: 'import', path: file.path!, undone: false })
  return file
}

it.each(['retry', 'restart', 'read'] as const)(
  'repairs an undo registry checkpoint through %s without repeating the file move',
  async (recovery) => {
    const conversation = store.create(workspace, 'claude')
    const source = path.join(root, 'sample.pdf')
    await writeFile(source, 'Original PDF bytes')
    const draft = await intake.stageFile(workspace, source)
    await receive(conversation, draft.id)
    let batchId = ''
    const operations = access.operations({
      conversation,
      signal: new AbortController().signal,
      isActive: () => true,
      onEvent: (event) => {
        if (event.type === 'filing') batchId = event.batchId
      },
      authorize: async () => true,
    })
    await operations.actions!.organize!({
      files: [
        {
          id: draft.id,
          destination: 'Filed/sample.pdf',
          reading: 'read',
        },
      ],
    })
    const service = new AgentService(
      store,
      new MemoryService(directory),
      async () => ({ prompt: async () => {}, close: async () => {} }),
      () => {},
      new Set(),
      (id, owner, root) => access.undo(id, owner, root),
    )
    vi.spyOn(intake, 'synchronize').mockImplementationOnce(() => {
      throw new Error('registry update failed')
    })
    await expect(service.undoFiling(conversation.id, batchId)).rejects.toThrow(
      'registry update failed',
    )
    expect(await readFile(path.join(workspace, 'Inbox/sample.pdf'), 'utf8')).toBe(
      'Original PDF bytes',
    )
    expect(store.pendingAttachmentChanges()).toHaveLength(1)
    expect(store.filing(batchId, conversation.id, workspace).changes.at(-1)?.undone).toBe(true)
    if (recovery === 'retry') await service.undoFiling(conversation.id, batchId)
    else if (recovery === 'read')
      expect((await operations.actions!.resolveAttachment!(draft.id)).path).toBe('Inbox/sample.pdf')
    else {
      intake.close()
      store.close()
      store = new ConversationStore(path.join(directory, 'history.db'))
      intake = new FileIntake(path.join(directory, 'history.db'), directory)
      journal = new ChangeJournal(store, new DocumentAccess(() => null), directory, intake)
    }
    expect(store.pendingAttachmentChanges()).toEqual([])
    const opened = await intake.openImported(workspace, draft.id)
    try {
      expect(opened.attachment.path).toBe('Inbox/sample.pdf')
      expect(await opened.file.readFile('utf8')).toBe('Original PDF bytes')
    } finally {
      await opened.file.close()
    }
  },
)

it('restores only the deleted attachment IDs when a filename has been reused', async () => {
  const conversation = store.create(workspace, 'claude')
  const source = path.join(root, 'same.pdf')
  const operations = access.operations({
    conversation,
    signal: new AbortController().signal,
    isActive: () => true,
    onEvent: (event) => {
      if (event.type === 'change') changes.push(event.change)
    },
    authorize: async () => true,
  })
  await writeFile(source, 'File A')
  const first = await intake.stageFile(workspace, source)
  await receive(conversation, first.id)
  await operations.actions!.trash('Inbox/same.pdf')
  await writeFile(source, 'File B')
  const second = await intake.stageFile(workspace, source)
  await receive(conversation, second.id)
  await operations.actions!.trash('Inbox/same.pdf')
  const deletion = changes.at(-1)!
  // Exact identities must survive a process restart; removed rows share this path.
  intake.close()
  store.close()
  store = new ConversationStore(path.join(directory, 'history.db'))
  intake = new FileIntake(path.join(directory, 'history.db'), directory)
  const documents = new DocumentAccess(() => null)
  journal = new ChangeJournal(store, documents, directory, intake)
  access = new WorkspaceAccess(
    documents,
    new MemoryService(directory),
    journal,
    () => ({ messages: [], total: 0 }),
    intake,
  )
  await access.undo(deletion.id, conversation.id, workspace)
  await expect(intake.openImported(workspace, first.id)).rejects.toThrow(
    'AGENT_ATTACHMENT_UNAVAILABLE',
  )
  const opened = await intake.openImported(workspace, second.id)
  try {
    expect(await opened.file.readFile('utf8')).toBe('File B')
  } finally {
    await opened.file.close()
  }
})

it('replays a registry sync idempotently when its journal acknowledgement fails', async () => {
  const conversation = store.create(workspace, 'claude')
  const source = path.join(root, 'sample.pdf')
  await writeFile(source, 'bytes')
  const draft = await intake.stageFile(workspace, source)
  await receive(conversation, draft.id)
  const writeChange = store.writeChange.bind(store)
  let failAcknowledgement = true
  vi.spyOn(store, 'writeChange').mockImplementation((...args) => {
    const record = JSON.parse(args[3])
    if (
      failAcknowledgement &&
      record.kind === 'trash' &&
      record.attachmentSync?.pending === false
    ) {
      failAcknowledgement = false
      throw new Error('sync acknowledgement failed')
    }
    writeChange(...args)
  })
  await expect(
    journal.apply(conversation, { kind: 'trash', path: 'Inbox/sample.pdf' }, () =>
      rm(path.join(workspace, 'Inbox/sample.pdf')),
    ),
  ).rejects.toThrow('sync acknowledgement failed')
  expect(store.pendingAttachmentChanges()).toHaveLength(1)
  journal.reconcileAttachments()
  expect(store.pendingAttachmentChanges()).toEqual([])
  expect(() => intake.get(workspace, draft.id)).toThrow('AGENT_ATTACHMENT_UNAVAILABLE')
})

it('keeps an immutable draft outside the workspace, survives restart, and imports the snapshot without overwriting a name conflict', async () => {
  const source = path.join(root, '预订单.pdf')
  await writeFile(source, 'original bytes')
  const file = await intake.stageFile(workspace, source)
  expect(await readdir(workspace)).toEqual([])
  await writeFile(source, 'later external version')
  intake.close()
  intake = new FileIntake(path.join(directory, 'history.db'), directory)
  expect(intake.drafts(workspace)).toEqual([file])
  const documents = new DocumentAccess(() => null)
  journal = new ChangeJournal(store, documents, directory, intake)
  access = new WorkspaceAccess(
    documents,
    new MemoryService(directory),
    journal,
    () => ({ messages: [], total: 0 }),
    intake,
  )
  await mkdir(path.join(workspace, 'Inbox'))
  await writeFile(path.join(workspace, 'Inbox', file.name), 'keep existing file')
  const conversation = store.create(workspace, 'claude')
  const imported = await receive(conversation, file.id)
  expect(imported.path).toBe('Inbox/预订单 (1).pdf')
  expect(await readFile(path.join(workspace, imported.path!), 'utf8')).toBe('original bytes')
  expect(await readFile(source, 'utf8')).toBe('later external version')
  expect(await readFile(path.join(workspace, 'Inbox', file.name), 'utf8')).toBe(
    'keep existing file',
  )
  expect(intake.drafts(workspace)).toEqual([])
  await receive(conversation, file.id)
  expect(await readdir(path.join(workspace, 'Inbox'))).toHaveLength(2)
})

it('resolves only imported attachment paths without reading their contents', async () => {
  const conversation = store.create(workspace, 'claude')
  const source = path.join(root, 'sample.pdf')
  await writeFile(source, 'This is not a PDF; resolution must not parse it.')
  const draft = await intake.stageFile(workspace, source)
  const operations = access.operations({
    conversation,
    signal: new AbortController().signal,
    isActive: () => true,
    onEvent: () => {},
    authorize: async () => false,
  })
  await expect(operations.actions!.resolveAttachment!(draft.id)).rejects.toThrow('UNAVAILABLE')
  const file = await receive(conversation, draft.id)
  expect(await operations.actions!.resolveAttachment!(file.id)).toEqual(file)
  expect(() => intake.get(path.join(root, 'other-workspace'), file.id)).toThrow('UNAVAILABLE')
})

it('leaves unread or unchanged files in place without producing an organized receipt', async () => {
  const conversation = store.create(workspace, 'claude')
  await writeFile(path.join(root, 'unknown.bin'), 'fixture')
  const draft = await intake.stageFile(workspace, path.join(root, 'unknown.bin'))
  const file = await receive(conversation, draft.id)
  const onEvent = vi.fn(),
    authorize = vi.fn(async () => false)
  const operations = access.operations({
    conversation,
    signal: new AbortController().signal,
    isActive: () => true,
    onEvent,
    authorize,
  })
  for (const reading of ['read', 'unread'] as const) {
    const result = await operations.actions!.organize!({
      files: [
        {
          id: file.id,
          destination: reading === 'read' ? file.path! : 'Filed/unknown.bin',
          reading,
        },
      ],
    })
    expect(result.files).toEqual([{ id: file.id, path: file.path }])
  }
  expect(onEvent).not.toHaveBeenCalled()
  expect(authorize).not.toHaveBeenCalled()
  expect(await readFile(path.join(workspace, file.path!), 'utf8')).toBe('fixture')
})

it.each([false, true])(
  'distinguishes user-described attachments from model-readable content (%s)',
  async (described) => {
    const conversation = store.create(workspace, 'claude')
    await writeFile(path.join(root, 'unknown.bin'), 'fixture')
    const draft = await intake.stageFile(workspace, path.join(root, 'unknown.bin'))
    await receive(conversation, draft.id)
    const operations = access.operations({
      conversation,
      signal: new AbortController().signal,
      isActive: () => true,
      onEvent: () => {},
      authorize: async () => false,
    })
    const result = await operations.actions!.organize!({
      files: [
        {
          id: draft.id,
          destination: 'Travel/booking.bin',
          reading: described ? 'user-described' : 'unread',
        },
      ],
    })
    expect(result.files[0].path).toBe(described ? 'Travel/booking.bin' : 'Inbox/unknown.bin')
  },
)

it('updates attachment locations through filing and undo, and preserves files when history is cleared', async () => {
  await writeFile(path.join(root, 'file.dat'), 'original')
  const file = await intake.stageFile(workspace, path.join(root, 'file.dat'))
  const conversation = store.create(workspace, 'claude')
  const imported = await receive(conversation, file.id)
  const operations = access.operations({
    conversation,
    signal: new AbortController().signal,
    isActive: () => true,
    onEvent: (event) => {
      if (event.type === 'change') changes.push(event.change)
    },
    authorize: async () => true,
  })
  await operations.actions!.create('Travel', '', true)
  await operations.actions!.move(imported.path!, 'Travel/booking.dat')
  expect(intake.get(workspace, file.id).path).toBe('Travel/booking.dat')
  await access.undo(changes.at(-1)!.id, conversation.id, workspace)
  expect(intake.get(workspace, file.id).path).toBe(imported.path)
  store.clearHistory()
  expect(await readFile(path.join(workspace, imported.path!), 'utf8')).toBe('original')
  expect(intake.get(workspace, file.id).path).toBe(imported.path)
})

it('refuses import undo after a newer edit and never deletes the external source', async () => {
  const source = path.join(root, 'a.txt')
  await writeFile(source, 'original')
  const file = await intake.stageFile(workspace, source)
  const conversation = store.create(workspace, 'claude')
  const imported = await receive(conversation, file.id)
  await writeFile(path.join(workspace, imported.path!), 'new user edit')
  await expect(access.undo(file.id, conversation.id, workspace)).rejects.toThrow('CONFLICT')
  expect(await readFile(source, 'utf8')).toBe('original')
  expect(await readFile(path.join(workspace, imported.path!), 'utf8')).toBe('new user edit')
})

it('recovers an import interrupted after publication using its recorded file identity', async () => {
  await writeFile(path.join(root, 'a.txt'), 'original')
  const file = await intake.stageFile(workspace, path.join(root, 'a.txt'))
  const conversation = store.create(workspace, 'claude')
  const writeChange = store.writeChange.bind(store)
  const fail = vi
    .spyOn(store, 'writeChange')
    .mockImplementation((id, conversationId, workspaceRoot, data) => {
      if (id === file.id && JSON.parse(data).state === 'applied')
        throw new Error('fixture storage failure')
      writeChange(id, conversationId, workspaceRoot, data)
    })
  await expect(receive(conversation, file.id)).rejects.toThrow('fixture storage failure')
  fail.mockRestore()
  const imported = await receive(conversation, file.id)
  expect(imported.path).toBe('Inbox/a.txt')
  expect(await readdir(path.join(workspace, 'Inbox'))).toEqual(['a.txt'])
  expect((await stat(path.join(workspace, imported.path!))).nlink).toBe(1)
  await access.undo(file.id, conversation.id, workspace)
  await expect(stat(path.join(workspace, imported.path!))).rejects.toMatchObject({ code: 'ENOENT' })
})

it('refuses an Inbox symlink and a cancelled import without losing the draft', async () => {
  await writeFile(path.join(root, 'a.txt'), 'original')
  const file = await intake.stageFile(workspace, path.join(root, 'a.txt'))
  await symlink(root, path.join(workspace, 'Inbox'))
  const conversation = store.create(workspace, 'claude')
  await expect(receive(conversation, file.id)).rejects.toThrow('INBOX_INVALID')
  await rm(path.join(workspace, 'Inbox'))
  const controller = new AbortController()
  controller.abort()
  await expect(access.receiveAttachment(conversation, file.id, controller.signal)).rejects.toThrow()
  expect(intake.drafts(workspace)).toEqual([file])
  expect(await readdir(workspace)).toEqual([])
})

it('serializes simultaneous pastes to enforce the draft limit and removes only discarded draft payloads', async () => {
  const results = await Promise.allSettled(
    Array.from({ length: 21 }, () => intake.stageImage(workspace, Buffer.from('fixture'))),
  )
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(20)
  expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
  const file = intake.drafts(workspace)[0]
  await intake.remove(workspace, file.id)
  expect(intake.drafts(workspace)).toHaveLength(19)
  await expect(stat(path.join(directory, 'intake', file.id))).rejects.toMatchObject({
    code: 'ENOENT',
  })
})

it.each(['symlink', 'directory'])(
  'rejects a %s substituted for an imported attachment',
  async (replacement) => {
    const conversation = store.create(workspace, 'claude')
    const source = path.join(root, 'outside.txt')
    await writeFile(source, 'fixture')
    const draft = await intake.stageFile(workspace, source)
    const file = await receive(conversation, draft.id)
    await rm(path.join(workspace, file.path!))
    if (replacement === 'symlink') await symlink(source, path.join(workspace, file.path!))
    else await mkdir(path.join(workspace, file.path!))
    const operations = access.operations({
      conversation,
      signal: new AbortController().signal,
      isActive: () => true,
      onEvent: () => {},
      authorize: async () => false,
    })
    await expect(operations.actions!.resolveAttachment!(file.id)).rejects.toThrow('UNAVAILABLE')
  },
)
