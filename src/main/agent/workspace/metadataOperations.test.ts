import { createHash } from 'node:crypto'
import { mkdtemp, writeFile, readFile, rm, realpath, mkdir } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { openIndex, closeIndex, indexFile, querySmartRulesPage } from '../../api/indexer'
import { readSmartViewsSnapshot, updateSmartViews } from '../../api/smartViews'
import { WorkspaceAccess } from './workspaceAccess'
import { DocumentAccess } from './documentAccess'
import { ChangeJournal } from './changeJournal'
import { ConversationStore } from '../storage/conversationStore'
import { MemoryService } from '../storage/memory'
import type { RuntimeEvent, RuntimeRequest } from '../agentTypes'
vi.mock('../../api/fileOperations/fileOperations', () => ({
  renameFile: vi.fn(),
  trashFile: vi.fn(),
}))
const hash = (text: string) => createHash('sha256').update(text).digest('hex')
let root: string, store: ConversationStore, access: WorkspaceAccess, request: RuntimeRequest
let documents: DocumentAccess
let events: RuntimeEvent[]
beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'melo-metadata-')))
  openIndex(root)
  store = new ConversationStore(path.join(root, 'history.db'))
  documents = new DocumentAccess(() => null)
  vi.spyOn(documents, 'read').mockImplementation(async (file) => {
    const content = await readFile(file, 'utf8')
    return { content, revision: hash(content) }
  })
  vi.spyOn(documents, 'edit').mockImplementation(async (file, revision, content) => {
    if (hash(await readFile(file, 'utf8')) !== revision) throw new Error('Document changed')
    await writeFile(file, content)
    indexFile(file)
    return { content, revision: hash(content) }
  })
  access = new WorkspaceAccess(
    documents,
    new MemoryService(root),
    new ChangeJournal(store, documents, root),
    () => ({ messages: [], total: 0 }),
  )
  events = []
  request = {
    conversation: store.create(root, 'claude'),
    signal: new AbortController().signal,
    isActive: () => true,
    authorize: async () => true,
    onEvent: (event) => events.push(event),
  }
})
afterEach(async () => {
  store.close()
  closeIndex()
  await rm(root, { recursive: true, force: true })
})
it('updates searchable note tags, restores exact bytes on undo and rejects later edits', async () => {
  const file = path.join(root, 'note.md'),
    original = '---\ntitle: Keep\ntags: [old]\n---\nBody'
  await writeFile(file, original)
  indexFile(file)
  const actions = access.operations(request).actions!
  const read = await actions.readTags!('note.md')
  await actions.updateTags!('note.md', read.revision!, ['#Work'], ['old'])
  expect(querySmartRulesPage([{ key: 'Tag', op: 'is', val: 'work' }], 10).total).toBe(1)
  const change = events.findLast((event) => event.type === 'change')!
  if (change.type !== 'change') throw new Error('No change')
  expect(change.change.kind).toBe('tags')
  await access.undo(change.change.id, request.conversation.id, root)
  expect(await readFile(file, 'utf8')).toBe(original)
  expect(querySmartRulesPage([{ key: 'Tag', op: 'is', val: 'work' }], 10).total).toBe(0)
  await actions.updateTags!('note.md', read.revision!, ['work'], [])
  const next = events.findLast((event) => event.type === 'change')!
  await writeFile(file, original + '\nNewer edit')
  if (next.type === 'change')
    await expect(access.undo(next.change.id, request.conversation.id, root)).rejects.toThrow()
  expect(await readFile(file, 'utf8')).toContain('Newer edit')
})
it('previews with the existing index and saves/undoes Smart Folders after restarting the journal', async () => {
  await mkdir(path.join(root, 'Travel'))
  await writeFile(path.join(root, 'Travel/ticket.pdf'), 'PDF')
  indexFile(path.join(root, 'Travel/ticket.pdf'))
  const actions = access.operations(request).actions!
  const current = await actions.readSmartFolders!()
  const view = {
    id: 'travel',
    name: 'Travel PDFs',
    glyph: 'pdf',
    rules: [
      { key: 'Kind' as const, op: 'is', val: 'PDF' },
      { key: 'Folder' as const, op: 'is', val: 'Travel' },
    ],
  }
  expect((await actions.previewSmartFolder!(view.rules)).total).toBe(1)
  await actions.saveSmartFolder!(view, current.revision)
  expect(readSmartViewsSnapshot(root).views.at(-1)).toMatchObject(view)
  const changed = events.findLast((event) => event.type === 'change')!
  const journal = new ChangeJournal(store, documents, root)
  if (changed.type === 'change')
    await journal.undo(changed.change.id, request.conversation.id, root)
  expect(readSmartViewsSnapshot(root).views).toEqual(current.views)
  expect(await readFile(path.join(root, 'Travel/ticket.pdf'), 'utf8')).toBe('PDF')
})
it('rejects approval-time changes and undo over newer Smart Folder edits', async () => {
  const actions = access.operations(request).actions!
  const before = await actions.readSmartFolders!()
  const view = { id: 'notes', name: 'Notes', glyph: 'doc', rules: [] }
  request.authorize = async () => {
    updateSmartViews(
      root,
      [...before.views, { ...view, id: 'manual', name: 'Manual' }],
      before.revision,
    )
    return true
  }
  await expect(actions.saveSmartFolder!(view, before.revision)).rejects.toThrow(
    'SMART_VIEWS_CONFLICT',
  )
  request.authorize = async () => true
  await actions.saveSmartFolder!(view, readSmartViewsSnapshot(root).revision)
  const change = events.findLast((event) => event.type === 'change')!
  const latest = readSmartViewsSnapshot(root)
  updateSmartViews(root, [...latest.views, { ...view, id: 'new', name: 'New' }], latest.revision)
  if (change.type === 'change')
    await expect(access.undo(change.change.id, request.conversation.id, root)).rejects.toThrow(
      'AGENT_UNDO_CONFLICT',
    )
})
it('declines changes without creating a journal entry and rejects non-Markdown tags', async () => {
  const actions = access.operations(request).actions!
  request.authorize = async () => false
  await expect(
    actions.saveSmartFolder!(
      { id: 'n', name: 'N', glyph: 'doc', rules: [] },
      readSmartViewsSnapshot(root).revision,
    ),
  ).rejects.toThrow('declined')
  await expect(actions.readTags!('file.pdf')).rejects.toThrow('Markdown')
  expect(events).toEqual([])
})
