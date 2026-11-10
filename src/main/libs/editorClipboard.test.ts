import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { writeEditorClipboard } from './editorClipboard'
import { MAX_CLIPBOARD_IMAGE_BYTES } from '../../shared/clipboard'

const mocks = vi.hoisted(() => ({
  write: vi.fn(),
  decode: vi.fn(),
  fetch: vi.fn(),
  html: vi.fn(),
  notify: vi.fn(),
  backgroundDecode: vi.fn(),
}))
vi.mock('./clipboardBitmap', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./clipboardBitmap')>()),
  decodeClipboardBitmap: mocks.backgroundDecode,
}))
vi.mock('electron', () => ({
  clipboard: { write: mocks.write, readHTML: mocks.html },
  nativeImage: { createFromBuffer: mocks.decode },
  net: { fetch: mocks.fetch },
}))
let root: string
beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'melo-clipboard-unit-')))
  await fs.mkdir(path.join(root, '.assets'))
  await fs.writeFile(path.join(root, '.assets/test.png'), Buffer.from([1, 2, 3]))
  vi.resetAllMocks()
  mocks.decode.mockReturnValue({ isEmpty: () => false, getSize: () => ({ width: 1, height: 1 }) })
  mocks.write.mockImplementation(({ html }) => mocks.html.mockReturnValue(html))
})
afterEach(async () => {
  vi.useRealTimers()
  await fs.rm(root, { recursive: true, force: true })
})
const copy = (html: string, singleImage = false) =>
  writeEditorClipboard(
    {
      html,
      text: 'Selected text',
      workspaceRoot: root,
      singleImage,
    },
    root,
    mocks.notify,
  )

const finishAsyncCopy = () => new Promise((resolve) => setImmediate(resolve))

