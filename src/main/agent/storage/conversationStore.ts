import { agentOperationSchema, type AgentOperation } from '../../../shared/agentCapabilities'
import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type {
  AgentConversation,
  AgentMessage,
  AgentProvider,
  AgentHistoryMessage,
  AgentHistoryPage,
  AgentHistorySearch,
} from '../../../shared/types/agent'

const presentationSchema = z.object({
  approval: z
    .object({
      id: z.string(),
      operation: agentOperationSchema,
      status: z.enum(['pending', 'allowed', 'declined', 'expired']),
    })
    .optional(),
  change: z
    .object({
      id: z.string(),
      kind: z.enum(['create-folder', 'create-note', 'edit', 'move', 'trash']),
      path: z.string(),
      source: z.string().optional(),
      undone: z.boolean(),
    })
    .optional(),
  plan: z
    .array(
      z.object({ content: z.string(), status: z.enum(['pending', 'in_progress', 'completed']) }),
    )
    .optional(),
})

// Persisted pre-structured approvals exist in development profiles. Upgrade
// their data once; live permission handling never interprets display titles.
const legacyPresentationSchema = presentationSchema.extend({
  approval: z.object({
    id: z.string(),
    title: z.string(),
    detail: z.string(),
    diff: z.string().optional(),
    status: z.enum(['pending', 'allowed', 'declined', 'expired']),
  }),
})
function legacyOperation(
  approval: z.infer<typeof legacyPresentationSchema>['approval'],
): AgentOperation {
  const [location, ...preview] = approval.detail.split('\n')
  switch (approval.title) {
    case 'Create folder':
      return { kind: 'create-folder', path: approval.detail }
    case 'Create note':
      return { kind: 'create-note', path: location, content: preview.join('\n') }
    case 'Edit document':
      if (approval.diff) return { kind: 'edit', path: approval.detail, diff: approval.diff }
      break
    case 'Move file': {
      const parts = approval.detail.split(' → ')
      if (parts.length === 2) return { kind: 'move', source: parts[0], destination: parts[1] }
      break
    }
    case 'Move file to Trash':
      return { kind: 'trash', path: approval.detail }
    case 'Update memory':
      if (location === 'user' || location === 'workspace')
        return { kind: 'memory', scope: location, content: preview.join('\n') }
      break
  }
  return { kind: 'native', title: approval.title, detail: approval.detail }
}

export class ConversationStore {
  private readonly db: Database.Database

