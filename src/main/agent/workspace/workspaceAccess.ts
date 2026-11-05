import { normalizeTags, readDocumentTags, updateDocumentTags } from '../../../shared/documentTags'
import { readSmartViewsSnapshot, updateSmartViews } from '../../api/smartViews'
import { smartRulesSchema, smartViewSchema } from '../../../shared/smartRules'
import type { AgentOperation } from '../../../shared/agentCapabilities'
import { createHash } from 'node:crypto'
import { lstat, mkdir, readdir, realpath, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { renameFile, trashFile } from '../../api/fileOperations/fileOperations'
import {
  activeWorkspaceRoot,
  searchIndex,
  getAllTags,
  getSmartVocab,
  querySmartRulesPage,
} from '../../api/indexer'
import type { RuntimeRequest } from '../agentTypes'
import { MemoryService } from '../storage/memory'
import { ChangeJournal } from './changeJournal'
import type {
  AgentAttachment,
  AgentChange,
  AgentConversation,
  AgentHistorySearch,
} from '../../../shared/types/agent'
import type { FileIntake } from '../storage/fileIntake'
import type { WorkspaceOperations, WorkspaceDocumentAccess } from './workspaceTypes'
import { editPreview } from './editPreview'
import { organizeFiles } from './fileOrganization'

const hash = (content: string) => createHash('sha256').update(content).digest('hex')

export class WorkspaceAccess {
  private mutation: Promise<void> = Promise.resolve()
  constructor(
    private readonly documents: WorkspaceDocumentAccess,
    private readonly memory: MemoryService,
    private readonly journal: ChangeJournal,
    private readonly searchHistory: (query: string) => AgentHistorySearch,
    private readonly intake?: FileIntake,
  ) {}

  private queue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.mutation.then(operation)
    this.mutation = run.then(
      () => {},
      () => {},
    )
    return run
  }

  receiveAttachment(
    conversation: AgentConversation,
    id: string,
    signal: AbortSignal,
  ): Promise<AgentAttachment> {
    return this.queue(async () => {
      const root = conversation.workspaceRoot
      const assertActive = () => {
        signal.throwIfAborted()
        if (activeWorkspaceRoot() !== root) throw new Error('Workspace is no longer active')
      }
      assertActive()
      this.journal.reconcileAttachments()
      const intake = this.intake!
      const file = intake.get(root, id)
      if (file.path) return file
      const inbox = path.join(root, 'Inbox')
      try {
        const existing = await lstat(inbox)
        if (!existing.isDirectory() || existing.isSymbolicLink())
          throw new Error('AGENT_ATTACHMENT_INBOX_INVALID')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        await this.journal.apply(conversation, { kind: 'create-folder', path: 'Inbox' }, () =>
          mkdir(inbox),
        )
      }
      const source = await intake.prepare(root, id, signal)
      const imported = await this.journal.importFile(
        conversation,
        id,
        source.file,
        source.attachment.name,
        source.fingerprint,
        assertActive,
      )
      return intake.imported(root, id, imported.path)
    })
  }

  undo(id: string, conversationId: string, root: string): Promise<void> {
    return this.queue(async () => {
      if (activeWorkspaceRoot() !== root) throw new Error('Workspace is no longer active')
      await this.journal.undo(id, conversationId, root)
    })
  }

  operations(request: RuntimeRequest, signal?: AbortSignal): WorkspaceOperations {
    const root = request.conversation.workspaceRoot
    const assertActive = () => {
      signal?.throwIfAborted()
      if (!request.isActive()) throw new Error('Agent turn is no longer active')
      if (activeWorkspaceRoot() !== root) throw new Error('Workspace is no longer active')
    }
    const resolve = async (relative: string, existing = true) => {
      assertActive()
      if (
        path.isAbsolute(relative) ||
        relative.split(/[\\/]/).some((segment) => segment.startsWith('.'))
      )
        throw new Error('Use a visible workspace-relative path')
      const target = path.resolve(root, relative)
      const canonical = existing
        ? await realpath(target)
        : path.join(await realpath(path.dirname(target)), path.basename(target))
      const within = path.relative(root, canonical)
      if (
        within === '..' ||
        within.startsWith(`..${path.sep}`) ||
        path.isAbsolute(within) ||
        within.split(path.sep).some((segment) => segment.startsWith('.'))
      )
        throw new Error('Path is outside the visible workspace')
      return canonical
    }
    const resolveDocument = async (relative: string) => {
      if (!relative.toLowerCase().endsWith('.md'))
        throw new Error('Use a workspace-relative Markdown document path')
      const target = await resolve(relative)
      if (!target.toLowerCase().endsWith('.md') || !(await stat(target)).isFile())
        throw new Error('Document target must be a visible Markdown file')
      return target
    }
    const mutate = async <T>(action: AgentOperation, operation: () => Promise<T>): Promise<T> => {
      assertActive()
      if (!(await request.authorize(action, signal))) throw new Error('User declined this change')
      return this.queue(async () => {
        assertActive()
        return operation()
      })
    }
    const change = async <T>(
      metadata: Pick<AgentChange, 'kind' | 'path' | 'source'>,
      operation: () => Promise<T>,
      before?: { content: string; revision: string },
      resultRevision?: (result: T) => string,
    ) => {
      const applied = await this.journal.apply(
        request.conversation,
        metadata,
        () => {
          assertActive()
          return operation()
        },
        before,
        resultRevision,
      )
      request.onEvent({ type: 'change', change: applied.change })
      return applied.result
    }
    return {
      documents: {
        read: async (relative) => {
          const file = await resolveDocument(relative)
          assertActive()
          return this.documents.read(file)
        },
        edit: async (relative, revision, content) => {
          const file = await resolveDocument(relative)
          assertActive()
          const before = await this.documents.read(file)
          if (before.revision !== revision) throw new Error('Document changed; read again')
          const canonical = path.relative(root, file)
          return mutate(
            {
              kind: 'edit',
              path: canonical,
              diff: editPreview(canonical, before.content, content),
            },
            async () => {
              await resolveDocument(relative)
              const current = await this.documents.read(file)
              if (current.revision !== revision) throw new Error('Document changed; read again')
              return change(
                { kind: 'edit', path: canonical },
                () => this.documents.edit(file, revision, content),
                before,
                (snapshot) => snapshot.revision,
              )
            },
          )
        },
      },
      actions: {
        ...(this.intake
          ? {
              organize: (organization) =>
                this.queue(() =>
                  organizeFiles({
                    intake: this.intake!,
                    documents: this.documents,
                    journal: this.journal,
                    request,
                    organization,
                    assertActive,
                  }),
                ),
              resolveAttachment: async (id: string) => {
                assertActive()
                this.journal.reconcileAttachments()
                const { file, attachment } = await this.intake!.openImported(root, id)
                try {
                  if (!(await file.stat()).isFile()) throw new Error('AGENT_ATTACHMENT_UNAVAILABLE')
                  return attachment
                } finally {
                  await file.close()
                }
              },
            }
          : {}),
        searchHistory: async (query) => {
          assertActive()
          return this.searchHistory(query)
        },
        list: async (directory) => {
          const target = await resolve(directory)
          const entries = await readdir(target, { withFileTypes: true })
          return entries
            .filter((entry) => !entry.name.startsWith('.') && !entry.isSymbolicLink())
            .slice(0, 500)
            .map((entry) => ({
              path: path.relative(root, path.join(target, entry.name)),
              directory: entry.isDirectory(),
            }))
        },
        search: async (query) => {
          assertActive()
          const result = searchIndex(query)
          return {
            ...result,
            hits: result.hits.map((hit) => ({ ...hit, path: path.relative(root, hit.path) })),
          }
        },
        create: (relative, content, directory) =>
          mutate(
            directory
              ? { kind: 'create-folder', path: relative }
              : { kind: 'create-note', path: relative, content },
            async () => {
              const target = await resolve(relative, false)
              return change(
                {
                  kind: directory ? 'create-folder' : 'create-note',
                  path: path.relative(root, target),
                },
                async () => {
                  if (directory) await mkdir(target)
                  else {
                    if (!/\.md$/i.test(target)) throw new Error('New documents must use .md')
                    await writeFile(target, content, { flag: 'wx' })
                  }
                  return { path: relative }
                },
              )
            },
          ),
        move: (source, destination) =>
          mutate({ kind: 'move', source, destination }, async () => {
            const from = await resolve(source)
            const to = await resolve(destination, false)
            if (!(await stat(from)).isFile()) throw new Error('Only individual files can be moved')
            await this.documents.fileOperation(from, async () => {
              assertActive()
              await change(
                { kind: 'move', source: path.relative(root, from), path: path.relative(root, to) },
                () => renameFile(from, to),
              )
            })
            return { path: destination }
          }),
        trash: (relative) =>
          mutate({ kind: 'trash', path: relative }, async () => {
            const target = await resolve(relative)
            if (!(await stat(target)).isFile())
              throw new Error('Only individual files can be trashed')
            await this.documents.fileOperation(target, async () => {
              assertActive()
              await change({ kind: 'trash', path: path.relative(root, target) }, () =>
                trashFile(target),
              )
            })
            return { trashed: relative }
          }),
        readTags: async (relative) => {
          assertActive()
          const vocabulary = getAllTags()
          if (!relative) return { vocabulary }
          const snapshot = await this.documents.read(await resolveDocument(relative))
          return {
            vocabulary,
            tags: readDocumentTags(snapshot.content),
            revision: snapshot.revision,
          }
        },
        updateTags: async (relative, revision, add, remove) => {
          const file = await resolveDocument(relative)
          const before = await this.documents.read(file)
          if (before.revision !== revision) throw new Error('Document changed; read tags again')
          const previous = readDocumentTags(before.content)
          const removed = new Set(normalizeTags(remove))
          const tags = normalizeTags([...previous.filter((tag) => !removed.has(tag)), ...add])
          const content = updateDocumentTags(before.content, tags)
          if (content === before.content) return { tags, revision }
          const canonical = path.relative(root, file)
          return mutate(
            { kind: 'tags', path: canonical, before: previous, after: tags },
            async () => {
              await resolveDocument(relative)
              const current = await this.documents.read(file)
              if (current.revision !== revision)
                throw new Error('Document changed; read tags again')
              const result = await change(
                { kind: 'tags', path: canonical },
                () => this.documents.edit(file, revision, content, true),
                before,
                (snapshot) => snapshot.revision,
              )
              return { tags: readDocumentTags(result.content), revision: result.revision }
            },
          )
        },
        readSmartFolders: async () => {
          assertActive()
          return { ...readSmartViewsSnapshot(root), vocabulary: getSmartVocab() }
        },
        previewSmartFolder: async (rules, sort) => {
          assertActive()
          const result = querySmartRulesPage(smartRulesSchema.parse(rules), 10, sort)
          return {
            ...result,
            items: result.items.map((item) => ({ ...item, path: path.relative(root, item.path) })),
          }
        },
        saveSmartFolder: async (definition, revision) => {
          const view = smartViewSchema.parse(definition)
          assertActive()
          return mutate({ kind: 'smart-folder', path: view.name, view }, async () => {
            const before = readSmartViewsSnapshot(root)
            if (before.revision !== revision) throw new Error('SMART_VIEWS_CONFLICT')
            const existing = before.views.find((item) => item.id === view.id)
            // Editing a preset creates a user-named definition, like the existing builder.
            const saved = { ...view, preset: undefined }
            const views = existing
              ? before.views.map((item) => (item.id === view.id ? saved : item))
              : [...before.views, saved]
            const result = await change(
              { kind: 'smart-folder', path: saved.name },
              async () => updateSmartViews(root, views, revision),
              { content: JSON.stringify(before.views), revision },
              (snapshot) => snapshot.revision,
            )
            return { view: saved, revision: result.revision }
          })
        },
        readMemory: async () => {
          assertActive()
          const memory = await this.memory.read(root)
          return {
            user: { content: memory.user, revision: hash(memory.user) },
            workspace: { content: memory.workspace, revision: hash(memory.workspace) },
          }
        },
        writeMemory: (scope, revision, content) =>
          mutate({ kind: 'memory', scope, content }, async () => {
            const memory = await this.memory.read(root)
            if (hash(memory[scope]) !== revision) throw new Error('Memory changed; read it again')
            assertActive()
            await this.memory.write(root, scope, content)
            return { revision: hash(content) }
          }),
      },
    }
  }
}
