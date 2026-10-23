import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { UpdateInfo } from 'electron-updater'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  downloadMacUpdate,
  loadPendingMacUpdate,
  savePendingMacUpdate,
  selectMacUpdate,
  verifyMacUpdate,
} from './macUpdate'
import { updateRelease } from './updateRelease'

const contents = Buffer.from('Melo installer fixture')
const sha512 = createHash('sha512').update(contents).digest('base64')
const info: UpdateInfo = {
  version: '2.0.2',
  releaseDate: '2026-10-22T00:00:00Z',
  files: ['arm64', 'x64'].map((arch) => ({
    url: `melo-lite-2.0.2-${arch}.dmg`,
    size: contents.length,
    sha512,
  })),
  path: 'unused.zip',
  sha512,
}
let directory: string

function response(body: BodyInit = contents) {
  const result = new Response(body)
  Object.defineProperty(result, 'url', {
    value: 'https://release-assets.githubusercontent.com/fixture',
  })
  return result
}

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'melo-update-test-'))
})
afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe('macOS update installers', () => {
  it.each(['arm64', 'x64'])('selects the %s DMG from our pinned release', (arch) => {
    expect(selectMacUpdate(info, arch).url).toBe(
      `https://github.com/melo-libs/melo/releases/download/v2.0.2/melo-lite-2.0.2-${arch}.dmg`,
    )
  })

  it('rejects paths, external URLs, missing checksums, and unreasonable sizes in metadata', () => {
    expect(() => selectMacUpdate({ ...info, version: '../2.0.2' }, 'arm64')).toThrow()
    expect(() => selectMacUpdate(info, 'ia32')).toThrow()
    for (const patch of [
      { url: 'https://example.com/melo-lite-2.0.2-arm64.dmg' },
      { sha512: '' },
      { size: -1 },
      { size: 1024 * 1024 * 1024 },
    ]) {
      expect(() =>
        selectMacUpdate({ ...info, files: [{ ...info.files[0], ...patch }] }, 'arm64'),
      ).toThrow()
    }
  })

  it('downloads, verifies, and reuses the cached installer without downloading it again', async () => {
    const fetchInstaller = vi.fn<typeof fetch>().mockResolvedValueOnce(response())
    const progress = vi.fn()
    const artifact = selectMacUpdate(info, 'arm64')
    const update = await downloadMacUpdate(artifact, directory, fetchInstaller, progress)
    expect(await readFile(update.filePath)).toEqual(contents)
    expect(await verifyMacUpdate(update)).toBe(true)
    expect(progress).toHaveBeenLastCalledWith(100)
    await expect(downloadMacUpdate(artifact, directory, fetchInstaller, progress)).resolves.toEqual(
      update,
    )
    expect(fetchInstaller).toHaveBeenCalledOnce()
    expect(await readdir(path.dirname(update.filePath))).toEqual([artifact.fileName])
  })

  it('writes every chunk of a streamed installer in order', async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(contents.subarray(0, 5))
        controller.enqueue(contents.subarray(5))
        controller.close()
      },
    })
    const update = await downloadMacUpdate(
      selectMacUpdate(info, 'arm64'),
      directory,
      vi.fn<typeof fetch>().mockResolvedValue(response(body)),
      vi.fn(),
    )
    expect(await readFile(update.filePath)).toEqual(contents)
  })

  it('removes a partial installer when its stream is interrupted', async () => {
    let sent = false
    const body = new ReadableStream({
      pull(controller) {
        if (sent) controller.error(new Error('Connection interrupted'))
        else {
          sent = true
          controller.enqueue(contents.subarray(0, 5))
        }
      },
    })
    await expect(
      downloadMacUpdate(
        selectMacUpdate(info, 'arm64'),
        directory,
        vi.fn<typeof fetch>().mockResolvedValue(response(body)),
        vi.fn(),
      ),
    ).rejects.toThrow('Connection interrupted')
    expect(await readdir(path.join(directory, info.version))).toEqual([])
  })

  it('re-downloads a cached installer if its bytes were changed', async () => {
    const fetchInstaller = vi.fn<typeof fetch>().mockImplementation(async () => response())
    const artifact = selectMacUpdate(info, 'arm64')
    const update = await downloadMacUpdate(artifact, directory, fetchInstaller, vi.fn())
    await writeFile(update.filePath, Buffer.alloc(contents.length))
    expect(await verifyMacUpdate(update)).toBe(false)
    await downloadMacUpdate(artifact, directory, fetchInstaller, vi.fn())
    expect(fetchInstaller).toHaveBeenCalledTimes(2)
    expect(await verifyMacUpdate(update)).toBe(true)
  })

  it('removes obsolete version caches only after the pending installer is verified', async () => {
    await mkdir(path.join(directory, '2.0.1'))
    await writeFile(path.join(directory, '2.0.1', 'old.dmg'), 'old installer')
    await mkdir(path.join(directory, 'other-files'))
    const artifact = selectMacUpdate(info, 'arm64')
    const fetchInstaller = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(Buffer.alloc(contents.length)))
      .mockResolvedValueOnce(response())
    await expect(downloadMacUpdate(artifact, directory, fetchInstaller, vi.fn())).rejects.toThrow()
    expect(await readFile(path.join(directory, '2.0.1', 'old.dmg'), 'utf8')).toBe('old installer')
    const update = await downloadMacUpdate(artifact, directory, fetchInstaller, vi.fn())
    expect(await readFile(path.join(directory, '2.0.1', 'old.dmg'), 'utf8')).toBe('old installer')
    await savePendingMacUpdate(update, updateRelease(info), directory)
    expect((await readdir(directory)).sort()).toEqual(['2.0.2', 'other-files', 'pending.json'])
  })

  it('restores a persisted and verified installer without network access', async () => {
    const update = await downloadMacUpdate(
      selectMacUpdate(info, 'arm64'),
      directory,
      vi.fn<typeof fetch>().mockResolvedValue(response()),
      vi.fn(),
    )
    const release = updateRelease({ ...info, releaseNotes: 'Better search' })
    await savePendingMacUpdate(update, release, directory)
    expect(await loadPendingMacUpdate(directory, '2.0.1', 'arm64')).toEqual({
      installer: update,
      release,
    })
    await writeFile(update.filePath, Buffer.alloc(contents.length))
    expect(await loadPendingMacUpdate(directory, '2.0.1', 'arm64')).toBeNull()
  })

  it('clears the pending record after the application is upgraded', async () => {
    const update = await downloadMacUpdate(
      selectMacUpdate(info, 'arm64'),
      directory,
      vi.fn<typeof fetch>().mockResolvedValue(response()),
      vi.fn(),
    )
    await savePendingMacUpdate(update, updateRelease(info), directory)
    expect(await loadPendingMacUpdate(directory, '2.0.2', 'arm64')).toBeNull()
    expect(await readdir(directory)).toEqual([])
  })

  it('rejects tampered cache metadata instead of accepting a path outside the update cache', async () => {
    await writeFile(
      path.join(directory, 'pending.json'),
      JSON.stringify({
        release: { version: '../escape', date: null, notes: '' },
        size: 10,
        sha512,
      }),
    )
    await expect(loadPendingMacUpdate(directory, '2.0.1', 'arm64')).rejects.toThrow()
    await writeFile(path.join(directory, 'pending.json'), '{broken')
    await expect(loadPendingMacUpdate(directory, '2.0.1', 'arm64')).rejects.toThrow()
  })

  it.each(['hash', 'too-large', 'truncated'])(
    'discards a %s download instead of offering it for installation',
    async (failure) => {
      const body =
        failure === 'hash'
          ? Buffer.alloc(contents.length)
          : failure === 'too-large'
            ? Buffer.alloc(contents.length + 1)
            : contents.subarray(0, 3)
      const fetchInstaller = vi.fn<typeof fetch>().mockResolvedValue(response(body))
      await expect(
        downloadMacUpdate(selectMacUpdate(info, 'arm64'), directory, fetchInstaller, vi.fn()),
      ).rejects.toThrow()
      expect(await readdir(path.join(directory, info.version))).toEqual([])
    },
  )

  it('leaves no partial installer after a network failure', async () => {
    const fetchInstaller = vi.fn<typeof fetch>().mockRejectedValue(new Error('Network unavailable'))
    await expect(
      downloadMacUpdate(selectMacUpdate(info, 'arm64'), directory, fetchInstaller, vi.fn()),
    ).rejects.toThrow('Network unavailable')
    expect(await readdir(path.join(directory, info.version))).toEqual([])
  })
  it('honors cancellation before a download without leaving a partial installer', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetchInstaller = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      init!.signal!.throwIfAborted()
      return response()
    })
    await expect(
      downloadMacUpdate(
        selectMacUpdate(info, 'arm64'),
        directory,
        fetchInstaller,
        vi.fn(),
        controller.signal,
      ),
    ).rejects.toThrow()
    expect(await readdir(path.join(directory, info.version))).toEqual([])
  })
})
