import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { downloadRuntimeArtifact } from './runtimeDownload'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})
async function fixture(mode: 'range' | 'full' | 'invalid' = 'range') {
  const content = Buffer.from('a pinned runtime archive')
  const requests: (string | undefined)[] = []
  const server = createServer((request, response) => {
    requests.push(request.headers.range)
    const start = Number(request.headers.range?.match(/bytes=(\d+)/)?.[1] ?? 0)
    if (request.headers.range && mode !== 'full') {
      response.writeHead(206, {
        'Content-Range': `bytes ${mode === 'invalid' ? 0 : start}-${content.length - 1}/${content.length}`,
      })
      response.end(content.subarray(start))
    } else response.end(content)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  const root = await mkdtemp(path.join(os.tmpdir(), 'melo-runtime-download-'))
  cleanups.push(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(root, { recursive: true, force: true })
  })
  return {
    root,
    content,
    requests,
    artifact: {
      version: '1',
      url: `http://127.0.0.1:${address.port}/runtime`,
      bytes: content.length,
      integrity: `sha256-${createHash('sha256').update(content).digest('base64')}`,
      executable: 'cli',
    },
  }
}
it.each(['range', 'full'] as const)(
  'resumes a partial file safely when the server returns %s',
  async (mode) => {
    const { root, artifact, content, requests } = await fixture(mode)
    const file = path.join(root, 'runtime.part')
    await writeFile(file, content.subarray(0, 7))
    const progress: number[] = []
    await downloadRuntimeArtifact(artifact, file, new AbortController().signal, (bytes) =>
      progress.push(bytes),
    )
    expect(await readFile(file)).toEqual(content)
    expect(requests).toEqual(['bytes=7-'])
    expect(progress.at(-1)).toBe(content.length)
  },
)
it('rejects an incorrect Content-Range without appending it', async () => {
  const { root, artifact, content } = await fixture('invalid')
  const file = path.join(root, 'runtime.part')
  await writeFile(file, content.subarray(0, 7))
  await expect(
    downloadRuntimeArtifact(artifact, file, new AbortController().signal, () => {}),
  ).rejects.toThrow('AGENT_DOWNLOAD_NETWORK')
  expect((await readFile(file)).length).toBe(7)
})
it('verifies a complete cached archive offline and removes corrupt data', async () => {
  const { root, artifact, content, requests } = await fixture()
  const file = path.join(root, 'runtime.part')
  await writeFile(file, content)
  await downloadRuntimeArtifact(artifact, file, new AbortController().signal, () => {})
  expect(requests).toEqual([])
  await writeFile(file, Buffer.alloc(content.length))
  await expect(
    downloadRuntimeArtifact(artifact, file, new AbortController().signal, () => {}),
  ).rejects.toThrow('AGENT_DOWNLOAD_INTEGRITY')
  await expect(stat(file)).rejects.toMatchObject({ code: 'ENOENT' })
})
it('keeps partial data when explicitly cancelled', async () => {
  const { root, artifact, content } = await fixture()
  const file = path.join(root, 'runtime.part')
  await writeFile(file, content.subarray(0, 7))
  const abort = new AbortController()
  abort.abort()
  await expect(downloadRuntimeArtifact(artifact, file, abort.signal, () => {})).rejects.toThrow()
  expect((await readFile(file)).length).toBe(7)
})
