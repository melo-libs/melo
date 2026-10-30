import { createHash } from 'node:crypto'
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ConversationStore } from '../storage/conversationStore'
import { ChangeJournal } from './changeJournal'
import { DocumentAccess } from './documentAccess'

vi.mock('../../api/fileOperations/fileOperations', () => ({
  renameFile: async (from: string, to: string) => {
    try {
      await stat(to)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      await rename(from, to)
      return
    }
    throw new Error('Already exists')
  },
  trashFile: (file: string) => rm(file),
}))
const revision = (content: string) => createHash('sha256').update(content).digest('hex')
let root: string
let store: ConversationStore
let journal: ChangeJournal
let conversation: ReturnType<ConversationStore['create']>
let documents: DocumentAccess
beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'melo-journal-')))
  store = new ConversationStore(path.join(root, 'conversations.db'))
  conversation = store.create(root, 'claude')
  documents = new DocumentAccess(() => null)
  vi.spyOn(documents, 'read').mockImplementation(async (file) => {
    const content = await readFile(file, 'utf8')
    return { content, revision: revision(content) }
  })
  vi.spyOn(documents, 'edit').mockImplementation(async (file, expected, content) => {
    if (revision(await readFile(file, 'utf8')) !== expected) throw new Error('Revision changed')
    await writeFile(file, content)
    return { content, revision: revision(content) }
  })
  vi.spyOn(documents, 'fileOperation').mockImplementation(async (_file, operation) => operation())
  journal = new ChangeJournal(store, documents, root)
})
afterEach(async () => {
  store.close()
  await rm(root, { recursive: true, force: true })
})
it('reverses create, move, edit and trash in order, including after reopening storage', async () => {
  const folder = await journal.apply(
    conversation,
    { kind: 'create-folder', path: 'Reference' },
    () => mkdir(path.join(root, 'Reference')),
  )
  const note = await journal.apply(conversation, { kind: 'create-note', path: 'note.md' }, () =>
    writeFile(path.join(root, 'note.md'), 'Original'),
  )
  const moved = await journal.apply(
    conversation,
    { kind: 'move', source: 'note.md', path: 'Reference/note.md' },
    () => rename(path.join(root, 'note.md'), path.join(root, 'Reference/note.md')),
  )
  const file = path.join(root, 'Reference/note.md')
  const before = await documents.read(file)
  const edited = await journal.apply(
    conversation,
    { kind: 'edit', path: 'Reference/note.md' },
    () => documents.edit(file, before.revision, 'Updated'),
    before,
    (result) => result.revision,
  )
  const trashed = await journal.apply(
    conversation,
    { kind: 'trash', path: 'Reference/note.md' },
    () => rm(file),
  )
  store.close()
  store = new ConversationStore(path.join(root, 'conversations.db'))
  journal = new ChangeJournal(store, documents, root)
  for (const applied of [trashed, edited, moved, note, folder])
    await journal.undo(applied.change.id, conversation.id, root)
  await expect(stat(path.join(root, 'note.md'))).rejects.toMatchObject({ code: 'ENOENT' })
  await expect(stat(path.join(root, 'Reference'))).rejects.toMatchObject({ code: 'ENOENT' })
})
it('preserves subsequent edits and new files when undo conflicts', async () => {
  const file = path.join(root, 'note.md')
  const created = await journal.apply(conversation, { kind: 'create-note', path: 'note.md' }, () =>
    writeFile(file, 'Original'),
  )
  await writeFile(file, 'User changes')
  await expect(journal.undo(created.change.id, conversation.id, root)).rejects.toThrow(
    'AGENT_UNDO_CONFLICT',
  )
  expect(await readFile(file, 'utf8')).toBe('User changes')
  const trashed = await journal.apply(conversation, { kind: 'trash', path: 'note.md' }, () =>
    rm(file),
  )
  await writeFile(file, 'New file')
  await expect(journal.undo(trashed.change.id, conversation.id, root)).rejects.toThrow(
    'AGENT_UNDO_CONFLICT',
  )
  expect(await readFile(file, 'utf8')).toBe('New file')
})
it('refuses symlink substitution and cross-conversation undo', async () => {
  const file = path.join(root, 'note.md')
  const created = await journal.apply(conversation, { kind: 'create-note', path: 'note.md' }, () =>
    writeFile(file, 'Original'),
  )
  await writeFile(path.join(root, 'other.md'), 'Outside')
  await rm(file)
  await symlink(path.join(root, 'other.md'), file)
  await expect(journal.undo(created.change.id, conversation.id, root)).rejects.toThrow(
    'symbolic links',
  )
  await expect(journal.undo(created.change.id, 'other-conversation', root)).rejects.toThrow(
    'AGENT_UNDO_UNAVAILABLE',
  )
})
it('never removes a nonempty folder during undo', async () => {
  const created = await journal.apply(
    conversation,
    { kind: 'create-folder', path: 'Reference' },
    () => mkdir(path.join(root, 'Reference')),
  )
  await writeFile(path.join(root, 'Reference/user.md'), 'Keep')
  await expect(journal.undo(created.change.id, conversation.id, root)).rejects.toThrow(
    'AGENT_UNDO_CONFLICT',
  )
})
