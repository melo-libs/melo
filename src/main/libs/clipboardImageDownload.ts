import { net } from 'electron'
import mime from 'mime-types'
import { MAX_CLIPBOARD_IMAGE_BYTES } from '../../shared/clipboard'

export async function downloadClipboardImage(
  src: string,
): Promise<{ bytes: Buffer; mimeType: string }> {
  const url = new URL(src)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('Image URL must be HTTP(S) without credentials')
  // Electron 31's manual mode rejects redirects instead of returning their
  // response. Chromium follow mode already bounds redirect loops.
  const response = await net.fetch(url.href, {
    signal: AbortSignal.timeout(15000),
    redirect: 'follow',
  })
  const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()
  // Some image CDNs send generic binary data. Reject known non-image
  // responses early while leaving binary responses to the image decoder.
  if (
    !response.ok ||
    !response.body ||
    (type && !type.startsWith('image/') && type !== 'application/octet-stream')
  ) {
    await response.body?.cancel()
    throw new Error('The server did not return an image')
  }
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
    mimeType: type?.startsWith('image/')
      ? type
      : mime.lookup(url.pathname) || 'application/octet-stream',
  }
}
