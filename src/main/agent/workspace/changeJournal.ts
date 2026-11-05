import { readSmartViewsSnapshot, updateSmartViews } from '../../api/smartViews'
import { storedSmartViewsSchema } from '../../../shared/smartRules'
import { agentChangeSchema } from '../../../shared/agentChanges'
import { createHash, randomUUID } from 'node:crypto'
import { constants, createReadStream } from 'node:fs'
import {
  copyFile,
  lstat,
  mkdir,
  link,
  readFile,
  realpath,
  rm,
  rmdir,
  stat,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import type { AgentChange, AgentConversation } from '../../../shared/types/agent'
import { renameFile, trashFile } from '../../api/fileOperations/fileOperations'
import { ConversationStore } from '../storage/conversationStore'
import type { FileIntake } from '../storage/fileIntake'
import type { WorkspaceDocumentAccess } from './workspaceTypes'

const recordSchema = agentChangeSchema.extend({
  id: z.string().uuid(),
  path: z.string().min(1),
  state: z.enum(['prepared', 'applied', 'undone']),
  fingerprint: z.string().optional(),
  revision: z.string().optional(),
  identity: z.string().optional(),
  attachmentIds: z.array(z.string().uuid()).optional(),
  attachmentSync: z
    .object({
      ids: z.array(z.string().uuid()),
      pending: z.boolean(),
      path: z.string(),
      state: z.enum(['imported', 'removed']),
    })
    .optional(),
})
type ChangeRecord = z.infer<typeof recordSchema>
export class UndoBackupCleanupError extends Error {
  constructor(
    readonly change: AgentChange,
    cause: unknown,
  ) {
    super('AGENT_UNDO_BACKUP_CLEANUP_FAILED', { cause })
  }
}
const fingerprint = async (file: string) => {
  const value = await lstat(file)
  if (value.isSymbolicLink()) throw new Error('AGENT_UNDO_CONFLICT')
  if (value.isDirectory()) return `${value.dev}:${value.ino}:folder`
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

/** Undo data stays in the main process; the transcript contains only file metadata.
 * A prepared record is never offered for undo after an interrupted filesystem write. */
export class ChangeJournal {
  private readonly backups: string
  constructor(
    private readonly store: ConversationStore,
    private readonly documents: WorkspaceDocumentAccess,
    directory: string,
    private readonly intake?: FileIntake,
  ) {
    this.backups = path.join(directory, 'change-backups')
    this.reconcileAttachments()
  }

  reconcileAttachments(): void {
    if (!this.intake) return
    for (const row of this.store.pendingAttachmentChanges())
      this.synchronizeAttachments(
        recordSchema.parse(JSON.parse(row.data)),
        row.conversationId,
        row.workspaceRoot,
      )
  }

  private synchronizeAttachments(record: ChangeRecord, conversationId: string, root: string): void {
    if (!this.intake || !record.attachmentSync?.pending) return
    const sync = record.attachmentSync
    this.intake.synchronize(root, sync.ids, sync.path, sync.state)
    sync.pending = false
    this.store.writeChange(record.id, conversationId, root, JSON.stringify(record), record.batchId)
  }

  private markAttachmentSync(record: ChangeRecord): void {
    if (!record.attachmentIds?.length) return
    const undo = record.state === 'undone'
    const removed = undo ? record.kind === 'import' : record.kind === 'trash'
    record.attachmentSync = {
      ids: record.attachmentIds,
      pending: true,
      path: undo && record.kind === 'move' ? record.source! : record.path,
      state: removed ? 'removed' : 'imported',
    }
  }

  private async resolve(root: string, relative: string, existing: boolean): Promise<string> {
    if (path.isAbsolute(relative) || relative.split(/[\\/]/).some((part) => part.startsWith('.')))
      throw new Error('Invalid workspace path')
    const target = path.resolve(root, relative)
    const canonical = existing
      ? await realpath(target)
      : path.join(await realpath(path.dirname(target)), path.basename(target))
    const within = path.relative(root, canonical)
    if (
      !within ||
      within.startsWith(`..${path.sep}`) ||
      within === '..' ||
      path.isAbsolute(within) ||
      within.split(path.sep).some((part) => part.startsWith('.'))
    )
      throw new Error('Path is outside the visible workspace')
    if (existing && canonical !== target) throw new Error('Undo does not follow symbolic links')
    return canonical
  }

  async importFile(
    conversation: AgentConversation,
    id: string,
    source: string,
    name: string,
    expected: string,
    assertActive: () => void,
  ): Promise<AgentChange> {
    this.reconcileAttachments()
    const root = conversation.workspaceRoot
    const stored = this.store.findChange(id, conversation.id, root)
    const record: ChangeRecord = stored
      ? recordSchema.parse(JSON.parse(stored))
      : {
          id,
          kind: 'import',
          path: path.join('Inbox', name),
          undone: false,
          state: 'prepared',
          fingerprint: expected,
          attachmentIds: this.intake ? [id] : [],
        }
    if (record.kind !== 'import' || record.fingerprint !== expected || record.state === 'undone')
      throw new Error('AGENT_UNDO_CONFLICT')
    const save = () => this.store.writeChange(id, conversation.id, root, JSON.stringify(record))
    const ownsTarget = async (file: string) => {
      const stat = await lstat(file)
      return (
        !stat.isSymbolicLink() &&
        record.identity === `${stat.dev}:${stat.ino}` &&
        (await fingerprint(file)) === expected
      )
    }
    if (record.state === 'applied') {
      if (!(await ownsTarget(await this.resolve(root, record.path, true))))
        throw new Error('AGENT_UNDO_CONFLICT')
      return { id, kind: 'import', path: record.path, undone: false }
    }
    // Intake supplies a complete copy on this volume. Record its inode before
    // linking so a restart can distinguish our copy from a same-name user file.
    if ((await fingerprint(source)) !== expected) throw new Error('AGENT_UNDO_CONFLICT')
    const identity = await lstat(source)
    const preparedIdentity = `${identity.dev}:${identity.ino}`
    if (record.identity && record.identity !== preparedIdentity)
      throw new Error('AGENT_UNDO_CONFLICT')
    record.identity = preparedIdentity
    for (let counter = 0; counter <= 500; counter++) {
      assertActive()
      const target = await this.resolve(root, record.path, false)
      save()
      try {
        await link(source, target)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        if (!(await ownsTarget(target))) {
          const extension = path.extname(name)
          record.path = path.join(
            'Inbox',
            `${path.basename(name, extension)} (${counter + 1})${extension}`,
          )
          continue
        }
      }
      if (!(await ownsTarget(target))) throw new Error('AGENT_UNDO_CONFLICT')
      record.state = 'applied'
      this.markAttachmentSync(record)
      save()
      this.synchronizeAttachments(record, conversation.id, root)
      return { id, kind: 'import', path: record.path, undone: false }
    }
    throw new Error('AGENT_ATTACHMENT_NAME_CONFLICT')
  }

  async apply<T>(
    conversation: AgentConversation,
    change: Pick<AgentChange, 'kind' | 'path' | 'source' | 'batchId'>,
    operation: () => Promise<T>,
    before?: { content: string; revision: string },
    resultRevision?: (result: T) => string,
  ): Promise<{ result: T; change: AgentChange }> {
    this.reconcileAttachments()
    const record: ChangeRecord = { ...change, id: randomUUID(), undone: false, state: 'prepared' }
    if (this.intake && (change.kind === 'move' || change.kind === 'trash'))
      record.attachmentIds = this.intake.idsAt(
        conversation.workspaceRoot,
        change.source ?? change.path,
      )
    const save = () =>
      this.store.writeChange(
        record.id,
        conversation.id,
        conversation.workspaceRoot,
        JSON.stringify(record),
        record.batchId,
      )
    const backup = path.join(this.backups, record.id)
    if (['edit', 'tags', 'smart-folder', 'trash'].includes(record.kind)) {
      await mkdir(this.backups, { recursive: true, mode: 0o700 })
      if (before) await writeFile(backup, before.content, { flag: 'wx', mode: 0o600 })
      else {
        const target = await this.resolve(conversation.workspaceRoot, record.path, true)
        const version = await fingerprint(target)
        await copyFile(target, backup, constants.COPYFILE_EXCL)
        if ((await fingerprint(target)) !== version) {
          await rm(backup)
          throw new Error('AGENT_UNDO_CONFLICT')
        }
      }
    }
    save()
    const result = await operation()
    if (resultRevision) record.revision = resultRevision(result)
    else if (record.kind !== 'trash')
      record.fingerprint = await fingerprint(path.join(conversation.workspaceRoot, record.path))
    record.state = 'applied'
    // The checkpoint includes the exact IDs and pending sync, so a committed
    // filesystem operation never has to run again just to repair its registry.
    this.markAttachmentSync(record)
    save()
    this.synchronizeAttachments(record, conversation.id, conversation.workspaceRoot)
    return { result, change: { id: record.id, ...change, undone: false } }
  }

  async filing<T>(
    conversation: AgentConversation,
    fileCount: number,
    publish: (batchId: string) => void,
    operation: (batchId: string) => Promise<T>,
  ): Promise<T> {
    const id = this.store.startFiling(conversation, fileCount)
    try {
      publish(id)
      const result = await operation(id)
      this.store.finishFiling(id, 'completed')
      publish(id)
      return result
    } catch (error) {
      this.store.finishFiling(id, 'failed')
      publish(id)
      throw error
    }
  }

  async clearBackups(): Promise<void> {
    await rm(this.backups, { recursive: true, force: true })
  }

  private async cleanupBackup(change: AgentChange): Promise<void> {
    try {
      await rm(path.join(this.backups, change.id), { force: true })
    } catch (error) {
      throw new UndoBackupCleanupError(change, error)
    }
  }

  async undo(id: string, conversationId: string, root: string): Promise<AgentChange | undefined> {
    this.reconcileAttachments()
    const record = recordSchema.parse(JSON.parse(this.store.readChange(id, conversationId, root)))
    if (record.state === 'undone') {
      await this.cleanupBackup(agentChangeSchema.parse(record))
      return
    }
    if (record.state !== 'applied' || record.id !== id) throw new Error('AGENT_UNDO_UNAVAILABLE')
    const backup = path.join(this.backups, id)
    const check = async (file: string) => {
      if (!record.fingerprint || (await fingerprint(file)) !== record.fingerprint)
        throw new Error('AGENT_UNDO_CONFLICT')
    }
    try {
      const file =
        record.kind === 'smart-folder'
          ? ''
          : await this.resolve(root, record.path, record.kind !== 'trash')
      switch (record.kind) {
        case 'create-folder': {
          // rmdir refuses nonempty folders; never remove files the user added later.
          const current = await stat(file)
          const identity = [current.dev, current.ino].join(':')
          if (!record.fingerprint?.startsWith(identity + ':'))
            throw new Error('AGENT_UNDO_CONFLICT')
          await rmdir(file)
          break
        }
        case 'create-note':
        case 'import':
          await this.documents.fileOperation(file, async () => {
            await check(file)
            if (record.identity) {
              const current = await lstat(file)
              if (`${current.dev}:${current.ino}` !== record.identity)
                throw new Error('AGENT_UNDO_CONFLICT')
            }
            await trashFile(file)
          })
          break
        case 'move': {
          if (!record.source) throw new Error('AGENT_UNDO_UNAVAILABLE')
          const destination = await this.resolve(root, record.source, false)
          await this.documents.fileOperation(file, async () => {
            await check(file)
            await renameFile(file, destination)
          })
          break
        }
        case 'smart-folder': {
          if (!record.revision) throw new Error('AGENT_UNDO_UNAVAILABLE')
          if (readSmartViewsSnapshot(root).revision !== record.revision)
            throw new Error('AGENT_UNDO_CONFLICT')
          const views = storedSmartViewsSchema.parse(JSON.parse(await readFile(backup, 'utf8')))
          updateSmartViews(root, views, record.revision, true)
          break
        }
        case 'tags':
        case 'edit': {
          if (!record.revision) throw new Error('AGENT_UNDO_UNAVAILABLE')
          const content = await readFile(backup, 'utf8')
          await this.documents.edit(file, record.revision, content, record.kind === 'tags')
          break
        }
        case 'trash':
          // Exclusive creation refuses a newly-created file at the original path.
          await copyFile(backup, file, constants.COPYFILE_EXCL)
          break
      }
    } catch (error) {
      if (
        ['EEXIST', 'ENOENT', 'ENOTEMPTY', 'EISDIR', 'ENOTDIR'].includes(
          (error as NodeJS.ErrnoException).code ?? '',
        )
      )
        throw new Error('AGENT_UNDO_CONFLICT', { cause: error })
      throw error
    }
    record.state = 'undone'
    record.undone = true
    this.markAttachmentSync(record)
    this.store.writeChange(id, conversationId, root, JSON.stringify(record), record.batchId)
    this.synchronizeAttachments(record, conversationId, root)
    const change: AgentChange = {
      id,
      kind: record.kind,
      path: record.path,
      source: record.source,
      batchId: record.batchId,
      undone: true,
    }
    await this.cleanupBackup(change)
    return change
  }
}
