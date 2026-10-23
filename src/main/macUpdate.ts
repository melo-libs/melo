import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, mkdir, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { UpdateInfo } from 'electron-updater'
import type { UpdateRelease } from '../shared/types/ipc'
import { isNewerVersion } from './updateRelease'

const MAX_INSTALLER_SIZE = 512 * 1024 * 1024

export interface MacUpdateArtifact {
  version: string
  fileName: string
  url: string
  size: number
  sha512: string
}

export interface DownloadedMacUpdate {
  filePath: string
  artifact: MacUpdateArtifact
}

async function pruneMacUpdates(cacheDirectory: string, pendingVersion: string): Promise<void> {
  try {
    for (const entry of await readdir(cacheDirectory, { withFileTypes: true })) {
      if (
        entry.isDirectory() &&
        /^\d+\.\d+\.\d+$/.test(entry.name) &&
        entry.name !== pendingVersion
      ) {
        await rm(path.join(cacheDirectory, entry.name), { recursive: true, force: true })
      }
    }
  } catch (error) {
    // Cache maintenance must not make a verified installer unavailable.
    console.warn(
      'Could not remove an obsolete update installer:',
      (error as NodeJS.ErrnoException).code,
    )
  }
}

export async function savePendingMacUpdate(
  update: DownloadedMacUpdate,
  release: UpdateRelease,
  cacheDirectory: string,
): Promise<void> {
  const manifest = path.join(cacheDirectory, 'pending.json')
  await rm(`${manifest}.tmp`, { force: true })
  await writeFile(
    `${manifest}.tmp`,
    JSON.stringify({ release, size: update.artifact.size, sha512: update.artifact.sha512 }),
    { mode: 0o600, flag: 'wx' },
  )
  await rename(`${manifest}.tmp`, manifest)
  // Keep the previous working package until the new descriptor is committed.
  await pruneMacUpdates(cacheDirectory, release.version)
}

export async function loadPendingMacUpdate(
  cacheDirectory: string,
  currentVersion: string,
  arch: string,
): Promise<{ installer: DownloadedMacUpdate; release: UpdateRelease } | null> {
  const manifest = path.join(cacheDirectory, 'pending.json')
  let source: string
  try {
    const stat = await lstat(manifest)
    if (!stat.isFile() || stat.size > 64000) throw new Error('Invalid update cache descriptor')
    source = await readFile(manifest, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  const data: unknown = JSON.parse(source)
  if (
    !data ||
    typeof data !== 'object' ||
    !('release' in data) ||
    !('size' in data) ||
    !('sha512' in data) ||
    typeof data.size !== 'number' ||
    typeof data.sha512 !== 'string'
  )
    throw new Error('Invalid update cache descriptor')
  const release = data.release
  if (
    !release ||
    typeof release !== 'object' ||
    !('version' in release) ||
    typeof release.version !== 'string' ||
    !('notes' in release) ||
    typeof release.notes !== 'string' ||
    release.notes.length > 20000 ||
    !('date' in release) ||
    !(
      release.date === null ||
      (typeof release.date === 'string' && !Number.isNaN(Date.parse(release.date)))
    )
  )
    throw new Error('Invalid cached release information')
  const artifact = selectMacUpdate(
    {
      version: release.version,
      releaseDate: release.date ?? '',
      path: '',
      sha512: data.sha512,
      files: [
        { url: `melo-lite-${release.version}-${arch}.dmg`, size: data.size, sha512: data.sha512 },
      ],
    },
    arch,
  )
  if (!isNewerVersion(artifact.version, currentVersion)) {
    await rm(manifest, { force: true })
    await rm(path.join(cacheDirectory, artifact.version), { recursive: true, force: true })
    return null
  }
  const directory = path.join(cacheDirectory, artifact.version)
  const stat = await lstat(directory).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null
    throw error
  })
  if (!stat?.isDirectory()) return null
  const installer = { filePath: path.join(directory, artifact.fileName), artifact }
  if (!(await verifyMacUpdate(installer))) return null
  return {
    installer,
    release: { version: release.version, date: release.date, notes: release.notes },
  }
}

