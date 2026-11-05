import { agentChangeSchema, filingStateSchema } from '../../../shared/agentChanges'
import { agentOperationSchema, type AgentOperation } from '../../../shared/agentCapabilities'
import { attachmentReceiptSchema } from '../../../shared/agentAttachments'
import { agentToolActivitySchema } from '../../../shared/agentActivity'
import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type {
  AgentConversation,
  AgentChange,
  AgentFiling,
  AgentMessage,
  AgentProvider,
  AgentHistoryMessage,
  AgentHistoryPage,
  AgentHistorySearch,
} from '../../../shared/types/agent'

const presentationSchema = z.object({
  toolActivity: agentToolActivitySchema.optional(),
  receipt: attachmentReceiptSchema.optional(),
  approval: z
    .object({
      id: z.string(),
      operation: agentOperationSchema,
      status: z.enum(['pending', 'allowed', 'declined', 'expired']),
    })
    .optional(),
  filingId: z.string().uuid().optional(),
  change: agentChangeSchema.optional(),
  plan: z
    .array(
      z.object({ content: z.string(), status: z.enum(['pending', 'in_progress', 'completed']) }),
    )
    .optional(),
})
const storedChangeSchema = agentChangeSchema.extend({
  state: z.enum(['prepared', 'applied', 'undone']),
})
const contextSchema = z.object({
  activeFilePath: z.string().min(1).max(4096).nullable().optional(),
  filePath: z.string().max(4096).optional(),
  selection: z.string().max(24000).optional(),
  attachments: z
    .array(
      z.object({
        id: z.string().uuid(),
        name: z.string(),
        size: z.number().nonnegative(),
        path: z.string().optional(),
      }),
    )
    .max(20)
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

type StoredMessage = AgentHistoryMessage & { filingId?: string }

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
      CREATE TABLE IF NOT EXISTS filing_batches (
        id TEXT PRIMARY KEY, conversationId TEXT NOT NULL, workspaceRoot TEXT NOT NULL,
        createdAt INTEGER NOT NULL, state TEXT NOT NULL, fileCount INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS conversations_workspace ON conversations(workspaceRoot, updatedAt);
    `)
    const changeColumns = this.db.pragma('table_info(changes)') as { name: string }[]
    if (!changeColumns.some((column) => column.name === 'batchId'))
      this.db.exec('ALTER TABLE changes ADD COLUMN batchId TEXT')
    this.db.exec(
      'CREATE INDEX IF NOT EXISTS changes_batch ON changes(batchId, conversationId, workspaceRoot)',
    )
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS changes_attachment_sync ON changes(json_extract(data,'$.attachmentSync.pending')) WHERE json_extract(data,'$.attachmentSync.pending')=1",
    )
    const filingColumns = this.db.pragma('table_info(filing_batches)') as { name: string }[]
    if (!filingColumns.some((column) => column.name === 'version'))
      this.db.exec('ALTER TABLE filing_batches ADD COLUMN version INTEGER NOT NULL DEFAULT 0')
    this.db.exec(
      "UPDATE filing_batches SET state='failed',version=version+1 WHERE state='applying'",
    )
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
    const receipts = this.db
      .prepare(
        "SELECT rowid AS id,presentation FROM messages WHERE json_type(presentation,'$.receipt')='object'",
      )
      .all() as { id: number; presentation: string }[]
    this.db.transaction(() => {
      const update = this.db.prepare('UPDATE messages SET presentation=? WHERE rowid=?')
      for (const row of receipts) {
        const stored = presentationSchema.parse(JSON.parse(row.presentation))
        if (!stored.receipt!.files.some((file) => file.status === 'pending')) continue
        for (const file of stored.receipt!.files)
          if (file.status === 'pending') file.status = 'cancelled'
        update.run(JSON.stringify(stored), row.id)
      }
    })()
    if (!indexed) {
      this.db.exec(
        `UPDATE messages AS answer SET context=(SELECT question.context FROM messages AS question WHERE question.conversationId=answer.conversationId AND question.role='user' AND question.rowid < answer.rowid ORDER BY question.rowid DESC LIMIT 1) WHERE role='assistant' AND context IS NULL`,
      )
      this.db.exec("INSERT INTO agent_history_fts(agent_history_fts) VALUES('rebuild')")
    }
  }

  writeChange(
    id: string,
    conversationId: string,
    workspaceRoot: string,
    data: string,
    batchId?: string,
  ): void {
    this.db.transaction(() => {
      this.db
        .prepare(
          'INSERT INTO changes (id,conversationId,workspaceRoot,data,batchId) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET conversationId=excluded.conversationId,workspaceRoot=excluded.workspaceRoot,data=excluded.data,batchId=excluded.batchId',
        )
        .run(id, conversationId, workspaceRoot, data, batchId ?? null)
      if (batchId)
        this.db.prepare('UPDATE filing_batches SET version=version+1 WHERE id=?').run(batchId)
    })()
  }

  pendingAttachmentChanges(): { conversationId: string; workspaceRoot: string; data: string }[] {
    return this.db
      .prepare(
        "SELECT conversationId,workspaceRoot,data FROM changes WHERE json_extract(data,'$.attachmentSync.pending')=1 ORDER BY rowid",
      )
      .all() as { conversationId: string; workspaceRoot: string; data: string }[]
  }

  findChange(id: string, conversationId: string, workspaceRoot: string): string | undefined {
    const row = this.db
      .prepare('SELECT data FROM changes WHERE id=? AND conversationId=? AND workspaceRoot=?')
      .get(id, conversationId, workspaceRoot) as { data: string } | undefined
    return row?.data
  }

  readChange(id: string, conversationId: string, workspaceRoot: string): string {
    const value = this.findChange(id, conversationId, workspaceRoot)
    if (!value) throw new Error('AGENT_UNDO_UNAVAILABLE')
    return value
  }

  startFiling(conversation: AgentConversation, fileCount: number): string {
    const id = randomUUID(),
      createdAt = Date.now()
    this.db.transaction(() => {
      this.db
        .prepare(
          'INSERT INTO filing_batches (id,conversationId,workspaceRoot,createdAt,state,fileCount) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(id, conversation.id, conversation.workspaceRoot, createdAt, 'applying', fileCount)
      this.db
        .prepare(
          "INSERT INTO messages (conversationId,id,role,content,createdAt,presentation) VALUES (?,?,'tool','',?,?)",
        )
        .run(conversation.id, `filing:${id}`, createdAt, JSON.stringify({ filingId: id }))
    })()
    return id
  }

  finishFiling(id: string, state: 'completed' | 'failed'): void {
    this.db.prepare('UPDATE filing_batches SET state=?,version=version+1 WHERE id=?').run(state, id)
  }

  filing(id: string, conversationId: string, workspaceRoot: string): AgentFiling {
    const row = this.db
      .prepare(
        'SELECT id,state,fileCount,createdAt,version FROM filing_batches WHERE id=? AND conversationId=? AND workspaceRoot=?',
      )
      .get(id, conversationId, workspaceRoot) as
      | Omit<AgentFiling, 'changes' | 'unresolved'>
      | undefined
    if (!row) throw new Error('AGENT_UNDO_UNAVAILABLE')
    const records = this.db
      .prepare(
        'SELECT data FROM changes WHERE batchId=? AND conversationId=? AND workspaceRoot=? ORDER BY rowid',
      )
      .all(id, conversationId, workspaceRoot) as { data: string }[]
    const changes: AgentChange[] = [],
      unresolved: AgentChange[] = []
    for (const { data } of records) {
      const { state, ...change } = storedChangeSchema.parse(JSON.parse(data))
      // Prepared writes may already have reached disk; retain them without guessing an inverse.
      if (state === 'prepared') unresolved.push(change)
      else changes.push(change)
    }
    return { ...row, state: filingStateSchema.parse(row.state), changes, unresolved }
  }

  private hydrateFilings(messages: StoredMessage[]): AgentHistoryMessage[] {
    const batches = new Set<string>()
    const references = new Set(
      messages.flatMap((message) => (message.filingId ? [message.filingId] : [])),
    )
    return messages.map(({ filingId, ...message }) => {
      const id = filingId ?? message.change?.batchId
      if (!id || (!filingId && references.has(id)) || batches.has(id)) return message
      const filing = this.filing(id, message.conversationId, message.workspaceRoot)
      batches.add(id)
      return { ...message, filing }
    })
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
    return this.hydrateFilings(
      this.historyRows('m.conversationId=?', [id], 'DESC', limit ?? -1).reverse(),
    ).map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
      toolStatus: message.toolStatus,
      context: message.context,
      change: message.change,
      filing: message.filing,
      approval: message.approval,
      receipt: message.receipt,
      plan: message.plan,
      toolActivity: message.toolActivity,
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
            filingId:
              message.filing && message.id === `filing:${message.filing.id}`
                ? message.filing.id
                : undefined,
            change: message.change,
            plan: message.plan,
            approval: message.approval,
            receipt: message.receipt,
            toolActivity: message.toolActivity,
          }),
        })
    })()
  }

  private historyRows(
    where: string,
    args: (string | number)[],
    order: 'ASC' | 'DESC',
    limit: number,
  ): StoredMessage[] {
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
      context: context ? contextSchema.parse(JSON.parse(context)) : undefined,
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
      messages: this.hydrateFilings(messages),
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
      this.db.exec(
        'DELETE FROM messages; DELETE FROM changes; DELETE FROM filing_batches; DELETE FROM conversations;',
      )
    })()
  }

  close(): void {
    this.db.close()
  }
}
