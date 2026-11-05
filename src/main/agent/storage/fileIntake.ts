import Database from 'better-sqlite3'
import { constants, createWriteStream } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import path from 'node:path'
import type { AgentAttachment } from '../../../shared/types/agent'

interface StoredAttachment extends AgentAttachment {
  workspaceRoot: string
  fingerprint: string
  state: 'draft' | 'receiving' | 'imported' | 'removed'
  path: string | undefined
}
const MAX_DRAFT_FILES = 20
const publicFile = ({
  id,
  name,
  size,
  path: location,
  state,
}: StoredAttachment): AgentAttachment => ({
  id,
  name,
  size,
  ...(location && state === 'imported' ? { path: location } : {}),
})

export async function fileFingerprint(file: string): Promise<string> {
  const hash = createHash('sha256')
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk)
  } finally {
    await handle.close()
  }
  return hash.digest('hex')
}

/** Own draft snapshots and their locations; imported files remain ordinary user files. */
export class FileIntake {
  private readonly db: Database.Database
  private readonly directory: string
  private captureTail: Promise<unknown> = Promise.resolve()
  private initialized: Promise<void> | undefined
  private readonly cleanedRoots = new Set<string>()

  constructor(databasePath: string, directory: string) {
    this.directory = path.join(directory, 'intake')
    this.db = new Database(databasePath)
    this.db.pragma('journal_mode = WAL')
    this.db.exec(`CREATE TABLE IF NOT EXISTS agent_attachments (
      id TEXT PRIMARY KEY, workspaceRoot TEXT NOT NULL, name TEXT NOT NULL,
      size INTEGER NOT NULL, fingerprint TEXT NOT NULL, state TEXT NOT NULL,
      path TEXT, createdAt INTEGER NOT NULL
    ); CREATE INDEX IF NOT EXISTS agent_attachments_drafts ON agent_attachments(workspaceRoot,state);`)
  }

  close(): void {
    this.db.close()
  }

  private stored(root: string, id: string): StoredAttachment {
    const row = this.db
      .prepare('SELECT * FROM agent_attachments WHERE id=? AND workspaceRoot=?')
      .get(id, root) as StoredAttachment | undefined
    if (!row || row.state === 'removed') throw new Error('AGENT_ATTACHMENT_UNAVAILABLE')
    return row
  }

  get(root: string, id: string): AgentAttachment {
    return publicFile(this.stored(root, id))
  }

  async openPreview(root: string, id: string): Promise<Awaited<ReturnType<typeof open>>> {
    const row = this.stored(root, id)
    if (row.state === 'imported') {
      const { file } = await this.openImported(root, id)
      return file
    }
    return open(path.join(this.directory, id), constants.O_RDONLY | constants.O_NOFOLLOW)
  }

  drafts(root: string): AgentAttachment[] {
    return (
      this.db
        .prepare(
          "SELECT * FROM agent_attachments WHERE workspaceRoot=? AND state IN ('draft','receiving') ORDER BY createdAt,rowid",
        )
        .all(root) as StoredAttachment[]
    ).map(publicFile)
  }

