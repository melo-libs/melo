import { mkdtemp, open, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { fileThumbnail } from './fileThumbnail'

const { generate } = vi.hoisted(() => ({ generate: vi.fn<(input: string) => Promise<void>>() }))
vi.mock('node:child_process', () => ({
  execFile: (
    _command: string,
    args: string[],
    _options: { timeout: number; maxBuffer: number },
    callback: (error: Error | null, stdout?: string, stderr?: string) => void,
  ) => {
    void generate(args.at(-1)!).then(
      () => callback(null, '', ''),
      (error: Error) => callback(error),
    )
  },
}))
vi.mock('electron', () => ({
  nativeImage: {
    createFromBuffer: (bytes: Buffer) => ({
      isEmpty: () => bytes.toString() !== 'thumbnail',
      getSize: () => ({ width: 100, height: 140 }),
      resize: () => ({ toDataURL: () => 'data:image/png;base64,fixture' }),
    }),
  },
}))
const roots: string[] = []
afterEach(async () => {
  generate.mockReset()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

it.skipIf(process.platform !== 'darwin')(
  'gives opaque payloads an extension for Quick Look, deduplicates previews and removes temporary copies',
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'melo-thumbnail-test-'))
    roots.push(root)
    const source = path.join(root, 'opaque-payload')
    await writeFile(source, 'original PDF bytes')
    let generatedPath = ''
    generate.mockImplementation(async (input) => {
      generatedPath = input
      expect(path.extname(input)).toBe('.pdf')
      expect(await readFile(input, 'utf8')).toBe('original PDF bytes')
      await writeFile(`${input}.png`, 'thumbnail')
    })
    const first = await open(source),
      second = await open(source)
    try {
      expect(
        await Promise.all([
          fileThumbnail(first, 'statement.pdf'),
          fileThumbnail(second, 'another.pdf'),
        ]),
      ).toEqual(['data:image/png;base64,fixture', 'data:image/png;base64,fixture'])
      expect(generate).toHaveBeenCalledTimes(1)
      await expect(stat(path.dirname(generatedPath))).rejects.toMatchObject({ code: 'ENOENT' })
      expect(await readFile(source, 'utf8')).toBe('original PDF bytes')
      expect((await first.stat()).isFile()).toBe(true)
    } finally {
      await first.close()
      await second.close()
    }
  },
)

it.skipIf(process.platform !== 'darwin')(
  'returns no preview when Quick Look has no generator output',
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'melo-thumbnail-test-'))
    roots.push(root)
    const source = path.join(root, 'unreadable-payload')
    await writeFile(source, 'unsupported document')
    generate.mockResolvedValue(undefined)
    const file = await open(source)
    try {
      expect(await fileThumbnail(file, 'unsupported.docx')).toBeUndefined()
      expect(generate).toHaveBeenCalledOnce()
    } finally {
      await file.close()
    }
  },
)
