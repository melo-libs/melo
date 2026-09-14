import fs from 'fs-extra'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listDirectoryContents } from './fileOperations'

let root: string

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'melo-tree-'))
})

afterEach(() => {
  fs.removeSync(root)
  vi.restoreAllMocks()
})

describe('listDirectoryContents', () => {
  it('does not follow directory symlinks and tolerates dangling links', async () => {
    const realFolder = path.join(root, 'Notes')
    fs.ensureDirSync(realFolder)
    fs.writeFileSync(path.join(realFolder, 'inside.md'), '# Inside')
    fs.symlinkSync(realFolder, path.join(root, 'Linked Notes'))
    fs.symlinkSync(path.join(root, 'missing-target'), path.join(root, 'missing.md'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const tree = await listDirectoryContents(root)
    const linked = tree.find((node) => node.name === 'Linked Notes')
    const dangling = tree.find((node) => node.name === 'missing.md')

    expect(tree.find((node) => node.name === 'Notes')?.children).toHaveLength(1)
    expect(linked).toMatchObject({ isDirectory: false })
    expect(linked?.children).toBeUndefined()
    expect(dangling).toMatchObject({ isDirectory: false })
    expect(warn).not.toHaveBeenCalled()
  })

  it('shares one in-flight scan for the same root', async () => {
    fs.writeFileSync(path.join(root, 'note.md'), '# Note')

    const first = listDirectoryContents(root)
    const second = listDirectoryContents(root)

    expect(second).toBe(first)
    await expect(first).resolves.toHaveLength(1)
  })
})
