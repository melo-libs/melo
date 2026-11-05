import { expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AgentChange, AgentConversation } from '../../../shared/types/agent'
import { ConversationStore } from './conversationStore'
import { AgentService } from '../agentService'
import { MemoryService } from './memory'

function applied(
  store: ConversationStore,
  conversation: AgentConversation,
  batchId: string,
  id: string,
  kind: 'move' | 'create-folder' = 'move',
) {
  const change: AgentChange = {
    id,
    batchId,
    kind,
    ...(kind === 'move' ? { source: `Inbox/${id}.pdf` } : {}),
    path: kind === 'move' ? `Filed/${id}.pdf` : `Filed/${id}`,
    undone: false,
  }
  store.writeChange(
    id,
    conversation.id,
    conversation.workspaceRoot,
    JSON.stringify({ ...change, state: 'applied' }),
    batchId,
  )
  store.save(conversation, [
    { id: `change:${id}`, role: 'tool', content: '', createdAt: Date.now(), change },
  ])
}

function serviceFor(store: ConversationStore, undo = vi.fn<(id: string) => Promise<void>>()) {
  return new AgentService(
    store,
    new MemoryService('/unused'),
    async () => ({ prompt: async () => {}, close: async () => {} }),
    () => {},
    new Set(),
    async (id, conversation, root) => {
      const record = JSON.parse(store.readChange(id, conversation, root))
      if (record.state === 'undone') return
      await undo(id)
      store.writeChange(
        id,
        conversation,
        root,
        JSON.stringify({ ...record, state: 'undone', undone: true }),
        record.batchId,
      )
    },
  )
}

