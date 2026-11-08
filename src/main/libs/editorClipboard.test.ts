import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { clipboardStamp, readClipboardImage, writeEditorClipboard } from './editorClipboard'

const mocks = vi.hoisted(() => ({
  write: vi.fn(),
  decode: vi.fn(),
  fetch: vi.fn(),
  formats: vi.fn(),
  readBuffer: vi.fn(),
  text: vi.fn(),
  html: vi.fn(),
  read: vi.fn(),
}))
vi.mock('electron', () => ({
  clipboard: {
    write: mocks.write,
    availableFormats: mocks.formats,
    readBuffer: mocks.readBuffer,
    readText: mocks.text,
    readHTML: mocks.html,
    read: mocks.read,
  },
  nativeImage: { createFromBuffer: mocks.decode },
  net: { fetch: mocks.fetch },
}))
let root: string
beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'melo-clipboard-unit-')))
  vi.clearAllMocks()
  mocks.decode.mockReturnValue({ isEmpty: () => false })
  mocks.formats.mockReturnValue(['text/plain'])
  mocks.readBuffer.mockReturnValue(Buffer.from('previous clipboard'))
  mocks.text.mockReturnValue('previous clipboard')
  mocks.read.mockReturnValue('')
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('editor image clipboard boundary', () => {
  it('reads a workspace asset without copying files into the workspace', async () => {
    await fs.mkdir(path.join(root, '.assets'))
    await fs.writeFile(path.join(root, '.assets', 'test.png'), Buffer.from([1, 2, 3]))
    const result = await readClipboardImage(
      { src: 'app://.assets/test.png', workspaceRoot: root },
      root,
    )
    expect(result.mimeType).toBe('image/png')
    expect([...result.data]).toEqual([1, 2, 3])
  })

  it('rejects traversal, symlinks outside the workspace and workspace changes', async () => {
    await fs.symlink(os.tmpdir(), path.join(root, 'outside'))
    await expect(readClipboardImage({ src: '../', workspaceRoot: root }, root)).rejects.toThrow(
      'outside',
    )
    await expect(readClipboardImage({ src: 'outside', workspaceRoot: root }, root)).rejects.toThrow(
      'outside',
    )
    await expect(
      readClipboardImage({ src: 'x.png', workspaceRoot: root + '-different' }, root),
    ).rejects.toThrow('Workspace changed')
    await expect(
      readClipboardImage({ src: 'file:///etc/passwd', workspaceRoot: root }, root),
    ).rejects.toThrow('inside the workspace')
  })

  it('resolves escaped filenames and fragments exactly like the image protocol', async () => {
    await fs.mkdir(path.join(root, '.assets'))
    await fs.writeFile(path.join(root, '.assets', 'a b#c.png'), Buffer.from([1, 2, 3]))
    const result = await readClipboardImage(
      { src: 'app://.assets/a%20b%23c.png#view', workspaceRoot: root },
      root,
    )
    expect([...result.data]).toEqual([1, 2, 3])
    await expect(readClipboardImage({ src: '%2e%2e/', workspaceRoot: root }, root)).rejects.toThrow(
      'outside',
    )
  })

  it('bounds streamed downloads and rejects credentials before fetching', async () => {
    await expect(
      readClipboardImage(
        { src: 'https://user:password@example.com/x.png', workspaceRoot: root },
        root,
      ),
    ).rejects.toThrow('credentials')
    expect(mocks.fetch).not.toHaveBeenCalled()
    mocks.fetch.mockResolvedValue(new Response(new Uint8Array(20 * 1024 * 1024 + 1)))
    await expect(
      readClipboardImage({ src: 'https://example.com/x.png', workspaceRoot: root }, root),
    ).rejects.toThrow('too large')
  })

  it('writes image, HTML and text together and preserves the clipboard on invalid input', () => {
    writeEditorClipboard({
      text: 'Caption',
      html: '<img alt="Caption">',
      image: new Uint8Array([1]),
      expectedStamp: clipboardStamp(),
    })
    expect(mocks.write).toHaveBeenCalledWith({
      text: 'Caption',
      html: '<img alt="Caption">',
      image: expect.objectContaining({ isEmpty: expect.any(Function) }),
    })
    mocks.write.mockClear()
    mocks.decode.mockReturnValue({ isEmpty: () => true })
    expect(() =>
      writeEditorClipboard({
        text: '',
        html: '',
        image: new Uint8Array([1]),
        expectedStamp: clipboardStamp(),
      }),
    ).toThrow('decode')
    expect(() => writeEditorClipboard({ text: 1, html: '' })).toThrow()
    expect(mocks.write).not.toHaveBeenCalled()
  })

  it('enhances only the native copy carrying the matching operation marker', () => {
    const expectedCopyId = '0e0975e0-8b24-4c90-9188-46cc079f9067'
    const payload = { text: 'New copy', html: '<p>Enhanced</p>', expectedCopyId }
    mocks.html.mockReturnValue('<p>Previous clipboard</p>')
    expect(writeEditorClipboard(payload)).toBe(false)
    mocks.html.mockReturnValue(`<p data-melo-copy-id="${expectedCopyId}">New copy</p>`)
    expect(writeEditorClipboard(payload)).toBe(true)
    mocks.write.mockClear()
    mocks.html.mockReturnValue('<p data-melo-copy-id="another-operation">New copy</p>')
    expect(writeEditorClipboard(payload)).toBe(false)
    expect(mocks.write).not.toHaveBeenCalled()
  })

  it('does not overwrite a clipboard updated while an image was being prepared', () => {
    const expectedStamp = clipboardStamp()
    mocks.text.mockReturnValue('newer copy from another app')
    expect(writeEditorClipboard({ text: 'old image', html: '<img>', expectedStamp })).toBe(false)
    expect(mocks.write).not.toHaveBeenCalled()
  })

  it.runIf(process.platform === 'darwin')(
    'detects native file-list changes omitted from availableFormats',
    () => {
      const stamp = clipboardStamp()
      mocks.read.mockImplementation((format) =>
        format === 'public.file-url' ? 'file:///new-copy.png' : '',
      )
      expect(clipboardStamp()).not.toBe(stamp)
    },
  )
})
