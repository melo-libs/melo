import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import * as fs from 'node:fs/promises'
import { expect, it, vi } from 'vitest'
import { MemoryService } from './memory'

vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>()
  return { ...actual, rename: vi.fn(actual.rename) }
})

it('refuses workspace memory symlinks instead of sending outside files to a provider', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'melo-memory-'))
  try {
    const workspace = path.join(root, 'workspace')
    const user = path.join(root, 'user')
    await mkdir(workspace)
    await mkdir(user)
    await mkdir(path.join(workspace, '.melo'))
    await writeFile(path.join(root, 'private.txt'), 'Private')
    await symlink(path.join(root, 'private.txt'), path.join(workspace, '.melo/memory.md'))
    const memory = new MemoryService(user)
    await expect(memory.read(workspace)).rejects.toThrow()
    await expect(memory.write(workspace, 'workspace', 'Overwrite')).rejects.toThrow()
    await rm(path.join(workspace, '.melo'), { recursive: true })
    await symlink(user, path.join(workspace, '.melo'))
    await expect(memory.read(workspace)).rejects.toThrow('symlink')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('retains the previous memory and removes staging files if atomic replacement fails', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'melo-memory-'))
  const memory = new MemoryService(path.join(root, 'user'))
  try {
    await memory.write(root, 'user', 'Previous preferences')
    vi.mocked(fs.rename).mockRejectedValueOnce(new Error('Disk unavailable'))
    await expect(memory.write(root, 'user', 'New preferences')).rejects.toThrow('Disk unavailable')
    expect((await memory.read(root)).user).toBe('Previous preferences')
    expect(await fs.readdir(path.join(root, 'user'))).toEqual(['memory.md'])
    await memory.write(root, 'user', 'New preferences')
    expect((await memory.read(root)).user).toBe('New preferences')
    expect((await fs.stat(path.join(root, 'user/memory.md'))).mode & 0o777).toBe(0o600)
  } finally {
    vi.restoreAllMocks()
    await rm(root, { recursive: true, force: true })
  }
})

it('refuses hard-linked memory without modifying the other link', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'melo-memory-'))
  try {
    await mkdir(path.join(root, '.melo'))
    await writeFile(path.join(root, 'original.md'), 'Keep')
    await fs.link(path.join(root, 'original.md'), path.join(root, '.melo/memory.md'))
    await expect(new MemoryService(root).write(root, 'workspace', 'Replace')).rejects.toThrow(
      'regular file',
    )
    expect(await fs.readFile(path.join(root, 'original.md'), 'utf8')).toBe('Keep')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
