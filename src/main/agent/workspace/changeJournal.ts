import { createHash, randomUUID } from 'node:crypto'
import { constants, createReadStream } from 'node:fs'
import {
  copyFile,
  lstat,
  mkdir,
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
import type { WorkspaceDocumentAccess } from './workspaceTypes'

const recordSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(['create-folder', 'create-note', 'edit', 'move', 'trash']),
  path: z.string().min(1),
  source: z.string().optional(),
  undone: z.boolean(),
  state: z.enum(['prepared', 'applied', 'undone']),
  fingerprint: z.string().optional(),
  revision: z.string().optional(),
})
type ChangeRecord = z.infer<typeof recordSchema>
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
  ) {
    this.backups = path.join(directory, 'change-backups')
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

  async apply<T>(
    conversation: AgentConversation,
    change: Pick<AgentChange, 'kind' | 'path' | 'source'>,
    operation: () => Promise<T>,
    before?: { content: string; revision: string },
    resultRevision?: (result: T) => string,
  ): Promise<{ result: T; change: AgentChange }> {
    const record: ChangeRecord = { ...change, id: randomUUID(), undone: false, state: 'prepared' }
    const save = () =>
      this.store.writeChange(
        record.id,
        conversation.id,
        conversation.workspaceRoot,
        JSON.stringify(record),
      )
    const backup = path.join(this.backups, record.id)
    if (record.kind === 'edit' || record.kind === 'trash') {
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
    save()
    return { result, change: { id: record.id, ...change, undone: false } }
  }

  async clearBackups(): Promise<void> {
    await rm(this.backups, { recursive: true, force: true })
  }

  async undo(id: string, conversationId: string, root: string): Promise<void> {
    const record = recordSchema.parse(JSON.parse(this.store.readChange(id, conversationId, root)))
    if (record.state === 'undone') return
    if (record.state !== 'applied' || record.id !== id) throw new Error('AGENT_UNDO_UNAVAILABLE')
    const file = await this.resolve(root, record.path, record.kind !== 'trash')
    const backup = path.join(this.backups, id)
    const check = async () => {
      if (!record.fingerprint || (await fingerprint(file)) !== record.fingerprint)
        throw new Error('AGENT_UNDO_CONFLICT')
    }
    try {
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
          await this.documents.fileOperation(file, async () => {
            await check()
            await trashFile(file)
          })
          break
        case 'move': {
          if (!record.source) throw new Error('AGENT_UNDO_UNAVAILABLE')
          const destination = await this.resolve(root, record.source, false)
          await this.documents.fileOperation(file, async () => {
            await check()
            await renameFile(file, destination)
          })
          break
        }
        case 'edit': {
          if (!record.revision) throw new Error('AGENT_UNDO_UNAVAILABLE')
          const content = await readFile(backup, 'utf8')
          await this.documents.edit(file, record.revision, content)
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
    this.store.writeChange(id, conversationId, root, JSON.stringify(record))
    await rm(backup, { force: true })
  }
}
