import type { AgentOperation } from '../../../shared/agentCapabilities'
import { createHash } from 'node:crypto'
import { mkdir, readdir, realpath, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { renameFile, trashFile } from '../../api/fileOperations/fileOperations'
import { activeWorkspaceRoot, searchIndex } from '../../api/indexer'
import type { RuntimeRequest } from '../agentTypes'
import { MemoryService } from '../storage/memory'
import { ChangeJournal } from './changeJournal'
import type { AgentChange, AgentHistorySearch } from '../../../shared/types/agent'
import type { WorkspaceOperations, WorkspaceDocumentAccess } from './workspaceTypes'
import { editPreview } from './editPreview'

const hash = (content: string) => createHash('sha256').update(content).digest('hex')

export class WorkspaceAccess {
  private mutation: Promise<void> = Promise.resolve()
  constructor(
    private readonly documents: WorkspaceDocumentAccess,
    private readonly memory: MemoryService,
    private readonly journal: ChangeJournal,
    private readonly searchHistory: (query: string) => AgentHistorySearch,
  ) {}

  undo(id: string, conversationId: string, root: string): Promise<void> {
    const run = this.mutation.then(async () => {
      if (activeWorkspaceRoot() !== root) throw new Error('Workspace is no longer active')
      await this.journal.undo(id, conversationId, root)
    })
    this.mutation = run.then(
      () => {},
      () => {},
    )
    return run
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
      const run = this.mutation.then(async () => {
        assertActive()
        return operation()
      })
      this.mutation = run.then(
        () => {},
        () => {},
      )
      return run
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
