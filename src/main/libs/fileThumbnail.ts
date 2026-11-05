import { nativeImage } from 'electron'
import { execFile, type ExecFileException } from 'node:child_process'
import { promisify } from 'node:util'
import { constants, createWriteStream } from 'node:fs'
import { mkdtemp, open, rm, type FileHandle } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import path from 'node:path'
import os from 'node:os'
import { filePreview } from '../../shared/filePreview'

const execute = promisify(execFile)
const previews = new Map<string, Promise<string | undefined>>()
const MAX_PREVIEW_SOURCE_BYTES = 128 * 1024 * 1024
const thumbnail = (bytes: Buffer): string | undefined => {
  const image = nativeImage.createFromBuffer(bytes)
  if (image.isEmpty()) return
  const size = image.getSize()
  return image
    .resize({
      width: Math.max(1, Math.round(size.width * Math.min(192 / size.width, 144 / size.height, 1))),
    })
    .toDataURL()
}

/** The caller owns the authorized handle. Preview generation never reopens an external path. */
export async function fileThumbnail(file: FileHandle, name: string): Promise<string | undefined> {
  const presentation = filePreview(name)
  if (presentation.kind === 'file') return
  const stat = await file.stat()
  if (!stat.isFile()) throw new Error('Not a regular preview source')
  if (stat.size > MAX_PREVIEW_SOURCE_BYTES) return
  const key = `${stat.dev}:${stat.ino}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}:${path.extname(name).toLowerCase()}`
  let preview = previews.get(key)
  if (!preview) {
    preview = generate(file, name)
    previews.set(key, preview)
    if (previews.size > 64) previews.delete(previews.keys().next().value!)
    // A transient IO error must remain visible and allow a later retry.
    void preview.catch(() => {
      if (previews.get(key) === preview) previews.delete(key)
    })
  }
  return preview
}

async function generate(file: FileHandle, name: string): Promise<string | undefined> {
  if (filePreview(name).kind === 'image') {
    const stat = await file.stat()
    if (stat.size <= 12 * 1024 * 1024) {
      const bytes = Buffer.alloc(stat.size)
      const { bytesRead } = await file.read(bytes, 0, bytes.length, 0)
      const preview = thumbnail(bytes.subarray(0, bytesRead))
      if (preview) return preview
    }
  }
  if (process.platform !== 'darwin') return
  const directory = await mkdtemp(path.join(os.tmpdir(), 'melo-thumbnail-'))
  // Quick Look selects its generator by extension; intake payload names are opaque UUIDs.
  const input = path.join(directory, `preview${path.extname(name).toLowerCase()}`)
  try {
    await pipeline(
      file.createReadStream({ start: 0, end: MAX_PREVIEW_SOURCE_BYTES - 1, autoClose: false }),
      createWriteStream(input, { flags: 'wx', mode: 0o600 }),
    )
    try {
      await execute('/usr/bin/qlmanage', ['-t', '-s', '384', '-o', directory, input], {
        timeout: 8000,
        maxBuffer: 256 * 1024,
      })
    } catch (error) {
      const failure = error as ExecFileException
      if (typeof failure.code === 'number' || failure.killed || failure.code === 'ENOENT') return
      throw error
    }
    let generated: FileHandle
    try {
      generated = await open(`${input}.png`, constants.O_RDONLY | constants.O_NOFOLLOW)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    try {
      const stat = await generated.stat()
      if (!stat.isFile() || stat.size > 4 * 1024 * 1024) return
      return thumbnail(await generated.readFile())
    } finally {
      await generated.close()
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
