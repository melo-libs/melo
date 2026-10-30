import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, realpath, rename, rm } from 'node:fs/promises'
import path from 'node:path'

export class MemoryService {
  constructor(private readonly userDirectory: string) {}

  async read(workspaceRoot: string): Promise<{ user: string; workspace: string }> {
    const [user, workspace] = await Promise.all([
      this.readScope(this.userDirectory),
      this.readScope(path.join(workspaceRoot, '.melo')),
    ])
    return { user, workspace }
  }

  async write(workspaceRoot: string, scope: 'user' | 'workspace', content: string): Promise<void> {
    const directory = scope === 'user' ? this.userDirectory : path.join(workspaceRoot, '.melo')
    await mkdir(directory, { recursive: true })
    await assertDirectory(directory)
    const destination = path.join(directory, 'memory.md')
    await assertMemoryFile(destination)
    const temporary = path.join(directory, `.memory-${randomUUID()}.tmp`)
    try {
      const file = await open(
        temporary,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      )
      try {
        await file.writeFile(content)
        await file.sync()
      } finally {
        await file.close()
      }
      // Replace only after the complete new memory is durable; failed writes
      // leave the previous file intact, including its access restrictions.
      await assertDirectory(directory)
      await assertMemoryFile(destination)
      await rename(temporary, destination)
    } finally {
      await rm(temporary, { force: true })
    }
  }

  private async readScope(directory: string): Promise<string> {
    try {
      await assertDirectory(directory)
      const file = await open(
        path.join(directory, 'memory.md'),
        constants.O_RDONLY | constants.O_NOFOLLOW,
      )
      try {
        const stat = await file.stat()
        if (!stat.isFile() || stat.nlink !== 1 || stat.size > 64 * 1024)
          throw new Error('Invalid memory file')
        return await file.readFile('utf8')
      } finally {
        await file.close()
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
      throw error
    }
  }
}

async function assertDirectory(directory: string): Promise<void> {
  const parent = await realpath(path.dirname(directory))
  if ((await realpath(directory)) !== path.join(parent, path.basename(directory)))
    throw new Error('Memory directory must not be a symlink')
}

async function assertMemoryFile(file: string): Promise<void> {
  try {
    const metadata = await lstat(file)
    if (!metadata.isFile() || metadata.nlink !== 1)
      throw new Error('Memory must be an unlinked regular file')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}
