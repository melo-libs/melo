import { IpcChannels } from '@shared/types/ipc'
import { clipboardWriteGuard } from '../../lib/clipboard'
import {
  MAX_CLIPBOARD_HTML_LENGTH,
  MAX_CLIPBOARD_IMAGE_BYTES,
  type ClipboardWriteCondition,
} from '@shared/clipboard'

function workspaceKey(root: string): string {
  let hash = 5381
  for (const character of root) hash = (Math.imul(hash, 33) ^ character.charCodeAt(0)) >>> 0
  return hash.toString(16)
}

/** The public HTML contains embedded pixels; our own paste can reuse its workspace asset. */
export function originalClipboardImageSrc(
  element: HTMLElement,
  workspaceRoot: string,
): string | null {
  const src = element.getAttribute('data-melo-image-src')
  if (!src || element.getAttribute('data-melo-image-workspace') !== workspaceKey(workspaceRoot))
    return null
  if (
    /^[a-z][a-z\d+.-]*:/i.test(src) ||
    src.startsWith('/') ||
    src.includes('\\') ||
    /(^|\/)\.\.(\/|$)/.test(src)
  )
    return null
  return src
}

function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

async function readImage(src: string, workspaceRoot: string): Promise<Blob> {
  if (/^data:image\//i.test(src)) {
    const blob = await (await fetch(src)).blob()
    if (blob.size > MAX_CLIPBOARD_IMAGE_BYTES) throw new Error('Image is too large to copy')
    return blob
  }
  const result = await window.api.invoke(IpcChannels.InvokeReadClipboardImage, {
    src,
    workspaceRoot,
  })
  if (!result.success || !result.data) throw new Error(result.error || 'Could not load image')
  return new Blob([new Uint8Array(result.data.data)], { type: result.data.mimeType })
}

async function pngImage(src: string): Promise<Uint8Array> {
  const image = new Image()
  image.src = src
  await image.decode()
  if (image.naturalWidth * image.naturalHeight > 32 * 1024 * 1024)
    throw new Error('Image is too large to copy')
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  canvas.getContext('2d')!.drawImage(image, 0, 0)
  const png = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not copy image'))),
      'image/png',
    ),
  )
  if (png.size > MAX_CLIPBOARD_IMAGE_BYTES) throw new Error('Image is too large to copy')
  return new Uint8Array(await png.arrayBuffer())
}

type ImageCopyMode = { type: 'selection'; singleImage: boolean; copyId: string } | { type: 'image' }

export async function writeImageClipboard(
  root: HTMLElement,
  text: string,
  workspaceRoot: string,
  mode: ImageCopyMode,
): Promise<{ copied: boolean; fallbackImages: number }> {
  const isCurrent = clipboardWriteGuard()
  const selection = mode.type === 'selection'
  const singleImage = mode.type === 'image' || mode.singleImage
  let condition: ClipboardWriteCondition
  if (mode.type === 'selection') {
    condition = { expectedCopyId: mode.copyId }
  } else {
    const stamp = await window.api.invoke(IpcChannels.InvokeGetClipboardStamp, undefined)
    if (!stamp.success || !stamp.data)
      throw new Error(stamp.error || 'Could not read clipboard state')
    condition = { expectedStamp: stamp.data }
  }
  let image: Uint8Array | undefined
  let fallbackImages = 0
  let embedded = false
  let htmlLength = root.innerHTML.length
  if (selection && htmlLength > MAX_CLIPBOARD_HTML_LENGTH)
    return { copied: false, fallbackImages: root.querySelectorAll('img').length }

  for (const element of Array.from(root.querySelectorAll('img'))) {
    if (!isCurrent()) return { copied: false, fallbackImages: 0 }
    const src = element.getAttribute('src') ?? ''
    // Public URLs and existing data URLs are already usable HTML. A mixed
    // selection never needs to download them just to copy its text.
    if (selection && !singleImage && /^(?:https?:|data:image\/)/i.test(src)) continue
    let fallback = false
    try {
      const blob = await readImage(src, workspaceRoot)
      let uri = await dataUrl(blob)
      if (singleImage) {
        try {
          image = await pngImage(uri)
        } catch (error) {
          if (!selection) throw error
          fallback = true
        }
      }
      if (!blob.type.startsWith('image/')) {
        if (!image) throw new Error('Unknown image format')
        uri = await dataUrl(new Blob([new Uint8Array(image)], { type: 'image/png' }))
      }
      const replacement = element.cloneNode(true) as HTMLImageElement
      replacement.src = uri
      const relative = src.startsWith('app://') ? src.slice(6) : src
      if (!/^[a-z][a-z\d+.-]*:/i.test(relative)) {
        replacement.setAttribute('data-melo-image-src', relative)
        replacement.setAttribute('data-melo-image-workspace', workspaceKey(workspaceRoot))
      }
      const nextLength = htmlLength - element.outerHTML.length + replacement.outerHTML.length
      if (nextLength > MAX_CLIPBOARD_HTML_LENGTH) {
        if (!selection) throw new Error('Clipboard HTML is too large')
        fallback = true
        continue
      }
      element.replaceWith(replacement)
      embedded = true
      htmlLength = nextLength
    } catch (error) {
      if (!selection) throw error
      fallback = true
    } finally {
      if (fallback) fallbackImages++
    }
  }
  if (!isCurrent()) return { copied: false, fallbackImages: 0 }
  // References already exist in the synchronous native payload. No second
  // write is needed when none of the images could (or needed to) be embedded.
  if (selection && !embedded && !image) return { copied: true, fallbackImages }
  const result = await window.api.invoke(IpcChannels.InvokeWriteClipboard, {
    text,
    html: root.innerHTML,
    image,
    ...condition,
  })
  if (!result.success) throw new Error(result.error || 'Could not copy')
  return { copied: result.data === true, fallbackImages: result.data ? fallbackImages : 0 }
}
