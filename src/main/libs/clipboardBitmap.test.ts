import { beforeEach, describe, expect, it, vi } from 'vitest'
import { decodeClipboardBitmap, nativeClipboardBitmap } from './clipboardBitmap'

const mocks = vi.hoisted(() => ({
  native: vi.fn(),
  png: vi.fn(),
  window: vi.fn(),
  load: vi.fn(),
  decode: vi.fn(),
  destroy: vi.fn(),
}))
vi.mock('electron', () => ({
  nativeImage: { createFromBuffer: mocks.native, createFromDataURL: mocks.png },
  BrowserWindow: mocks.window,
}))
const bitmap = { isEmpty: () => false, getSize: () => ({ width: 2, height: 2 }) }
beforeEach(() => {
  vi.resetAllMocks()
  mocks.native.mockReturnValue(bitmap)
  mocks.png.mockReturnValue(bitmap)
  mocks.window.mockImplementation(() => ({
    loadURL: mocks.load,
    webContents: { executeJavaScript: mocks.decode },
    destroy: mocks.destroy,
  }))
  mocks.decode.mockResolvedValue('data:image/png;base64,AQID')
})

describe('clipboard bitmap formats', () => {
  it('keeps PNG/JPEG on the native decoder without creating a renderer', () => {
    expect(nativeClipboardBitmap(Buffer.from([1]))).toBe(bitmap)
    expect(mocks.window).not.toHaveBeenCalled()
  })

  it.each(['image/gif', 'image/svg+xml', 'image/webp'])(
    'uses an isolated Chromium decoder for %s',
    async (type) => {
      mocks.native.mockReturnValue({ isEmpty: () => true })
      expect(await decodeClipboardBitmap(Buffer.from([1, 2, 3]), type)).toBe(bitmap)
      expect(mocks.window).toHaveBeenCalledWith({
        show: false,
        webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true },
      })
      expect(decodeURIComponent(mocks.load.mock.lastCall![0])).toContain(
        "default-src 'none'; img-src data:",
      )
      expect(mocks.decode.mock.lastCall![0]).toContain(`data:${type};base64,AQID`)
      expect(mocks.png).toHaveBeenCalledWith('data:image/png;base64,AQID')
      expect(mocks.destroy).toHaveBeenCalledOnce()
    },
  )

  it('destroys the decoder after corrupt images fail', async () => {
    mocks.native.mockReturnValue({ isEmpty: () => true })
    mocks.decode.mockRejectedValue(new Error('Invalid image'))
    await expect(decodeClipboardBitmap(Buffer.from([1]), 'image/gif')).rejects.toThrow(
      'Invalid image',
    )
    expect(mocks.destroy).toHaveBeenCalledOnce()
  })

  it('bounds stalled decoders and destroys their window', async () => {
    vi.useFakeTimers()
    try {
      mocks.native.mockReturnValue({ isEmpty: () => true })
      mocks.decode.mockReturnValue(new Promise(() => {}))
      const rejected = expect(decodeClipboardBitmap(Buffer.from([1]), 'image/gif')).rejects.toThrow(
        'Image decoding timed out',
      )
      await vi.advanceTimersByTimeAsync(15000)
      await rejected
      expect(mocks.destroy).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects excessive pixel counts without launching another decoder', () => {
    mocks.native.mockReturnValue({
      isEmpty: () => false,
      getSize: () => ({ width: 10000, height: 10000 }),
    })
    expect(() => nativeClipboardBitmap(Buffer.from([1]))).toThrow('too large')
    expect(mocks.window).not.toHaveBeenCalled()
  })
})