export function selectMacUpdate(info: UpdateInfo, arch: string): MacUpdateArtifact {
  if (!/^\d+\.\d+\.\d+$/.test(info.version) || (arch !== 'arm64' && arch !== 'x64')) {
    throw new Error('Unsupported update version or architecture')
  }
  const fileName = `melo-lite-${info.version}-${arch}.dmg`
  const file = info.files.find((entry) => entry.url === fileName)
  if (
    !file ||
    file.size === undefined ||
    !Number.isSafeInteger(file.size) ||
    file.size <= 0 ||
    file.size > MAX_INSTALLER_SIZE ||
    !/^[A-Za-z0-9+/]{86}==$/.test(file.sha512)
  ) {
    throw new Error('The update has no valid installer for this Mac')
  }
  // Build the URL from our release identity, never a URL supplied by update metadata.
  return {
    version: info.version,
    fileName,
    url: `https://github.com/melo-libs/melo/releases/download/v${info.version}/${fileName}`,
    size: file.size,
    sha512: file.sha512,
  }
}

export async function verifyMacUpdate(update: DownloadedMacUpdate): Promise<boolean> {
  let stat
  try {
    stat = await lstat(update.filePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
  if (!stat.isFile() || stat.size !== update.artifact.size) return false
  const hash = createHash('sha512')
  for await (const chunk of createReadStream(update.filePath)) hash.update(chunk)
  return hash.digest('base64') === update.artifact.sha512
}

export async function downloadMacUpdate(
  artifact: MacUpdateArtifact,
  cacheDirectory: string,
  fetchInstaller: (url: string, init: RequestInit) => Promise<Response>,
  onProgress: (percent: number) => void,
  signal?: AbortSignal,
): Promise<DownloadedMacUpdate> {
  const directory = path.join(cacheDirectory, artifact.version)
  const update = { filePath: path.join(directory, artifact.fileName), artifact }
  await mkdir(directory, { recursive: true })
  if (!(await lstat(directory)).isDirectory()) throw new Error('Invalid update cache directory')
  if (await verifyMacUpdate(update)) {
    return update
  }

  const partialPath = `${update.filePath}.part`
  await rm(partialPath, { force: true })
  const controller = new AbortController()
  const abort = (): void => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) controller.abort()
  const timeout = setTimeout(() => controller.abort(), 15 * 60 * 1000)
  try {
    const response = await fetchInstaller(artifact.url, {
      signal: controller.signal,
      credentials: 'omit',
    })
    if (!response.ok) throw new Error(`Installer download failed (HTTP ${response.status})`)
    if (!response.url.startsWith('https://') || !response.body) {
      throw new Error('Invalid installer response')
    }
    const reader = response.body.getReader()
    const destination = await open(partialPath, 'wx', 0o600)
    const hash = createHash('sha512')
    let received = 0
    let lastPercent = -1
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        received += value.byteLength
        if (received > artifact.size) throw new Error('Installer size exceeds update metadata')
        hash.update(value)
        await destination.writeFile(value)
        const percent = Math.min(99, Math.floor((received / artifact.size) * 100))
        if (percent !== lastPercent) {
          lastPercent = percent
          onProgress(percent)
        }
      }
    } finally {
      reader.releaseLock()
      await destination.close()
    }
    if (received !== artifact.size || hash.digest('base64') !== artifact.sha512) {
      throw new Error('Installer integrity check failed')
    }
    await rename(partialPath, update.filePath)
    onProgress(100)
    return update
  } finally {
    signal?.removeEventListener('abort', abort)
    clearTimeout(timeout)
    controller.abort()
    await rm(partialPath, { force: true })
  }
}
