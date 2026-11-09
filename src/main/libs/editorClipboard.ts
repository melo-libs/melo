import { clipboard, net, type NativeImage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { parseHTML } from 'linkedom'
import { z } from 'zod'
import mime from 'mime-types'
import {
  CLIPBOARD_COPY_ID_ATTRIBUTE,
  CLIPBOARD_IMAGE_SOURCE_ATTRIBUTE,
  CLIPBOARD_IMAGE_WORKSPACE_ATTRIBUTE,
  MAX_CLIPBOARD_HTML_LENGTH,
  MAX_CLIPBOARD_IMAGE_BYTES,
  MAX_CLIPBOARD_TEXT_LENGTH,
  clipboardWorkspaceKey,
  type ClipboardImageCopyStatus,
  type EditorClipboardResult,
} from '../../shared/clipboard'
import { decodeClipboardBitmap, nativeClipboardBitmap } from './clipboardBitmap'

const contentSchema = z.object({
  text: z.string().max(MAX_CLIPBOARD_TEXT_LENGTH),
  html: z.string().max(MAX_CLIPBOARD_HTML_LENGTH),
  workspaceRoot: z.string().min(1),
  singleImage: z.boolean(),
})

function workspaceImage(src: string, root: string) {
  const relative = decodeURIComponent(
    (src.startsWith('app://') ? src.slice(6) : src).replace(/#.*$/, ''),
  )
  if (path.isAbsolute(relative) || /^[a-z][a-z\d+.-]*:/i.test(relative))
    throw new Error('Image must be inside the workspace')
  const file = fs.realpathSync(path.resolve(root, relative))
  if (!file.startsWith(root + path.sep)) throw new Error('Image is outside the workspace')
  return { file, bytes: fs.statSync(file).size }
}

async function downloadImage(src: string): Promise<{ bytes: Buffer; mimeType: string }> {
  const url = new URL(src)
  if (url.username || url.password) throw new Error('Image URL must not contain credentials')
  const response = await net.fetch(url.href, { signal: AbortSignal.timeout(15000) })
  if (!response.ok || !response.body) throw new Error('Could not load the image')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    if (Number(response.headers.get('content-length')) > MAX_CLIPBOARD_IMAGE_BYTES)
      throw new Error('Image is too large to copy')
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_CLIPBOARD_IMAGE_BYTES) throw new Error('Image is too large to copy')
      chunks.push(value)
    }
  } finally {
    await reader.cancel()
  }
  return {
    bytes: Buffer.concat(chunks),
    mimeType:
      response.headers.get('content-type')?.split(';')[0].toLowerCase() ||
      mime.lookup(url.pathname) ||
      'application/octet-stream',
  }
}

async function completeImageCopy(
  source: string | { bytes: Buffer; mimeType: string },
  copyId: string,
  content: { text: string; html: string },
  notify: (status: ClipboardImageCopyStatus) => void,
): Promise<void> {
  const current = () => clipboard.readHTML().includes(`${CLIPBOARD_COPY_ID_ATTRIBUTE}="${copyId}"`)
  if (!current()) return
  const timer = setTimeout(() => {
    if (current()) notify('copying')
  }, 500)
  try {
    const { bytes, mimeType } = typeof source === 'string' ? await downloadImage(source) : source
    if (!current()) return
    const image = nativeClipboardBitmap(bytes) ?? (await decodeClipboardBitmap(bytes, mimeType))
    const { document } = parseHTML(`<html><body>${content.html}</body></html>`)
    document.body
      .querySelector('img')!
      .setAttribute(
        'src',
        mimeType.startsWith('image/')
          ? `data:${mimeType};base64,${bytes.toString('base64')}`
          : image.toDataURL(),
      )
    const html = document.body.innerHTML
    if (!current()) return
    clipboard.write({
      ...content,
      html: html.length <= MAX_CLIPBOARD_HTML_LENGTH ? html : content.html,
      image,
    })
    notify('copied')
  } catch {
    // The reference payload was already copied successfully; leave it intact.
    if (current()) notify('failed')
  } finally {
    clearTimeout(timer)
  }
}