it('upgrades an existing filing table and persists its recovery version across restarts', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'melo-filing-upgrade-'))
  const database = path.join(directory, 'history.db')
  const legacy = new Database(database)
  legacy.exec(`CREATE TABLE filing_batches (
    id TEXT PRIMARY KEY, conversationId TEXT NOT NULL, workspaceRoot TEXT NOT NULL,
    createdAt INTEGER NOT NULL, state TEXT NOT NULL, fileCount INTEGER NOT NULL
  )`)
  legacy
    .prepare('INSERT INTO filing_batches VALUES (?, ?, ?, ?, ?, ?)')
    .run('batch', 'owner', '/review', 1, 'applying', 1)
  legacy.close()
  let store = new ConversationStore(database)
  try {
    expect(store.filing('batch', 'owner', '/review')).toMatchObject({ state: 'failed', version: 1 })
    store.finishFiling('batch', 'completed')
    const version = store.filing('batch', 'owner', '/review').version
    store.close()
    store = new ConversationStore(database)
    expect(store.filing('batch', 'owner', '/review')).toMatchObject({ state: 'completed', version })
  } finally {
    store.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

it('hydrates the entire filing on every history page without changing pagination cursors', () => {
  const store = new ConversationStore(':memory:')
  try {
    const conversation = store.create('/review', 'claude')
    const batch = store.startFiling(conversation, 20)
    for (let index = 0; index < 80; index++)
      applied(store, conversation, batch, `change-${index}`, index < 60 ? 'create-folder' : 'move')
    store.finishFiling(batch, 'completed')
    const page = store.history()
    expect(page.messages).toHaveLength(60)
    expect(page.messages.filter((message) => message.filing)).toHaveLength(1)
    expect(page.messages.find((message) => message.filing)!.filing).toMatchObject({
      id: batch,
      state: 'completed',
      changes: expect.any(Array),
    })
    expect(page.messages.find((message) => message.filing)!.filing!.changes).toHaveLength(80)
    const older = store.history({ before: page.messages[0].sequence })
    expect(older.messages).toHaveLength(21)
    expect(older.messages.find((message) => message.filing)!.filing!.id).toBe(batch)
    expect(older.messages.at(-1)!.sequence).toBeLessThan(page.messages[0].sequence)
    expect(
      store.messages(conversation.id, 60).find((message) => message.filing)!.filing!.changes,
    ).toHaveLength(80)
  } finally {
    store.close()
  }
})

it('undoes exactly one persisted batch after question deletion, independently of visible messages', async () => {
  const store = new ConversationStore(':memory:')
  const undo = vi.fn<(id: string) => Promise<void>>(async () => {})
  try {
    const conversation = store.create('/review', 'claude')
    store.save(conversation, [
      {
        id: 'earlier-note',
        role: 'tool',
        content: '',
        createdAt: 1,
        change: { id: 'note', kind: 'edit', path: 'note.md', undone: false },
      },
      { id: 'question', role: 'user', content: 'Organize', createdAt: 2 },
    ])
    const first = store.startFiling(conversation, 20)
    for (let index = 0; index < 80; index++)
      applied(store, conversation, first, `first-${index}`, index < 60 ? 'create-folder' : 'move')
    store.finishFiling(first, 'completed')
    const second = store.startFiling(conversation, 1)
    applied(store, conversation, second, 'second-file')
    store.finishFiling(second, 'completed')
    store.deleteMessage('question')
    const beforeUndo = store.filing(first, conversation.id, '/review')
    const service = serviceFor(store, undo)
    await service.undoFiling(conversation.id, first)
    expect(store.filing(first, conversation.id, '/review').version).toBeGreaterThan(
      beforeUndo.version,
    )
    expect(undo.mock.calls.map(([id]) => id)).toEqual(
      Array.from({ length: 80 }, (_, index) => `first-${79 - index}`),
    )
    expect(
      store.filing(first, conversation.id, '/review').changes.every((change) => change.undone),
    ).toBe(true)
    expect(store.filing(second, conversation.id, '/review').changes[0].undone).toBe(false)
    expect(
      store.messages(conversation.id).find((message) => message.id === 'earlier-note')!.change!
        .undone,
    ).toBe(false)
    await expect(service.undo(conversation.id, ['second-file'])).rejects.toThrow(
      'AGENT_UNDO_UNAVAILABLE',
    )
    const other = store.create('/other', 'claude')
    await expect(service.undoFiling(other.id, second)).rejects.toThrow('AGENT_UNDO_UNAVAILABLE')
  } finally {
    store.close()
  }
})

it('retains partial undo progress and retries only the remaining changes', async () => {
  const store = new ConversationStore(':memory:')
  const undo = vi.fn<(id: string) => Promise<void>>(async () => {})
  try {
    const conversation = store.create('/review', 'claude')
    const batch = store.startFiling(conversation, 3)
    for (const id of ['a', 'b', 'c']) applied(store, conversation, batch, id)
    store.finishFiling(batch, 'completed')
    undo
      .mockImplementationOnce(async () => {})
      .mockRejectedValueOnce(new Error('AGENT_UNDO_CONFLICT'))
    const service = serviceFor(store, undo)
    await expect(service.undoFiling(conversation.id, batch)).rejects.toThrow('AGENT_UNDO_CONFLICT')
    expect(
      store.filing(batch, conversation.id, '/review').changes.map((change) => change.undone),
    ).toEqual([false, false, true])
    await service.undoFiling(conversation.id, batch)
    expect(undo.mock.calls.map(([id]) => id)).toEqual(['c', 'b', 'b', 'a'])
    expect(
      store.filing(batch, conversation.id, '/review').changes.map((change) => change.id),
    ).toEqual(['a', 'b', 'c'])
  } finally {
    store.close()
  }
})

it('recovers interrupted batches as failed while keeping prepared entries out of undo', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'melo-filing-batch-'))
  const database = path.join(directory, 'history.db')
  let store = new ConversationStore(database)
  try {
    const conversation = store.create('/review', 'claude')
    const batch = store.startFiling(conversation, 2)
    applied(store, conversation, batch, 'finished')
    store.writeChange(
      'interrupted',
      conversation.id,
      '/review',
      JSON.stringify({
        id: 'interrupted',
        kind: 'move',
        path: 'Filed/b.pdf',
        batchId: batch,
        undone: false,
        state: 'prepared',
      }),
      batch,
    )
    const beforeRestart = store.filing(batch, conversation.id, '/review').version
    store.close()
    store = new ConversationStore(database)
    const filing = store.messages(conversation.id).find((message) => message.filing)!.filing!
    expect(filing).toMatchObject({ id: batch, state: 'failed', fileCount: 2 })
    expect(filing.version).toBeGreaterThan(beforeRestart)
    expect(filing.changes.map((change) => change.id)).toEqual(['finished'])
    expect(filing.unresolved.map((change) => change.id)).toEqual(['interrupted'])
  } finally {
    store.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
