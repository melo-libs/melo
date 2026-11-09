import { beforeEach, describe, expect, it, vi } from 'vitest'
import { downloadClipboardImage } from './clipboardImageDownload'
import { MAX_CLIPBOARD_IMAGE_BYTES } from '../../shared/clipboard'

const fetchImage = vi.hoisted(() => vi.fn())
vi.mock('electron', () => ({ net: { fetch: fetchImage } }))
beforeEach(() => vi.resetAllMocks())

describe('clipboard image downloads', () => {
  it.each(['image/png; charset=binary', 'application/octet-stream', null])(
    'accepts image bytes with %s content type',
    async (type) => {
      fetchImage.mockResolvedValue(
        new Response(new Uint8Array([1, 2, 3]), {
          headers: type ? { 'content-type': type } : {},
        }),
      )
      expect(await downloadClipboardImage('https://example.com/image.png')).toEqual({
        bytes: Buffer.from([1, 2, 3]),
        mimeType: 'image/png',
      })
    },
  )

  it.each(['text/html', 'application/json'])('rejects %s before reading its body', async (type) => {
    const response = new Response('Not an image', { headers: { 'content-type': type } })
    const read = vi.spyOn(response.body!, 'getReader')
    const cancel = vi.spyOn(response.body!, 'cancel')
    fetchImage.mockResolvedValue(response)
    await expect(downloadClipboardImage('https://example.com/image.png')).rejects.toThrow(
      'did not return an image',
    )
    expect(read).not.toHaveBeenCalled()
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('uses Chromium redirect handling with a bounded request deadline', async () => {
    fetchImage.mockResolvedValue(
      new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/png' } }),
    )
    await downloadClipboardImage('https://example.com/image.png')
    expect(fetchImage).toHaveBeenCalledWith('https://example.com/image.png', {
      redirect: 'follow',
      signal: expect.any(AbortSignal),
    })
  })

  it.each(['https://user:password@example.com/image.png', 'file:///private/image.png'])(
    'rejects unsafe initial URLs: %s',
    async (url) => {
      await expect(downloadClipboardImage(url)).rejects.toThrow('HTTP(S) without credentials')
      expect(fetchImage).not.toHaveBeenCalled()
    },
  )

  it('rejects declared oversized responses before reading and cancels the reader', async () => {
    const response = new Response(new Uint8Array([1]), {
      headers: {
        'content-type': 'image/png',
        'content-length': String(MAX_CLIPBOARD_IMAGE_BYTES + 1),
      },
    })
    const reader = response.body!.getReader()
    const read = vi.spyOn(reader, 'read')
    const cancel = vi.spyOn(reader, 'cancel')
    vi.spyOn(response.body!, 'getReader').mockReturnValue(reader)
    fetchImage.mockResolvedValue(response)
    await expect(downloadClipboardImage('https://example.com/image.png')).rejects.toThrow(
      'too large',
    )
    expect(read).not.toHaveBeenCalled()
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('bounds streamed data even when content-length is absent', async () => {
    fetchImage.mockResolvedValue(
      new Response(new Uint8Array(MAX_CLIPBOARD_IMAGE_BYTES + 1), {
        headers: { 'content-type': 'image/png' },
      }),
    )
    await expect(downloadClipboardImage('https://example.com/image.png')).rejects.toThrow(
      'too large',
    )
  })
})
