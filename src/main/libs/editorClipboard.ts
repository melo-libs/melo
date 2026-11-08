import { clipboard, nativeImage, net } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import mime from 'mime-types'
import { createHash } from 'node:crypto'

const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const sourceSchema = z.object({
  src: z.string().min(1).max(32768),
  workspaceRoot: z.string().min(1),
})
const clipboardSchema = z.object({
  text: z.string().max(2 * 1024 * 1024),
  html: z.string().max(32 * 1024 * 1024),
  image: z.instanceof(Uint8Array).optional(),
  expectedStamp: z.string().regex(/^[a-f\d]{64}$/),
})

/** Compare clipboard contents across an asynchronous image load, even outside Melo. */
export function clipboardStamp(): string {
  const hash = createHash('sha256')
  for (const format of clipboard.availableFormats().sort()) {
    // macOS normalizes standard types in availableFormats(), but readBuffer()
    // expects native/custom names. Use the typed readers for those MIME types.
    let bytes: Buffer
    if (format === 'text/plain') bytes = Buffer.from(clipboard.readText())
    else if (format === 'text/html') bytes = Buffer.from(clipboard.readHTML())
    else if (format === 'text/rtf') bytes = Buffer.from(clipboard.readRTF())
    else if (format.startsWith('image/')) bytes = clipboard.readImage().toPNG()
    else bytes = clipboard.readBuffer(format)
    hash.update(`${format.length}:${format}:${bytes.length}:`)
    hash.update(bytes)
  }
  // Finder's file-list flavors can be absent from the normalized MIME list.
  if (process.platform === 'darwin') {
    for (const format of ['NSFilenamesPboardType', 'public.file-url']) {
      const text = clipboard.read(format)
      hash.update(`${format.length}:${format}:${Buffer.byteLength(text)}:`)
      hash.update(text)
    }
  }
  return hash.digest('hex')
}

export async function readClipboardImage(input: unknown, workspaceRoot: string | null) {
  const { src: raw, workspaceRoot: requestedRoot } = sourceSchema.parse(input)
  if (!workspaceRoot || path.resolve(workspaceRoot) !== path.resolve(requestedRoot)) {
    throw new Error('Workspace changed while copying')
  }
  if (/^https?:\/\//i.test(raw)) {
    const url = new URL(raw)
    if (url.username || url.password) throw new Error('Image URL must not contain credentials')
    const response = await net.fetch(url.href, { signal: AbortSignal.timeout(15000) })
    if (!response.ok || !response.body) throw new Error('Could not load the image')
    if (Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES) {
      await response.body.cancel()
      throw new Error('Image is too large to copy')
    }
    const chunks: Uint8Array[] = []
    let size = 0
    const reader = response.body.getReader()
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > MAX_IMAGE_BYTES) throw new Error('Image is too large to copy')
        chunks.push(value)
      }
    } finally {
      await reader.cancel()
    }
    return {
      data: Buffer.concat(chunks),
      mimeType: response.headers.get('content-type')?.split(';')[0] || 'application/octet-stream',
    }
  }
  // Match the app:// image protocol: fragments are not part of the filename,
  // while escaped reserved characters such as %23 are.
  const src = decodeURIComponent(
    (raw.startsWith('app://') ? raw.slice(6) : raw).replace(/#.*$/, ''),
  )
  if (!workspaceRoot || path.isAbsolute(src) || /^[a-z][a-z\d+.-]*:/i.test(src)) {
    throw new Error('Image must be inside the workspace')
  }
  const root = await fs.realpath(workspaceRoot)
  const file = await fs.realpath(path.resolve(root, src))
  if (!file.startsWith(root + path.sep)) throw new Error('Image is outside the workspace')
  const stat = await fs.stat(file)
  if (stat.size > MAX_IMAGE_BYTES) throw new Error('Image is too large to copy')
  return {
    data: await fs.readFile(file),
    mimeType: mime.lookup(file) || 'application/octet-stream',
  }
}

export function writeEditorClipboard(input: unknown): boolean {
  const { text, html, image: bytes, expectedStamp } = clipboardSchema.parse(input)
  if (expectedStamp !== clipboardStamp()) return false
  if (bytes && bytes.byteLength > MAX_IMAGE_BYTES) throw new Error('Image is too large to copy')
  const image = bytes ? nativeImage.createFromBuffer(Buffer.from(bytes)) : undefined
  if (image?.isEmpty()) throw new Error('Could not decode the image')
  clipboard.write({ text, html, ...(image ? { image } : {}) })
  return true
}