describe('main-process image copy', () => {
  it('copies a self-contained PNG from a standalone document without a workspace', () => {
    expect(
      writeEditorClipboard(
        {
          text: 'Diagram',
          html: '<img src="data:image/png;base64,AQID">',
          workspaceRoot: '',
          singleImage: true,
        },
        null,
        mocks.notify,
      ),
    ).toEqual({ fallbackImages: 0, bitmap: 'ready' })
    expect(mocks.write).toHaveBeenCalledTimes(1)
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('still requires a workspace for local, remote and non-PNG image references', () => {
    for (const src of [
      '.assets/test.png',
      'https://example.com/a.png',
      'data:image/svg+xml;base64,AQID',
    ]) {
      expect(() =>
        writeEditorClipboard(
          {
            text: '',
            html: `<img src="${src}">`,
            workspaceRoot: '',
            singleImage: true,
          },
          null,
          mocks.notify,
        ),
      ).toThrow('Workspace changed')
    }
    expect(mocks.write).not.toHaveBeenCalled()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('embeds a local image and writes the bitmap, HTML and text exactly once', () => {
    expect(copy('<p data-pm-slice="1 1 []"><img src="app://.assets/test.png"></p>', true)).toEqual({
      fallbackImages: 0,
      bitmap: 'ready',
    })
    expect(mocks.write).toHaveBeenCalledTimes(1)
    expect(mocks.write).toHaveBeenCalledWith({
      text: 'Selected text',
      html: expect.stringContaining('data:image/png;base64,AQID'),
      image: expect.objectContaining({ isEmpty: expect.any(Function) }),
    })
    const html = mocks.write.mock.calls[0][0].html
    expect(html).toContain('data-pm-slice="1 1 []"')
    expect(html).toContain('data-melo-image-src=".assets/test.png"')
    expect(html).not.toContain('data-melo-copy-id')
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('preserves remote and data URLs in mixed selections without network or rasterization', () => {
    const html =
      '<p>Before<img src="https://example.com/a.png"><img src="data:image/gif;base64,AQID">After</p>'
    expect(copy(html)).toEqual({ fallbackImages: 0, bitmap: 'none' })
    expect(mocks.write).toHaveBeenCalledTimes(1)
    expect(mocks.write).toHaveBeenCalledWith({ text: 'Selected text', html })
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(mocks.decode).not.toHaveBeenCalled()
  })

  it('keeps original SVG/GIF/JPEG bytes in HTML', async () => {
    for (const [extension, type] of [
      ['svg', 'image/svg+xml'],
      ['gif', 'image/gif'],
      ['jpg', 'image/jpeg'],
    ]) {
      await fs.writeFile(path.join(root, `.assets/image.${extension}`), Buffer.from([4, 5, 6]))
      copy(`<p>Before<img src=".assets/image.${extension}">After</p>`)
      expect(mocks.write.mock.lastCall![0].html).toContain(`data:${type};base64,BAUG`)
    }
    expect(mocks.decode).not.toHaveBeenCalled()
  })

  it('keeps all text and good images when another image cannot be embedded', () => {
    expect(
      copy('<p>Before<img src=".assets/missing.png"><img src=".assets/test.png">After</p>'),
    ).toEqual({ fallbackImages: 1, bitmap: 'none' })
    expect(mocks.write).toHaveBeenCalledTimes(1)
    const html = mocks.write.mock.lastCall![0].html
    expect(html).toContain('Before')
    expect(html).toContain('After')
    expect(html).toContain('.assets/missing.png')
    expect(html).toContain('data:image/png;base64,AQID')
  })

  it('rejects changed workspaces without replacing the clipboard', () => {
    expect(() =>
      writeEditorClipboard(
        { text: '', html: '', singleImage: false, workspaceRoot: root + '-other' },
        root,
        mocks.notify,
      ),
    ).toThrow('Workspace changed')
    expect(mocks.write).not.toHaveBeenCalled()
  })

  it('keeps traversal and symlink escapes as references without reading outside the workspace', async () => {
    await fs.symlink(os.tmpdir(), path.join(root, 'outside'))
    expect(
      copy(
        '<p><img src="../secret.png"><img src="outside/secret.png"><img src="file:///etc/passwd"></p>',
      ),
    ).toEqual({ fallbackImages: 3, bitmap: 'none' })
    expect(mocks.write.mock.lastCall![0].html).not.toContain('data:image/')
    expect(mocks.decode).not.toHaveBeenCalled()
  })

  it('resolves escaped filenames and fragments like the app image protocol', async () => {
    await fs.writeFile(path.join(root, '.assets/a b#c.png'), Buffer.from([1, 2, 3]))
    expect(copy('<p><img src="app://.assets/a%20b%23c.png#view"></p>', true).fallbackImages).toBe(0)
    expect(mocks.write.mock.lastCall![0].image).toBeDefined()
  })

  it('bounds individual assets and aggregate encoded HTML', async () => {
    await fs.writeFile(path.join(root, '.assets/oversize.png'), '')
    await fs.truncate(path.join(root, '.assets/oversize.png'), MAX_CLIPBOARD_IMAGE_BYTES + 1)
    await fs.writeFile(path.join(root, '.assets/large.png'), Buffer.alloc(13 * 1024 * 1024))
    expect(
      copy(
        '<p><img src=".assets/large.png"><img src=".assets/large.png"><img src=".assets/oversize.png"></p>',
      ),
    ).toEqual({ fallbackImages: 2, bitmap: 'none' })
    expect(mocks.write).toHaveBeenCalledTimes(1)
    const html = mocks.write.mock.lastCall![0].html
    expect(html).toContain('data:image/png;base64,')
    expect(html).toContain('src=".assets/large.png"')
    expect(html).toContain('src=".assets/oversize.png"')
    expect(html.length).toBeLessThanOrEqual(32 * 1024 * 1024)
  })

  it('retains HTML when the bitmap exceeds the pixel limit', () => {
    mocks.decode.mockReturnValue({
      isEmpty: () => false,
      getSize: () => ({ width: 10000, height: 10000 }),
    })
    expect(copy('<p><img src=".assets/test.png"></p>', true)).toEqual({
      fallbackImages: 0,
      bitmap: 'unavailable',
    })
    expect(mocks.write.mock.lastCall![0].image).toBeUndefined()
  })

  it('returns usable local HTML before an unsupported codec finishes, then upgrades the bitmap', async () => {
    let finish!: (image: { isEmpty: () => boolean }) => void
    mocks.decode.mockReturnValue({ isEmpty: () => true })
    mocks.backgroundDecode.mockImplementation(() => new Promise((resolve) => (finish = resolve)))
    expect(copy('<p data-pm-slice="1 1 []"><img src=".assets/test.png"></p>', true)).toEqual({
      fallbackImages: 0,
      bitmap: 'pending',
    })
    expect(mocks.write).toHaveBeenCalledTimes(1)
    expect(mocks.write.mock.lastCall![0].html).toContain('data:image/png;base64,AQID')
    expect(mocks.write.mock.lastCall![0].html).toContain('data-melo-copy-id')
    expect(mocks.backgroundDecode).not.toHaveBeenCalled()
    await finishAsyncCopy()
    expect(mocks.backgroundDecode).toHaveBeenCalledWith(Buffer.from([1, 2, 3]), 'image/png')
    const bitmap = { isEmpty: () => false }
    finish(bitmap)
    await finishAsyncCopy()
    expect(mocks.write).toHaveBeenCalledTimes(2)
    expect(mocks.write.mock.lastCall![0].image).toBe(bitmap)
    expect(mocks.write.mock.lastCall![0].html).not.toContain('data-melo-copy-id')
    expect(mocks.notify).toHaveBeenLastCalledWith('copied')
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it.each(['external', 'Melo'])(
    'protects a newer %s copy while a local codec is pending',
    async (source) => {
      let finish!: (image: { isEmpty: () => boolean }) => void
      mocks.decode.mockReturnValue({ isEmpty: () => true })
      mocks.backgroundDecode.mockImplementation(() => new Promise((resolve) => (finish = resolve)))
      copy('<p><img src="data:image/gif;base64,AQID"></p>', true)
      await finishAsyncCopy()
      if (source === 'external') mocks.html.mockReturnValue('<p>New external copy</p>')
      else copy('<p>New Melo copy</p>')
      const writes = mocks.write.mock.calls.length
      finish({ isEmpty: () => false })
      await finishAsyncCopy()
      expect(mocks.write).toHaveBeenCalledTimes(writes)
      expect(mocks.notify).not.toHaveBeenCalled()
    },
  )

  it('retains local embedded HTML when background decoding fails', async () => {
    mocks.decode.mockReturnValue({ isEmpty: () => true })
    mocks.backgroundDecode.mockRejectedValue(new Error('Invalid image'))
    expect(copy('<p><img src="data:image/gif;base64,AQID"></p>', true).bitmap).toBe('pending')
    await finishAsyncCopy()
    expect(mocks.write).toHaveBeenCalledTimes(1)
    expect(mocks.write.mock.lastCall![0].html).toContain('data:image/gif;base64,AQID')
    expect(mocks.notify).toHaveBeenCalledWith('failed')
  })

  it('propagates the initial write failure without starting background decoding', async () => {
    mocks.decode.mockReturnValue({ isEmpty: () => true })
    mocks.write.mockImplementation(() => {
      throw new Error('Clipboard unavailable')
    })
    expect(() => copy('<p><img src=".assets/test.png"></p>', true)).toThrow('Clipboard unavailable')
    await finishAsyncCopy()
    expect(mocks.backgroundDecode).not.toHaveBeenCalled()
  })

  it('decodes an existing data URL synchronously for a single image', () => {
    expect(copy('<p><img src="data:image/png;base64,AQID"></p>', true).bitmap).toBe('ready')
    expect(mocks.write.mock.lastCall![0].image).toBeDefined()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('only upgrades a single remote image and reports slow work after half a second', async () => {
    vi.useFakeTimers()
    let resolve!: (response: Response) => void
    mocks.fetch.mockImplementation(
      () =>
        new Promise<Response>((finish) => {
          resolve = finish
        }),
    )
    expect(
      copy('<p data-pm-slice="1 1 []"><img src="https://example.com/a.png"></p>', true),
    ).toEqual({ fallbackImages: 0, bitmap: 'pending' })
    expect(mocks.write).toHaveBeenCalledTimes(1)
    expect(mocks.write.mock.lastCall![0].html).toContain('data-melo-copy-id')
    await vi.advanceTimersByTimeAsync(499)
    expect(mocks.notify).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(mocks.notify).toHaveBeenCalledWith('copying')
    resolve(new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } }))
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.write).toHaveBeenCalledTimes(2)
    expect(mocks.write.mock.lastCall![0].image).toBeDefined()
    expect(mocks.write.mock.lastCall![0].html).toContain('data:image/png;base64,AQID')
    expect(mocks.notify).toHaveBeenLastCalledWith('copied')
  })

  it('does not overwrite content copied in another application during a download', async () => {
    let resolve!: (response: Response) => void
    mocks.fetch.mockImplementation(
      () =>
        new Promise<Response>((finish) => {
          resolve = finish
        }),
    )
    copy('<p><img src="https://example.com/a.png"></p>', true)
    await finishAsyncCopy()
    mocks.html.mockReturnValue('<p>New clipboard from another app</p>')
    resolve(new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } }))
    await finishAsyncCopy()
    expect(mocks.write).toHaveBeenCalledTimes(1)
    expect(mocks.decode).not.toHaveBeenCalled()
    expect(mocks.notify).not.toHaveBeenCalled()
  })

  it('does not overwrite a newer Melo copy', async () => {
    let resolve!: (response: Response) => void
    mocks.fetch.mockImplementation(
      () =>
        new Promise<Response>((finish) => {
          resolve = finish
        }),
    )
    copy('<p><img src="https://example.com/a.png"></p>', true)
    await finishAsyncCopy()
    copy('<p>New<img src=".assets/test.png"></p>')
    resolve(new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } }))
    await finishAsyncCopy()
    expect(mocks.write).toHaveBeenCalledTimes(2)
    expect(mocks.write.mock.lastCall![0].html).toContain('New')
  })

  it('keeps reference content when a remote image fails or is oversized', async () => {
    mocks.fetch.mockRejectedValueOnce(new Error('Offline'))
    copy('<p><img src="https://example.com/missing.png"></p>', true)
    await vi.waitFor(() => expect(mocks.notify).toHaveBeenCalledWith('failed'))
    expect(mocks.write).toHaveBeenCalledTimes(1)
    mocks.notify.mockClear()
    mocks.fetch.mockResolvedValueOnce(new Response(new Uint8Array(MAX_CLIPBOARD_IMAGE_BYTES + 1)))
    copy('<p><img src="https://example.com/large.png"></p>', true)
    await vi.waitFor(() => expect(mocks.notify).toHaveBeenCalledWith('failed'))
    expect(mocks.write).toHaveBeenCalledTimes(2)
    expect(mocks.decode).not.toHaveBeenCalled()
  })

  it('rejects credentials in remote image URLs before fetching', async () => {
    copy('<p><img src="https://user:password@example.com/a.png"></p>', true)
    await vi.waitFor(() => expect(mocks.notify).toHaveBeenCalledWith('failed'))
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('rejects invalid IPC data before writing', () => {
    expect(() => writeEditorClipboard({ text: 1, html: '' }, root, mocks.notify)).toThrow()
    expect(mocks.write).not.toHaveBeenCalled()
  })
})