/** Acknowledge usable content immediately; downloads and non-native codecs finish in background. */
export function writeEditorClipboard(
  input: unknown,
  workspaceRoot: string | null,
  notify: (status: ClipboardImageCopyStatus) => void,
): EditorClipboardResult {
  const content = contentSchema.parse(input)
  if (!workspaceRoot || path.resolve(workspaceRoot) !== path.resolve(content.workspaceRoot))
    throw new Error('Workspace changed while copying')
  const { document } = parseHTML(`<html><body>${content.html}</body></html>`)
  const images = Array.from(document.body.querySelectorAll('img'))
  const single = content.singleImage && images.length === 1
  const src = single ? (images[0].getAttribute('src') ?? '') : ''
  let pendingImage: string | { bytes: Buffer; mimeType: string } | undefined =
    single && /^https?:\/\//i.test(src) ? src : undefined
  const root = fs.realpathSync(workspaceRoot)
  let htmlLength = document.body.innerHTML.length
  let fallbackImages = 0
  let image: NativeImage | null = null
  for (const element of images) {
    const source = element.getAttribute('src') ?? ''
    if (/^https?:\/\//i.test(source)) continue
    try {
      if (/^data:image\//i.test(source)) {
        if (single) {
          const comma = source.indexOf(',')
          if (!/^data:image\/[^;,]+;base64,/i.test(source)) throw new Error('Invalid image data')
          const encoded = source.slice(comma + 1)
          if (encoded.length > Math.ceil(MAX_CLIPBOARD_IMAGE_BYTES / 3) * 4)
            throw new Error('Image is too large to copy')
          const bytes = Buffer.from(encoded, 'base64')
          if (bytes.length > MAX_CLIPBOARD_IMAGE_BYTES)
            throw new Error('Image is too large to copy')
          image = nativeClipboardBitmap(bytes)
          if (!image) pendingImage = { bytes, mimeType: source.slice(5, source.indexOf(';')) }
        }
        continue
      }
      const asset = workspaceImage(source, root)
      if (asset.bytes > MAX_CLIPBOARD_IMAGE_BYTES) throw new Error('Image is too large to copy')
      // Check before reading/encoding so a selection of large photos stays bounded.
      if (htmlLength + Math.ceil(asset.bytes / 3) * 4 > MAX_CLIPBOARD_HTML_LENGTH)
        throw new Error('Clipboard HTML is too large')
      const bytes = fs.readFileSync(asset.file)
      if (bytes.length > MAX_CLIPBOARD_IMAGE_BYTES) throw new Error('Image is too large to copy')
      const mimeType = mime.lookup(asset.file)
      if (!mimeType || !mimeType.startsWith('image/')) throw new Error('Unknown image format')
      const replacement = element.cloneNode(true) as typeof element
      replacement.setAttribute('src', `data:${mimeType};base64,${bytes.toString('base64')}`)
      replacement.setAttribute(
        CLIPBOARD_IMAGE_SOURCE_ATTRIBUTE,
        source.startsWith('app://') ? source.slice(6) : source,
      )
      replacement.setAttribute(
        CLIPBOARD_IMAGE_WORKSPACE_ATTRIBUTE,
        clipboardWorkspaceKey(workspaceRoot),
      )
      const nextLength = htmlLength - element.outerHTML.length + replacement.outerHTML.length
      if (nextLength > MAX_CLIPBOARD_HTML_LENGTH) throw new Error('Clipboard HTML is too large')
      element.replaceWith(replacement)
      htmlLength = nextLength
      if (single) {
        image = nativeClipboardBitmap(bytes)
        if (!image) pendingImage = { bytes, mimeType }
      }
    } catch {
      fallbackImages++
    }
  }
  const copyId = pendingImage ? randomUUID() : undefined
  if (copyId) document.body.firstElementChild!.setAttribute(CLIPBOARD_COPY_ID_ATTRIBUTE, copyId)
  const payload = {
    text: content.text,
    html: document.body.innerHTML,
    ...(image ? { image } : {}),
  }
  clipboard.write(payload)
  if (pendingImage && copyId) {
    const source = pendingImage
    setImmediate(() => void completeImageCopy(source, copyId, payload, notify))
  }
  return { fallbackImages, pending: Boolean(pendingImage) }
}
