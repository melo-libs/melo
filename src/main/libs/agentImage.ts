import { constants } from 'node:fs'
import { open, realpath, type FileHandle } from 'node:fs/promises'
import path from 'node:path'
import mime from 'mime-types'
import { agentImageSource, MAX_AGENT_IMAGE_BYTES } from '../../shared/agentImages'

export async function readAgentImage(root: string, source: string): Promise<string> {
  const image = agentImageSource(source)
  if (image?.kind !== 'workspace') throw new Error('Use a workspace-relative image path')
  const canonicalRoot = await realpath(root)
  const target = path.resolve(canonicalRoot, image.path)
  const canonical = await realpath(target)
  if (canonical !== target || !canonical.startsWith(canonicalRoot + path.sep))
    throw new Error('Image is outside the workspace')
  const file = await open(canonical, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    return await readAgentImageFile(file, image.path)
  } finally {
    await file.close()
  }
}

export async function readAgentImageFile(file: FileHandle, name: string): Promise<string> {
  if (!agentImageSource(`image${path.extname(name)}`)) throw new Error('Unsupported image type')
  const stat = await file.stat()
  if (!stat.isFile()) throw new Error('Not an image file')
  if (stat.size > MAX_AGENT_IMAGE_BYTES) throw new Error('Image exceeds the 20 MB limit')
  // Read a bounded range even if another process grows the file after stat.
  const bytes = Buffer.alloc(Math.min(stat.size + 1, MAX_AGENT_IMAGE_BYTES + 1))
  let size = 0
  while (size < bytes.length) {
    const { bytesRead } = await file.read(bytes, size, bytes.length - size, size)
    if (!bytesRead) break
    size += bytesRead
  }
  if (size !== stat.size) throw new Error('Image changed while loading')
  return `data:${mime.lookup(name)};base64,${bytes.subarray(0, size).toString('base64')}`
}
