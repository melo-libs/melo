import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { access, mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { createRequire } from 'node:module'

const execute = promisify(execFile)
const NODE_VERSION = '24.14.0'
const requireFromApp = createRequire(__filename)

export function adapterEntry(provider: 'claude' | 'codex'): string {
  const packageName =
    provider === 'claude'
      ? '@agentclientprotocol/claude-agent-acp'
      : '@agentclientprotocol/codex-acp'
  return requireFromApp
    .resolve(`${packageName}/dist/index.js`)
    .replace('app.asar/', 'app.asar.unpacked/')
}

export class RuntimeEnvironment {
  private node: string | null = null
  private installation: Promise<string> | null = null
  constructor(private readonly directory: string) {}

  get installing(): boolean {
    return this.installation !== null
  }

  async findNode(): Promise<string | null> {
    if (this.node) return this.node
    const managed = path.join(
      this.directory,
      `node-v${NODE_VERSION}-${process.platform}-${process.arch}`,
      'bin/node',
    )
    const candidates = [
      managed,
      ...String(process.env.PATH ?? '')
        .split(path.delimiter)
        .filter(Boolean)
        .map((dir) => path.join(dir, 'node')),
      '/opt/homebrew/bin/node',
      '/usr/local/bin/node',
    ]
    try {
      const nvm = path.join(os.homedir(), '.nvm/versions/node')
      for (const version of (await readdir(nvm)).reverse())
        candidates.push(path.join(nvm, version, 'bin/node'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    for (const candidate of candidates) {
      try {
        const { stdout } = await execute(candidate, ['-p', 'process.versions.node'], {
          timeout: 3000,
          env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
        })
        if (Number(stdout.trim().split('.')[0]) >= 22) return (this.node = candidate)
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code !== 'ENOENT' && code !== 'EACCES' && !(error as { killed?: boolean }).killed)
          throw error
      }
    }
    return null
  }

  async requireNode(): Promise<string> {
    const node = await this.findNode()
    if (!node) throw new Error('AGENT_RUNTIME_REQUIRED')
    return node
  }

  install(): Promise<string> {
    if (this.installation) return this.installation
    this.installation = this.download().finally(() => {
      this.installation = null
    })
    return this.installation
  }

  private async download(): Promise<string> {
    if (!['darwin', 'linux'].includes(process.platform) || !['arm64', 'x64'].includes(process.arch))
      throw new Error('Unsupported agent runtime platform')
    const name = `node-v${NODE_VERSION}-${process.platform}-${process.arch}`
    const filename = `${name}.tar.gz`
    const base = `https://nodejs.org/dist/v${NODE_VERSION}/`
    await mkdir(this.directory, { recursive: true })
    const staging = path.join(this.directory, `install-${randomUUID()}`)
    await mkdir(staging)
    try {
      const checksums = await fetch(`${base}SHASUMS256.txt`, {
        signal: AbortSignal.timeout(30_000),
      })
      if (!checksums.ok) throw new Error('Could not retrieve runtime checksums')
      const expected = (await checksums.text())
        .split('\n')
        .find((line) => line.endsWith(`  ${filename}`))
        ?.split(' ')[0]
      if (!expected || !/^[a-f0-9]{64}$/.test(expected)) throw new Error('Runtime checksum missing')
      const response = await fetch(base + filename, { signal: AbortSignal.timeout(180_000) })
      if (!response.ok || !response.body) throw new Error('Runtime download failed')
      const chunks: Uint8Array[] = []
      let bytes = 0
      for await (const chunk of response.body) {
        bytes += chunk.length
        if (bytes > 100 * 1024 * 1024) throw new Error('Runtime archive too large')
        chunks.push(chunk)
      }
      const archive = Buffer.concat(chunks)
      if (createHash('sha256').update(archive).digest('hex') !== expected)
        throw new Error('Runtime checksum mismatch')
      const archivePath = path.join(staging, filename)
      await writeFile(archivePath, archive)
      await execute('tar', ['-xzf', archivePath, '-C', staging], { timeout: 30_000 })
      const executable = path.join(staging, name, 'bin/node')
      await access(executable)
      const { stdout } = await execute(executable, ['-p', 'process.versions.node'], {
        timeout: 5000,
      })
      if (stdout.trim() !== NODE_VERSION) throw new Error('Downloaded runtime version mismatch')
      const destination = path.join(this.directory, name)
      try {
        await rename(path.join(staging, name), destination)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOTEMPTY') throw error
        const existing = await execute(
          path.join(destination, 'bin/node'),
          ['-p', 'process.versions.node'],
          { timeout: 5000 },
        )
        if (existing.stdout.trim() !== NODE_VERSION) throw error
      }
      return (this.node = path.join(destination, 'bin/node'))
    } finally {
      await rm(staging, { recursive: true, force: true })
    }
  }
}
