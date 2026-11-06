import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, open, stat, rm } from 'node:fs/promises'
import path from 'node:path'

export interface RuntimeArtifact {
  version: string
  url: string
  integrity: string
  bytes: number
  executable: string
}

export async function fileSize(file: string): Promise<number> {
  try {
    return (await stat(file)).size
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0
    throw error
  }
}

/** The trusted manifest pins both identity and size, so a resumed response can
 * never silently install a different release, even on servers without ETags. */
export async function downloadRuntimeArtifact(
  artifact: RuntimeArtifact,
  destination: string,
  signal: AbortSignal,
  progress: (bytes: number) => void,
): Promise<void> {
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 })
  let received = await fileSize(destination)
  if (received > artifact.bytes) {
    await rm(destination)
    received = 0
  }
  progress(received)
  if (received < artifact.bytes) {
    const response = await fetch(artifact.url, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(15 * 60_000)]),
      headers: received ? { Range: `bytes=${received}-` } : {},
    })
    if (!response.ok || !response.body) throw new Error('AGENT_DOWNLOAD_NETWORK')
    if (response.status === 206) {
      const range = response.headers.get('content-range')
      if (range !== `bytes ${received}-${artifact.bytes - 1}/${artifact.bytes}`) {
        await response.body.cancel()
        throw new Error('AGENT_DOWNLOAD_NETWORK')
      }
    } else if (response.status === 200) received = 0
    else {
      await response.body.cancel()
      throw new Error('AGENT_DOWNLOAD_NETWORK')
    }
    const file = await open(destination, received ? 'a' : 'w', 0o600)
    try {
      for await (const chunk of response.body) {
        signal.throwIfAborted()
        if (received + chunk.length > artifact.bytes) throw new Error('AGENT_DOWNLOAD_INTEGRITY')
        let offset = 0
        while (offset < chunk.length) {
          const { bytesWritten } = await file.write(chunk, offset, chunk.length - offset)
          offset += bytesWritten
        }
        received += chunk.length
        progress(received)
      }
    } finally {
      await file.close()
    }
  }
  signal.throwIfAborted()
  if (received !== artifact.bytes) throw new Error('AGENT_DOWNLOAD_NETWORK')
  const [algorithm, expected] = artifact.integrity.split('-')
  const hash = createHash(algorithm)
  for await (const chunk of createReadStream(destination)) {
    signal.throwIfAborted()
    hash.update(chunk)
  }
  if (hash.digest('base64') !== expected) {
    await rm(destination)
    throw new Error('AGENT_DOWNLOAD_INTEGRITY')
  }
}
