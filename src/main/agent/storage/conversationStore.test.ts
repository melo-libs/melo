import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { expect, it } from 'vitest'
import { ConversationStore } from './conversationStore'

it('migrates existing conversations and preserves each question’s quoted context', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'melo-conversation-'))
  const file = path.join(directory, 'history.db')
  const legacy = new Database(file)
  legacy.exec(`CREATE TABLE conversations (id TEXT PRIMARY KEY, title TEXT NOT NULL, workspaceRoot TEXT NOT NULL, provider TEXT NOT NULL, updatedAt INTEGER NOT NULL);
    CREATE TABLE messages (conversationId TEXT NOT NULL, id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, toolStatus TEXT, createdAt INTEGER NOT NULL, PRIMARY KEY(conversationId,id));
    INSERT INTO conversations VALUES ('old', 'An older conversation', '/notes', 'claude', 1);
    INSERT INTO messages VALUES ('old', 'question', 'user', 'First question', NULL, 1);`)
  legacy.close()
  let store = new ConversationStore(file)
  try {
    expect(store.messages('old')[0]).toMatchObject({
      content: 'First question',
      context: undefined,
    })
    const conversation = store.create('/notes', 'claude')
    const context = { filePath: 'notes/Ideas.md', selection: 'Two ways to view the same files.' }
    store.save(conversation, [
      { id: 'quoted', role: 'user', content: 'What does this mean?', context, createdAt: 2 },
    ])
    store.close()
    store = new ConversationStore(file)
    expect(store.messages(conversation.id)[0].context).toEqual(context)
    expect(store.messages('old')[0].content).toBe('First question')
  } finally {
    store.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

it('pages one timeline across existing conversations and locates older search results', () => {
  const store = new ConversationStore(':memory:')
  try {
    const a = store.create('/notes-a', 'claude'),
      b = store.create('/notes-b', 'codex')
    const seed = (conversation: typeof a, start: number, count: number) =>
      store.save(
        conversation,
        Array.from({ length: count }, (_, index) => ({
          id: `message-${start + index}`,
          role: 'user' as const,
          content: `Message ${start + index}`,
          context: { filePath: `note-${start + index}.md` },
          createdAt: start + index,
        })),
      )
    seed(a, 0, 70)
    seed(b, 70, 70)
    const tail = store.history()
    expect(tail.messages).toHaveLength(60)
    expect(tail.hasOlder).toBe(true)
    expect(tail.messages.at(-1)?.workspaceRoot).toBe('/notes-b')
    const older = store.history({ before: tail.messages[0].sequence })
    expect(older.messages).toHaveLength(60)
    expect(older.messages.at(-1)!.sequence).toBeLessThan(tail.messages[0].sequence)
    const around = store.history({ around: 'message-32' })
    expect(around.messages.some((message) => message.id === 'message-32')).toBe(true)
    expect(around.hasOlder).toBe(true)
    expect(around.hasNewer).toBe(true)
    expect(store.searchHistory('Message 32').messages[0].context?.filePath).toBe('note-32.md')
  } finally {
    store.close()
  }
})

it('indexes English and Chinese history and removes deleted messages from recall', () => {
  const store = new ConversationStore(':memory:')
  try {
    const conversation = store.create('/notes', 'claude')
    store.save(conversation, [
      { id: 'question', role: 'user', content: 'What is Distill? 怎样提炼？', createdAt: 1 },
      { id: 'answer', role: 'assistant', content: 'Distill means 提炼。', createdAt: 2 },
    ])
    expect(store.searchHistory('distill').total).toBe(2)
    expect(store.searchHistory('提炼').total).toBe(2)
    expect(() => store.searchHistory('" OR *')).not.toThrow()
    store.deleteMessage('answer')
    expect(store.searchHistory('distill').total).toBe(1)
    expect(() => store.history({ around: 'answer' })).toThrow('AGENT_MESSAGE_UNAVAILABLE')
    store.clearHistory()
    expect(store.history().messages).toEqual([])
    expect(store.searchHistory('Distill').total).toBe(0)
  } finally {
    store.close()
  }
})

it('continues older search matches and searches short Unicode queries', () => {
  const store = new ConversationStore(':memory:')
  try {
    const conversation = store.create('/notes', 'claude')
    store.save(
      conversation,
      Array.from({ length: 85 }, (_, i) => ({
        id: `search-${i}`,
        role: 'user' as const,
        content: `Travel 📚书 😀😀 ${i}`,
        createdAt: i,
      })),
    )
    const first = store.searchHistory('Travel')
    const second = store.searchHistory('Travel', first.messages.at(-1)!.sequence)
    const third = store.searchHistory('Travel', second.messages.at(-1)!.sequence)
    expect([first.messages.length, second.messages.length, third.messages.length]).toEqual([
      40, 40, 5,
    ])
    expect(
      new Set(
        [...first.messages, ...second.messages, ...third.messages].map((message) => message.id),
      ).size,
    ).toBe(85)
    expect(store.searchHistory('📚书').total).toBe(85)
    expect(store.searchHistory('😀😀').total).toBe(85)
  } finally {
    store.close()
  }
})

it('persists interrupted tool and approval recovery for the complete timeline on restart', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'melo-history-recovery-'))
  const file = path.join(directory, 'history.db')
  let store = new ConversationStore(file)
  try {
    const conversation = store.create('/notes', 'claude')
    store.save(conversation, [
      {
        id: 'interrupted-tool',
        role: 'tool',
        content: 'melo_read_document',
        toolStatus: 'pending',
        createdAt: 1,
      },
      {
        id: 'finished-tool',
        role: 'tool',
        content: 'melo_search',
        toolStatus: 'completed',
        createdAt: 2,
      },
      ...Array.from({ length: 80 }, (_, index) => ({
        id: `later-${index}`,
        role: 'user' as const,
        content: 'Later',
        createdAt: index + 3,
      })),
      {
        id: 'approval:interrupted',
        role: 'tool',
        content: '',
        createdAt: 100,
        approval: {
          id: 'interrupted',
          operation: { kind: 'edit', path: 'note.md', diff: '' },
          status: 'pending',
        },
      },
    ])
    store.close()
    store = new ConversationStore(file)
    expect(
      store.messages(conversation.id).find((message) => message.id === 'interrupted-tool')
        ?.toolStatus,
    ).toBe('failed')
    expect(store.history({ around: 'interrupted-tool' }).messages[0].toolStatus).toBe('failed')
    expect(
      store.messages(conversation.id).find((message) => message.id === 'finished-tool')?.toolStatus,
    ).toBe('completed')
    expect(store.messages(conversation.id).at(-1)?.approval?.status).toBe('expired')
    store.close()
    store = new ConversationStore(file)
    expect(store.messages(conversation.id)[0].toolStatus).toBe('failed')
  } finally {
    store.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

it('migrates legacy approval payloads once without dropping previews or completed decisions', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'melo-approval-migration-'))
  const file = path.join(directory, 'history.db')
  let store = new ConversationStore(file)
  const conversation = store.create('/notes', 'claude')
  store.close()
  const legacy = new Database(file)
  const diff = '@@ -1 +1 @@\n-before\n+after'
  const approvals = [
    {
      id: 'edit',
      title: 'Edit document',
      detail: 'Reference/first\nsecond.md',
      diff,
      status: 'pending',
    },
    {
      id: 'memory',
      title: 'Update memory',
      detail: 'user\nKeep it brief.\nUse examples.',
      status: 'allowed',
    },
    { id: 'move', title: 'Move file', detail: 'Inbox/a.md → Reference/a.md', status: 'declined' },
    { id: 'native', title: 'Provider permission', detail: 'read /notes/a.md', status: 'expired' },
  ]
  try {
    const insert = legacy.prepare(
      'INSERT INTO messages (conversationId,id,role,content,createdAt,presentation) VALUES (?,?,?,?,?,?)',
    )
    for (const [index, approval] of approvals.entries())
      insert.run(conversation.id, approval.id, 'tool', '', index, JSON.stringify({ approval }))
  } finally {
    legacy.close()
  }
  try {
    store = new ConversationStore(file)
    const migrated = store.messages(conversation.id)
    expect(migrated.map((message) => message.approval)).toEqual([
      {
        id: 'edit',
        operation: { kind: 'edit', path: 'Reference/first\nsecond.md', diff },
        status: 'expired',
      },
      {
        id: 'memory',
        operation: { kind: 'memory', scope: 'user', content: 'Keep it brief.\nUse examples.' },
        status: 'allowed',
      },
      {
        id: 'move',
        operation: { kind: 'move', source: 'Inbox/a.md', destination: 'Reference/a.md' },
        status: 'declined',
      },
      {
        id: 'native',
        operation: { kind: 'native', title: 'Provider permission', detail: 'read /notes/a.md' },
        status: 'expired',
      },
    ])
    store.close()
    store = new ConversationStore(file)
    expect(store.messages(conversation.id)).toEqual(migrated)
  } finally {
    store.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