  constructor(filePath: string) {
    this.db = new Database(filePath)
    this.db.pragma('journal_mode = WAL')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, workspaceRoot TEXT NOT NULL,
        provider TEXT NOT NULL, updatedAt INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        conversationId TEXT NOT NULL, id TEXT NOT NULL, role TEXT NOT NULL,
        content TEXT NOT NULL, toolStatus TEXT, createdAt INTEGER NOT NULL, context TEXT, presentation TEXT,
        PRIMARY KEY (conversationId, id)
      );
      CREATE TABLE IF NOT EXISTS changes (
        id TEXT PRIMARY KEY, conversationId TEXT NOT NULL, workspaceRoot TEXT NOT NULL,
        data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS conversations_workspace ON conversations(workspaceRoot, updatedAt);
    `)
    const columns = this.db.pragma('table_info(messages)') as { name: string }[]
    if (!columns.some((column) => column.name === 'context'))
      this.db.exec('ALTER TABLE messages ADD COLUMN context TEXT')
    if (!columns.some((column) => column.name === 'presentation'))
      this.db.exec('ALTER TABLE messages ADD COLUMN presentation TEXT')
    const legacyApprovals = this.db
      .prepare(
        "SELECT rowid AS id,presentation FROM messages WHERE json_type(presentation,'$.approval')='object' AND json_type(presentation,'$.approval.operation') IS NULL",
      )
      .all() as { id: number; presentation: string }[]
    this.db.transaction(() => {
      const update = this.db.prepare('UPDATE messages SET presentation=? WHERE rowid=?')
      for (const row of legacyApprovals) {
        const stored = legacyPresentationSchema.parse(JSON.parse(row.presentation))
        const { id, status } = stored.approval
        update.run(
          JSON.stringify({
            ...stored,
            approval: { id, status, operation: legacyOperation(stored.approval) },
          }),
          row.id,
        )
      }
    })()
    const indexed = this.db
      .prepare("SELECT name FROM sqlite_master WHERE name='agent_history_fts'")
      .get()
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS agent_history_fts USING fts5(content, content='messages', content_rowid='rowid', tokenize='trigram');
      CREATE TRIGGER IF NOT EXISTS agent_history_insert AFTER INSERT ON messages BEGIN
        INSERT INTO agent_history_fts(rowid,content) VALUES(new.rowid,new.content);
      END;
      CREATE TRIGGER IF NOT EXISTS agent_history_delete AFTER DELETE ON messages BEGIN
        INSERT INTO agent_history_fts(agent_history_fts,rowid,content) VALUES('delete',old.rowid,old.content);
      END;
      CREATE TRIGGER IF NOT EXISTS agent_history_update AFTER UPDATE OF content ON messages WHEN old.content != new.content BEGIN
        INSERT INTO agent_history_fts(agent_history_fts,rowid,content) VALUES('delete',old.rowid,old.content);
        INSERT INTO agent_history_fts(rowid,content) VALUES(new.rowid,new.content);
      END;
    `)
    // A process restart cannot resume an in-flight tool request.
    this.db.exec(
      `UPDATE messages SET toolStatus='failed' WHERE toolStatus='pending';
       UPDATE messages SET presentation=json_set(presentation,'$.approval.status','expired') WHERE json_extract(presentation,'$.approval.status')='pending';`,
    )
    if (!indexed) {
      this.db.exec(
        `UPDATE messages AS answer SET context=(SELECT question.context FROM messages AS question WHERE question.conversationId=answer.conversationId AND question.role='user' AND question.rowid < answer.rowid ORDER BY question.rowid DESC LIMIT 1) WHERE role='assistant' AND context IS NULL`,
      )
      this.db.exec("INSERT INTO agent_history_fts(agent_history_fts) VALUES('rebuild')")
    }
  }

  writeChange(id: string, conversationId: string, workspaceRoot: string, data: string): void {
    this.db
      .prepare('INSERT OR REPLACE INTO changes VALUES (?, ?, ?, ?)')
      .run(id, conversationId, workspaceRoot, data)
  }

  readChange(id: string, conversationId: string, workspaceRoot: string): string {
    const row = this.db
      .prepare('SELECT data FROM changes WHERE id=? AND conversationId=? AND workspaceRoot=?')
      .get(id, conversationId, workspaceRoot) as { data: string } | undefined
    if (!row) throw new Error('AGENT_UNDO_UNAVAILABLE')
    return row.data
  }

  create(workspaceRoot: string, provider: AgentProvider): AgentConversation {
    const conversation = {
      id: randomUUID(),
      title: '',
      workspaceRoot,
      provider,
      updatedAt: Date.now(),
    }
    this.db
      .prepare(
        'INSERT INTO conversations VALUES (@id, @title, @workspaceRoot, @provider, @updatedAt)',
      )
      .run(conversation)
    return conversation
  }

  get(id: string): AgentConversation {
    const value = this.db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as
      | AgentConversation
      | undefined
    if (!value) throw new Error('Conversation not found')
    return value
  }

  list(workspaceRoot: string): AgentConversation[] {
    return this.db
      .prepare(
        'SELECT * FROM conversations WHERE workspaceRoot = ? ORDER BY updatedAt DESC, rowid DESC LIMIT 100',
      )
      .all(workspaceRoot) as AgentConversation[]
  }

  messages(id: string, limit?: number): AgentMessage[] {
    return (
      this.db
        .prepare(
          `SELECT id, role, content, toolStatus, createdAt, context, presentation FROM (SELECT rowid, * FROM messages WHERE conversationId = ? ORDER BY rowid DESC LIMIT ${limit ?? -1}) ORDER BY rowid`,
        )
        .all(id) as (Omit<AgentMessage, 'context'> & {
        context: string | null
        presentation: string | null
      })[]
    ).map(({ presentation, ...message }) => ({
      ...message,
      ...(presentation ? presentationSchema.parse(JSON.parse(presentation)) : {}),
      toolStatus: message.toolStatus ?? undefined,
      context: message.context
        ? z
            .object({
              filePath: z.string().max(4096).optional(),
              selection: z.string().max(24000).optional(),
            })
            .parse(JSON.parse(message.context))
        : undefined,
    }))
  }

  save(conversation: AgentConversation, messages: AgentMessage[]): void {
    this.db.transaction(() => {
      this.db
        .prepare(
          'UPDATE conversations SET title=@title, provider=@provider, updatedAt=@updatedAt WHERE id=@id',
        )
        .run(conversation)
      const write = this.db.prepare(
        'INSERT INTO messages (conversationId, id, role, content, toolStatus, createdAt, context, presentation) VALUES (@conversationId, @id, @role, @content, @toolStatus, @createdAt, @context, @presentation) ON CONFLICT(conversationId,id) DO UPDATE SET content=excluded.content, toolStatus=excluded.toolStatus, context=excluded.context, presentation=excluded.presentation',
      )
      for (const message of messages)
        write.run({
          ...message,
          conversationId: conversation.id,
          toolStatus: message.toolStatus ?? null,
          context: message.context ? JSON.stringify(message.context) : null,
          presentation: JSON.stringify({
            change: message.change,
            plan: message.plan,
            approval: message.approval,
          }),
        })
    })()
  }

  private historyRows(
    where: string,
    args: (string | number)[],
    order: 'ASC' | 'DESC',
    limit: number,
  ): AgentHistoryMessage[] {
    type Row = Omit<AgentHistoryMessage, 'context' | 'change' | 'plan'> & {
      context: string | null
      presentation: string | null
    }
    const rows = this.db
      .prepare(
        `SELECT m.rowid AS sequence,m.id,m.role,m.content,m.toolStatus,m.createdAt,m.context,m.presentation,m.conversationId,c.workspaceRoot FROM messages m JOIN conversations c ON c.id=m.conversationId WHERE ${where} ORDER BY m.rowid ${order} LIMIT ?`,
      )
      .all(...args, limit) as Row[]
    return rows.map(({ context, presentation, ...row }) => ({
      ...row,
      toolStatus: row.toolStatus ?? undefined,
      context: context
        ? z
            .object({ filePath: z.string(), selection: z.string() })
            .partial()
            .parse(JSON.parse(context))
        : undefined,
      ...(presentation ? presentationSchema.parse(JSON.parse(presentation)) : {}),
    }))
  }

  history(options: { before?: number; after?: number; around?: string } = {}): AgentHistoryPage {
    let messages: AgentHistoryMessage[]
    if (options.around) {
      const target = this.db
        .prepare('SELECT rowid AS sequence FROM messages WHERE id=?')
        .get(options.around) as { sequence: number } | undefined
      if (!target) throw new Error('AGENT_MESSAGE_UNAVAILABLE')
      messages = [
        ...this.historyRows('m.rowid < ?', [target.sequence], 'DESC', 25).reverse(),
        ...this.historyRows('m.rowid >= ?', [target.sequence], 'ASC', 35),
      ]
    } else if (options.after !== undefined)
      messages = this.historyRows('m.rowid > ?', [options.after], 'ASC', 60)
    else
      messages = this.historyRows(
        'm.rowid < ?',
        [options.before ?? Number.MAX_SAFE_INTEGER],
        'DESC',
        60,
      ).reverse()
    const first = messages[0]?.sequence,
      last = messages.at(-1)?.sequence
    return {
      messages,
      hasOlder:
        first !== undefined &&
        !!this.db.prepare('SELECT 1 FROM messages WHERE rowid < ? LIMIT 1').get(first),
      hasNewer:
        last !== undefined &&
        !!this.db.prepare('SELECT 1 FROM messages WHERE rowid > ? LIMIT 1').get(last),
    }
  }

  changeMessages(conversationId: string, changeIds: string[]): AgentMessage[] {
    if (!changeIds.length) return []
    return this.historyRows(
      `m.conversationId=? AND m.id IN (${changeIds.map(() => '?').join(',')})`,
      [conversationId, ...changeIds.map((id) => `change:${id}`)],
      'ASC',
      changeIds.length,
    )
  }

  searchHistory(query: string, before?: number): AgentHistorySearch {
    const value = query.trim()
    const args: (string | number)[] = []
    let where = "m.role IN ('user','assistant')"
    if ([...value].length >= 3) {
      where +=
        ' AND m.rowid IN (SELECT rowid FROM agent_history_fts WHERE agent_history_fts MATCH ?)'
      args.push('"' + value.replaceAll('"', '""') + '"')
    } else if (value) {
      where += ' AND instr(lower(m.content),lower(?)) > 0'
      args.push(value)
    }
    const total = (
      this.db.prepare(`SELECT count(*) AS total FROM messages m WHERE ${where}`).get(...args) as {
        total: number
      }
    ).total
    if (before !== undefined) {
      where += ' AND m.rowid < ?'
      args.push(before)
    }
    const messages = this.historyRows(where, args, 'DESC', 40).map((message) => {
      const at = value ? Math.max(0, message.content.toLowerCase().indexOf(value.toLowerCase())) : 0
      const start = Math.max(0, at - 90)
      return {
        ...message,
        content:
          (start ? '…' : '') +
          message.content.slice(start, start + 500) +
          (message.content.length > start + 500 ? '…' : ''),
      }
    })
    return { messages, total }
  }

  deleteMessage(id: string): void {
    this.db.prepare("DELETE FROM messages WHERE id=? AND role IN ('user','assistant')").run(id)
  }

  clearHistory(): void {
    this.db.transaction(() => {
      this.db.exec('DELETE FROM messages; DELETE FROM changes; DELETE FROM conversations;')
    })()
  }

  close(): void {
    this.db.close()
  }
}
