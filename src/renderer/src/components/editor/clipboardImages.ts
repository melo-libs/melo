import { IpcChannels } from '@shared/types/ipc'
import { clipboardWriteGuard } from '../../lib/clipboard'

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

async function pngImage(src: string, workspaceRoot: string): Promise<Blob> {
  let blob: Blob
  if (/^data:image\//i.test(src)) {
    blob = await (await fetch(src)).blob()
  } else {
    const result = await window.api.invoke(IpcChannels.InvokeReadClipboardImage, {
      src,
      workspaceRoot,
    })
    if (!result.success || !result.data) throw new Error(result.error || 'Could not load image')
    blob = new Blob([new Uint8Array(result.data.data)], { type: result.data.mimeType })
  }
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
  const image = new Image()
  image.src = dataUrl
  await image.decode()
  if (image.naturalWidth * image.naturalHeight > 32 * 1024 * 1024)
    throw new Error('Image is too large to copy')
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const context = canvas.getContext('2d')!
  context.drawImage(image, 0, 0)
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (png) => (png ? resolve(png) : reject(new Error('Could not copy image'))),
      'image/png',
    ),
  )
}

export async function writeImageClipboard(
  root: HTMLElement,
  text: string,
  workspaceRoot: string,
  singleImage: boolean,
): Promise<boolean> {
  const isCurrent = clipboardWriteGuard()
  const stamp = await window.api.invoke(IpcChannels.InvokeGetClipboardStamp, undefined)
  if (!stamp.success || !stamp.data)
    throw new Error(stamp.error || 'Could not read clipboard state')
  let image: Uint8Array | undefined
  for (const element of Array.from(root.querySelectorAll('img'))) {
    const src = element.getAttribute('src') ?? ''
    const png = await pngImage(src, workspaceRoot)
    const bytes = new Uint8Array(await png.arrayBuffer())
    if (singleImage) image = bytes
    const relative = src.startsWith('app://') ? src.slice(6) : src
    if (!/^[a-z][a-z\d+.-]*:/i.test(relative)) {
      element.setAttribute('data-melo-image-src', relative)
      element.setAttribute('data-melo-image-workspace', workspaceKey(workspaceRoot))
    }
    element.src = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(png)
    })
  }
  if (!isCurrent()) return false
  const result = await window.api.invoke(IpcChannels.InvokeWriteClipboard, {
    text,
    html: root.innerHTML,
    image,
    expectedStamp: stamp.data,
  })
  if (!result.success) throw new Error(result.error || 'Could not copy')
  return result.data === true
}
