import { mkdtemp, mkdir, open, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { readAgentImage, readAgentImageFile } from './agentImage'
import { MAX_AGENT_IMAGE_BYTES } from '../../shared/agentImages'

let directory: string
let root: string
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'melo-agent-image-'))
  root = path.join(directory, 'workspace')
  await mkdir(path.join(root, '.assets'), { recursive: true })
})
afterEach(async () => rm(directory, { recursive: true, force: true }))

it('keeps original image bytes, including GIF animation, in the returned data URL', async () => {
  const bytes = Buffer.from('GIF89a')
  await writeFile(path.join(root, '.assets/图片.gif'), bytes)
  expect(await readAgentImage(root, '.assets/%E5%9B%BE%E7%89%87.gif')).toBe(
    `data:image/gif;base64,${bytes.toString('base64')}`,
  )
})

it('rejects traversal, symbolic links and non-image sources', async () => {
  await writeFile(path.join(directory, 'secret.png'), 'private')
  await symlink(path.join(directory, 'secret.png'), path.join(root, 'linked.png'))
  for (const source of [
    '../secret.png',
    'linked.png',
    '.melo/secret.png',
    'note.md',
    'file:///x.png',
  ])
    await expect(readAgentImage(root, source)).rejects.toThrow()
})

it('refuses oversized images before reading them and rejects non-image attachment handles', async () => {
  const file = await open(path.join(root, 'large.png'), 'w+')
  try {
    await file.truncate(MAX_AGENT_IMAGE_BYTES + 1)
    await expect(readAgentImage(root, 'large.png')).rejects.toThrow('20 MB')
    await expect(readAgentImageFile(file, 'notes.html')).rejects.toThrow('Unsupported image type')
  } finally {
    await file.close()
  }
})
