import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, readdir, rename, rm, realpath } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { createRequire } from 'node:module'
import type { AgentComponent, AgentComponents, AgentProvider } from '../../../shared/types/agent'
import manifest from './runtimeManifest.json'
import { downloadRuntimeArtifact, fileSize, type RuntimeArtifact } from './runtimeDownload'

const execute = promisify(execFile)
const NODE_VERSION = '24.14.0'
const requireFromApp = createRequire(__filename)
export function adapterEntry(provider: AgentProvider): string {
  const packageName =
    provider === 'claude'
      ? '@agentclientprotocol/claude-agent-acp'
      : '@agentclientprotocol/codex-acp'
  return requireFromApp
    .resolve(`${packageName}/dist/index.js`)
    .replace('app.asar/', 'app.asar.unpacked/')
}
const emptyComponent = (): AgentComponent => ({
  status: 'missing',
  source: null,
  transferred: 0,
  total: 0,
})
const providers = ['claude', 'codex'] as const

export class RuntimeEnvironment {
  private cleaned = false
  private node: string | null = null
  private task: { provider: AgentProvider; abort: AbortController; promise: Promise<void> } | null =
    null
  private components: AgentComponents = { claude: emptyComponent(), codex: emptyComponent() }
  private readonly executables = new Map<AgentProvider, string>()
  private inspection: Promise<AgentComponents> | null = null
  constructor(
    private readonly directory: string,
    private readonly publish: (components: AgentComponents) => void = () => {},
  ) {}
  get installing(): boolean {
    return this.task !== null
  }
  private artifacts() {
    const target = `${process.platform}-${process.arch}`
    if (!(target in manifest)) throw new Error('AGENT_RUNTIME_PLATFORM')
    return manifest[target as keyof typeof manifest]
  }
  private destination(name: AgentProvider | 'node'): string {
    return path.join(
      this.directory,
      `${name}-v${this.artifacts()[name].version}-${process.platform}-${process.arch}`,
    )
  }
  private archive(name: AgentProvider | 'node'): string {
    return this.destination(name) + '.tar.gz.part'
  }
  private update(provider: AgentProvider, value: Partial<AgentComponent>): void {
    this.components = { ...this.components, [provider]: { ...this.components[provider], ...value } }
    this.publish(this.components)
  }
  private async validExecutable(
    executable: string,
    version?: string,
    options: { timeout?: number; signal?: AbortSignal } = {},
  ): Promise<boolean> {
    try {
      const { stdout } = await execute(executable, ['--version'], {
        timeout: 5000,
        ...options,
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: undefined,
          PATH: this.node
            ? `${path.dirname(this.node)}${path.delimiter}${process.env.PATH ?? ''}`
            : process.env.PATH,
        },
      })
      // An exact version is required only when installing a newly downloaded artifact.
      return version === undefined || stdout.match(/\b\d+\.\d+\.\d+\b/)?.[0] === version
    } catch {
      return false
    }
  }
  async requireProvider(provider: AgentProvider): Promise<string> {
    const existing = this.executables.get(provider)
    if (existing && (await this.validExecutable(existing))) return existing
    this.executables.delete(provider)
    const found = await this.findProvider(provider)
    if (!found) throw new Error('AGENT_RUNTIME_REQUIRED')
    return found.executable
  }
  private async findProvider(
    provider: AgentProvider,
    options: { timeout?: number; signal?: AbortSignal } = {},
  ): Promise<{ executable: string; source: 'local' | 'managed' } | null> {
    this.executables.delete(provider)
    const artifact = this.artifacts()[provider]
    const managed = path.join(this.destination(provider), artifact.executable)
    if (await this.validExecutable(managed, undefined, options)) {
      this.executables.set(provider, managed)
      return { executable: managed, source: 'managed' }
    }
    options.signal?.throwIfAborted()
    const dirs = [
      path.join(os.homedir(), '.local/bin'),
      '/opt/homebrew/bin',
      '/usr/local/bin',
      ...(this.node ? [path.dirname(this.node)] : []),
      ...String(process.env.PATH ?? '')
        .split(path.delimiter)
        .filter(Boolean),
    ]
    for (const directory of new Set(dirs)) {
      options.signal?.throwIfAborted()
      const executable = path.join(directory, provider)
      if (await this.validExecutable(executable, undefined, { signal: options.signal })) {
        this.executables.set(provider, executable)
        return { executable, source: 'local' }
      }
    }
    return null
  }
  async inspect(): Promise<AgentComponents> {
    if (this.task) return this.components
    if (this.inspection) return this.inspection
    this.inspection = this.scan().finally(() => {
      this.inspection = null
    })
    return this.inspection
  }
  private async scan(): Promise<AgentComponents> {
    if (!this.cleaned) {
      await mkdir(this.directory, { recursive: true, mode: 0o700 })
      for (const entry of await readdir(this.directory, { withFileTypes: true })) {
        if (entry.isDirectory() && /^install-[a-f0-9-]{36}$/.test(entry.name))
          await rm(path.join(this.directory, entry.name), { recursive: true, force: true })
      }
      this.cleaned = true
    }
    if (!(`${process.platform}-${process.arch}` in manifest)) {
      for (const provider of providers)
        this.components[provider] = {
          ...emptyComponent(),
          status: 'error',
          error: 'AGENT_RUNTIME_PLATFORM',
        }
      return this.components
    }
    const node = await this.findNode()
    for (const provider of providers) {
      const found = await this.findProvider(provider)
      const artifact = this.artifacts()[provider]
      const previous = this.components[provider]
      const total = (node ? 0 : this.artifacts().node.bytes) + (found ? 0 : artifact.bytes)
      const transferred =
        (node ? 0 : await fileSize(this.archive('node'))) +
        (found ? 0 : await fileSize(this.archive(provider)))
      this.components[provider] = {
        status:
          node && found
            ? 'ready'
            : previous.status === 'error'
              ? 'error'
              : transferred
                ? 'paused'
                : 'missing',
        source: found?.source ?? null,
        total,
        transferred,
        ...(previous.status === 'error' ? { error: previous.error } : {}),
      }
    }
    return { ...this.components }
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

  async install(provider: AgentProvider): Promise<void> {
    if (this.task) {
      if (this.task.provider !== provider) throw new Error('AGENT_DOWNLOAD_BUSY')
      return this.task.promise
    }
    await this.inspect()
    // Another caller may have claimed the shared runtime while inspection ran.
    if (this.task) return this.install(provider)
    if (this.components[provider].status === 'ready') return
    const abort = new AbortController()
    const promise = this.prepare(provider, abort.signal).finally(() => {
      this.task = null
    })
    this.task = { provider, abort, promise }
    return promise
  }
  cancel(provider: AgentProvider): void {
    if (this.task?.provider === provider) this.task.abort.abort()
  }
  private async prepare(provider: AgentProvider, signal: AbortSignal): Promise<void> {
    this.update(provider, { status: 'downloading', error: undefined })
    try {
      const needed: (AgentProvider | 'node')[] = []
      if (!(await this.findNode())) needed.push('node')
      if (!this.executables.has(provider)) needed.push(provider)
      const total = needed.reduce((sum, name) => sum + this.artifacts()[name].bytes, 0)
      let completed = 0
      for (const name of needed) {
        const artifact = this.artifacts()[name]
        let last = 0
        await downloadRuntimeArtifact(artifact, this.archive(name), signal, (bytes) => {
          const now = Date.now()
          if (now - last < 100 && bytes !== artifact.bytes) return
          last = now
          this.update(provider, { status: 'downloading', total, transferred: completed + bytes })
        })
        this.update(provider, { status: 'preparing' })
        await this.extract(name, artifact, signal)
        completed += artifact.bytes
        if (name === 'node') this.node = path.join(this.destination(name), artifact.executable)
      }
      signal.throwIfAborted()
      // Moving the executable can trigger another first-launch check on macOS.
      const found = await this.findProvider(provider, { timeout: 60_000, signal })
      if (!found) throw new Error('AGENT_RUNTIME_INSTALL_FAILED')
      signal.throwIfAborted()
      this.update(provider, {
        status: 'ready',
        source: found.source,
        transferred: total,
        total,
      })
    } catch (error) {
      const code =
        error instanceof Error && error.message.startsWith('AGENT_')
          ? error.message
          : 'AGENT_DOWNLOAD_NETWORK'
      this.update(provider, {
        status: signal.aborted ? 'paused' : 'error',
        error: signal.aborted ? undefined : code,
      })
      throw new Error(signal.aborted ? 'AGENT_DOWNLOAD_CANCELLED' : code, { cause: error })
    }
  }
  private async extract(
    name: AgentProvider | 'node',
    artifact: RuntimeArtifact,
    signal: AbortSignal,
  ): Promise<void> {
    const staging = path.join(this.directory, `install-${randomUUID()}`)
    await mkdir(staging, { recursive: true, mode: 0o700 })
    try {
      const archive = this.archive(name)
      // Only pinned, fully verified archives reach tar. Reject traversal before extraction.
      const { stdout } = await execute('tar', ['-tzf', archive], {
        signal,
        maxBuffer: 8 * 1024 * 1024,
      })
      if (
        stdout
          .split('\n')
          .filter(Boolean)
          .some((entry) => path.isAbsolute(entry) || entry.split('/').includes('..'))
      )
        throw new Error('AGENT_DOWNLOAD_INTEGRITY')
      await execute(
        'tar',
        ['-xzf', archive, '-C', staging, '--strip-components=1', '--no-same-owner'],
        { signal, timeout: 120_000 },
      )
      const executable = path.join(staging, artifact.executable)
      const resolved = await realpath(executable)
      if (
        !resolved.startsWith((await realpath(staging)) + path.sep) ||
        // First launch may include macOS verification or Rosetta translation.
        !(await this.validExecutable(executable, artifact.version, { timeout: 60_000, signal }))
      )
        throw new Error('AGENT_RUNTIME_INSTALL_FAILED')
      signal.throwIfAborted()
      // A failed previous installation is never treated as usable.
      await rm(this.destination(name), { recursive: true, force: true })
      await rename(staging, this.destination(name))
      await rm(archive, { force: true })
    } finally {
      await rm(staging, { recursive: true, force: true })
    }
  }
}
