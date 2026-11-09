import { BrowserWindow, nativeImage, type NativeImage } from 'electron'
import { MAX_CLIPBOARD_IMAGE_BYTES, MAX_CLIPBOARD_IMAGE_PIXELS } from '../../shared/clipboard'

export function nativeClipboardBitmap(bytes: Buffer): NativeImage | null {
  const image = nativeImage.createFromBuffer(bytes)
  if (image.isEmpty()) return null
  const { width, height } = image.getSize()
  if (width * height > MAX_CLIPBOARD_IMAGE_PIXELS) throw new Error('Image is too large to copy')
  return image
}

/** Run only in background: Chromium startup/decoding must never hold a synchronous IPC reply. */
export async function decodeClipboardBitmap(bytes: Buffer, mimeType: string): Promise<NativeImage> {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true },
  })
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const decode = async (): Promise<string> => {
      // Image bytes never become document markup. The decoder has no preload,
      // scripts or access to network/file resources, including SVG subresources.
      await win.loadURL(
        'data:text/html,' +
          encodeURIComponent(
            '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:">',
          ),
      )
      return win.webContents.executeJavaScript(`(async () => {
          const image = new Image();
          image.src = ${JSON.stringify(`data:${mimeType};base64,${bytes.toString('base64')}`)};
          await image.decode();
          if (!image.naturalWidth || !image.naturalHeight ||
              image.naturalWidth * image.naturalHeight > ${MAX_CLIPBOARD_IMAGE_PIXELS})
            throw new Error('Image is too large to copy');
          const canvas = document.createElement('canvas');
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
          canvas.getContext('2d').drawImage(image, 0, 0);
          const png = canvas.toDataURL('image/png');
          if (png.length > ${Math.ceil(MAX_CLIPBOARD_IMAGE_BYTES / 3) * 4 + 22})
            throw new Error('Image is too large to copy');
          return png;
        })()`)
    }
    const png = await Promise.race([
      decode(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Image decoding timed out')), 15000)
      }),
    ])
    const image = nativeImage.createFromDataURL(png)
    if (image.isEmpty()) throw new Error('Could not decode the image')
    return image
  } finally {
    clearTimeout(timer)
    win.destroy()
  }
}