  private async sweep(directory: string): Promise<void> {
    for (const name of await readdir(directory)) {
      if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(name)) continue
      const row = this.db.prepare('SELECT state FROM agent_attachments WHERE id=?').get(name) as
        | Pick<StoredAttachment, 'state'>
        | undefined
      // Only unlink our staging names. A hard-linked published copy stays in Inbox.
      if (!row || row.state === 'imported' || row.state === 'removed')
        await rm(path.join(directory, name), { force: true })
    }
  }

  private initialize(): Promise<void> {
    return (this.initialized ??= (async () => {
      await mkdir(this.directory, { recursive: true, mode: 0o700 })
      if ((await lstat(this.directory)).isSymbolicLink())
        throw new Error('AGENT_ATTACHMENT_UNAVAILABLE')
      await this.sweep(this.directory)
    })().catch((error) => {
      this.initialized = undefined
      throw error
    }))
  }

  private async workspaceStaging(root: string, create: boolean): Promise<string> {
    const canonicalRoot = await realpath(root)
    const metadata = path.join(canonicalRoot, '.melo')
    if (create) await mkdir(metadata, { recursive: true, mode: 0o700 })
    if ((await realpath(metadata)) !== metadata) throw new Error('AGENT_ATTACHMENT_UNAVAILABLE')
    const directory = path.join(metadata, 'intake')
    if (create) await mkdir(directory, { recursive: true, mode: 0o700 })
    if ((await realpath(directory)) !== directory) throw new Error('AGENT_ATTACHMENT_UNAVAILABLE')
    if (!this.cleanedRoots.has(root)) {
      await this.sweep(directory)
      this.cleanedRoots.add(root)
    }
    return directory
  }

  private capture(
    root: string,
    name: string,
    copy: (destination: string) => Promise<void>,
  ): Promise<AgentAttachment> {
    const run = this.captureTail.then(async () => {
      await this.initialize()
      if (this.drafts(root).length >= MAX_DRAFT_FILES) throw new Error('AGENT_ATTACHMENT_LIMIT')
      const id = randomUUID()
      const destination = path.join(this.directory, id)
      try {
        await copy(destination)
        const size = (await lstat(destination)).size
        const fingerprint = await fileFingerprint(destination)
        this.db
          .prepare("INSERT INTO agent_attachments VALUES (?,?,?,?,?,'draft',NULL,?)")
          .run(id, root, name, size, fingerprint, Date.now())
        return { id, name, size }
      } catch (error) {
        await rm(destination, { force: true })
        throw error
      }
    })
    this.captureTail = run.then(
      () => {},
      () => {},
    )
    return run
  }

  async stageFile(root: string, source: string): Promise<AgentAttachment> {
    const file = await open(await realpath(source), constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const before = await file.stat()
      if (!before.isFile()) throw new Error('AGENT_ATTACHMENT_NOT_FILE')
      const name = path
        .basename(source)
        .replace(/[\\/:]|\p{Cc}/gu, '_')
        .replace(/^\.+/, '_')
      return await this.capture(root, name, async (destination) => {
        await pipeline(
          file.createReadStream({ autoClose: false }),
          createWriteStream(destination, { flags: 'wx', mode: 0o600 }),
        )
        const after = await file.stat()
        if (before.size !== after.size || before.mtimeMs !== after.mtimeMs)
          throw new Error('AGENT_ATTACHMENT_SOURCE_CHANGED')
      })
    } finally {
      await file.close()
    }
  }

  stageImage(root: string, png: Buffer): Promise<AgentAttachment> {
    return this.capture(
      root,
      `Screenshot-${new Date().toISOString().replace(/[:.]/g, '-')}.png`,
      (file) => writeFile(file, png, { flag: 'wx', mode: 0o600 }),
    )
  }

  async remove(root: string, id: string): Promise<void> {
    const file = this.stored(root, id)
    if (file.state === 'imported') throw new Error('AGENT_ATTACHMENT_ALREADY_IMPORTED')
    try {
      await rm(path.join(await this.workspaceStaging(root, false), id), { force: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await rm(path.join(this.directory, id), { force: true })
    this.db.prepare('DELETE FROM agent_attachments WHERE id=?').run(id)
  }

  async prepare(
    root: string,
    id: string,
    signal: AbortSignal,
  ): Promise<{
    file: string
    fingerprint: string
    attachment: AgentAttachment
    imported: boolean
  }> {
    await this.initialize()
    const row = this.stored(root, id)
    const source = path.join(this.directory, id)
    if (row.state === 'imported')
      return {
        file: source,
        fingerprint: row.fingerprint,
        attachment: publicFile(row),
        imported: true,
      }
    signal.throwIfAborted()
    const destination = path.join(await this.workspaceStaging(root, true), id)
    let existing: Awaited<ReturnType<typeof lstat>> | undefined
    try {
      existing = await lstat(destination)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    if (existing && (existing.isSymbolicLink() || !existing.isFile()))
      throw new Error('AGENT_ATTACHMENT_UNAVAILABLE')
    if (existing && (await fileFingerprint(destination)) !== row.fingerprint) {
      if (existing.nlink > 1) throw new Error('AGENT_UNDO_CONFLICT')
      await rm(destination)
      existing = undefined
    }
    if (!existing) {
      const input = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW)
      try {
        const output = await open(
          destination,
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
          0o600,
        )
        try {
          await pipeline(input.createReadStream({ autoClose: false }), output.createWriteStream(), {
            signal,
          })
        } catch (error) {
          await rm(destination, { force: true })
          throw error
        } finally {
          await output.close()
        }
      } finally {
        await input.close()
      }
    }
    if ((await fileFingerprint(destination)) !== row.fingerprint)
      throw new Error('AGENT_UNDO_CONFLICT')
    this.db
      .prepare("UPDATE agent_attachments SET state='receiving' WHERE id=? AND workspaceRoot=?")
      .run(id, root)
    return {
      file: destination,
      fingerprint: row.fingerprint,
      attachment: publicFile(row),
      imported: false,
    }
  }

  async imported(root: string, id: string, destination: string): Promise<AgentAttachment> {
    this.stored(root, id)
    this.db
      .prepare(
        "UPDATE agent_attachments SET state='imported',path=? WHERE id=? AND workspaceRoot=?",
      )
      .run(destination, id, root)
    // A committed workspace copy is durable; both staging copies are disposable.
    await rm(path.join(await this.workspaceStaging(root, false), id), { force: true })
    await rm(path.join(this.directory, id), { force: true })
    return this.get(root, id)
  }

  idsAt(root: string, location: string): string[] {
    return (
      this.db
        .prepare(
          "SELECT id FROM agent_attachments WHERE workspaceRoot=? AND path=? AND state='imported'",
        )
        .all(root, location) as { id: string }[]
    ).map(({ id }) => id)
  }

  synchronize(root: string, ids: string[], location: string, state: 'imported' | 'removed'): void {
    this.db.transaction(() => {
      const update = this.db.prepare(
        'UPDATE agent_attachments SET state=?,path=? WHERE workspaceRoot=? AND id=?',
      )
      for (const id of ids) {
        if (update.run(state, location, root, id).changes !== 1)
          throw new Error('AGENT_ATTACHMENT_UNAVAILABLE')
      }
    })()
  }

  async openImported(root: string, id: string) {
    const row = this.stored(root, id)
    if (row.state !== 'imported' || !row.path) throw new Error('AGENT_ATTACHMENT_UNAVAILABLE')
    const canonicalRoot = await realpath(root)
    const target = path.resolve(canonicalRoot, row.path)
    const canonical = await realpath(target)
    if (canonical !== target || !canonical.startsWith(canonicalRoot + path.sep))
      throw new Error('AGENT_ATTACHMENT_UNAVAILABLE')
    return {
      file: await open(target, constants.O_RDONLY | constants.O_NOFOLLOW),
      attachment: publicFile(row),
    }
  }
}
