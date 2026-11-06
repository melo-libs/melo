import { createServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, writeFile, readFile, mkdir, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { RuntimeEnvironment } from './runtimeEnvironment'
import type { AgentComponents } from '../../../shared/types/agent'

const { artifacts } = vi.hoisted(() => ({
  artifacts: {
    node: { version: '24.14.0', url: '', bytes: 0, integrity: '', executable: 'bin/node' },
    claude: { version: '99.0.0', url: '', bytes: 0, integrity: '', executable: 'cli' },
    codex: { version: '99.0.0', url: '', bytes: 0, integrity: '', executable: 'cli' },
  },
}))
vi.mock('./runtimeManifest.json', () => ({
  default: {
    'darwin-arm64': artifacts,
    'darwin-x64': artifacts,
    'linux-x64': artifacts,
    'linux-arm64': artifacts,
  },
}))
const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  for (const fn of cleanup.splice(0)) await fn()
})
async function fixture(broken = false, cancelPreparing = false, coldStart = false) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'melo-component-'))
  const localBin = path.join(root, 'bin')
  await mkdir(localBin)
  vi.spyOn(os, 'homedir').mockReturnValue(path.join(root, 'home'))
  vi.stubEnv('PATH', `${localBin}${path.delimiter}/usr/bin${path.delimiter}/bin`)
  const source = path.join(root, 'source/package')
  await mkdir(source, { recursive: true })
  await writeFile(
    path.join(source, 'cli'),
    '#!/bin/sh\n' +
      (coldStart
        ? 'marker="$(dirname "$0")/started"\nif [ ! -f "$marker" ] || [ "$(cat "$marker")" != "$0" ]; then sleep 6; printf "%s" "$0" > "$marker"; fi\n'
        : '') +
      'echo 99.0.0\n',
    { mode: 0o755 },
  )
  await writeFile(path.join(source, 'payload'), Buffer.alloc(1024, 1))
  const file = path.join(root, 'fixture.tgz')
  execFileSync('tar', ['-czf', file, '-C', path.dirname(source), 'package'])
  const bytes = await readFile(file)
  let requests = 0
  const server = createServer((_req, res) => {
    requests++
    res.end(bytes)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  for (const provider of ['claude', 'codex'] as const)
    Object.assign(artifacts[provider], {
      url: `http://127.0.0.1:${port}/${provider}`,
      bytes: bytes.length,
      integrity: `sha256-${createHash('sha256')
        .update(broken ? Buffer.alloc(bytes.length) : bytes)
        .digest('base64')}`,
    })
  const states: AgentComponents[] = []
  const manager = new RuntimeEnvironment(path.join(root, 'runtime'), (state) => {
    states.push(structuredClone(state))
    if (cancelPreparing && state.claude.status === 'preparing') {
      cancelPreparing = false
      manager.cancel('claude')
    }
  })
  vi.spyOn(manager, 'findNode').mockResolvedValue(process.execPath)
  cleanup.push(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(root, { recursive: true, force: true })
  })
  return { manager, states, root, localBin, requests: () => requests }
}
it('reuses local tools with different versions and after independent upgrades', async () => {
  const { manager, localBin, requests } = await fixture()
  for (const [provider, version] of [
    ['claude', '2.1.220'],
    ['codex', '0.166.0'],
  ] as const) {
    const executable = path.join(localBin, provider)
    await writeFile(executable, `#!/bin/sh\necho ${version}\n`, { mode: 0o755 })
    expect((await manager.inspect())[provider]).toMatchObject({ status: 'ready', source: 'local' })
    expect(await manager.requireProvider(provider)).toBe(executable)
    await writeFile(executable, '#!/bin/sh\necho 100.0.0\n')
    expect(await manager.requireProvider(provider)).toBe(executable)
    await manager.install(provider)
  }
  expect(requests()).toBe(0)
})
it('reuses an existing managed tool after its version changes', async () => {
  const { manager, requests } = await fixture()
  await manager.install('claude')
  const executable = await manager.requireProvider('claude')
  await writeFile(executable, '#!/bin/sh\necho 100.0.0\n')
  expect((await manager.inspect()).claude.status).toBe('ready')
  expect(await manager.requireProvider('claude')).toBe(executable)
  await manager.install('claude')
  expect(requests()).toBe(1)
})
it('coalesces installs and verifies and activates each tool independently', async () => {
  const { manager, states, root, requests } = await fixture()
  const credentials = path.join(root, 'account.json')
  await writeFile(credentials, 'preserve me')
  await Promise.all([manager.install('claude'), manager.install('claude')])
  expect(requests()).toBe(1)
  expect(states.at(-1)!.claude.status).toBe('ready')
  expect(states.some((s) => s.claude.status === 'preparing')).toBe(true)
  const executable = await manager.requireProvider('claude')
  expect((await stat(executable)).isFile()).toBe(true)
  await manager.install('codex')
  const codex = await manager.requireProvider('codex')
  expect((await stat(executable)).isFile()).toBe(true)
  expect((await stat(codex)).isFile()).toBe(true)
  expect(await readFile(credentials, 'utf8')).toBe('preserve me')
})
it('does not activate a corrupted download or discard another installed version', async () => {
  const { manager, root, states } = await fixture(true)
  const old = path.join(root, 'runtime/claude-v98.0.0')
  await mkdir(old, { recursive: true })
  await writeFile(path.join(old, 'cli'), 'previous')
  await expect(manager.install('claude')).rejects.toThrow('AGENT_DOWNLOAD_INTEGRITY')
  expect(states.at(-1)!.claude.status).toBe('error')
  expect(await readFile(path.join(old, 'cli'), 'utf8')).toBe('previous')
})
it('allows cold launches before and after activation to exceed a routine version probe', async () => {
  const { manager } = await fixture(false, false, true)
  await manager.install('claude')
  expect((await manager.inspect()).claude.status).toBe('ready')
}, 20_000)
it('reinstalls if a previously selected executable disappears', async () => {
  const { manager, requests } = await fixture()
  await manager.install('claude')
  const executable = await manager.requireProvider('claude')
  await rm(executable)
  expect((await manager.inspect()).claude.status).toBe('missing')
  await manager.install('claude')
  expect(requests()).toBe(2)
  expect((await stat(await manager.requireProvider('claude'))).isFile()).toBe(true)
})

it('cleans abandoned staging on startup but preserves resumable downloads', async () => {
  const { manager, root } = await fixture()
  const staging = path.join(root, 'runtime/install-12345678-1234-1234-1234-123456789012')
  await mkdir(staging, { recursive: true })
  await writeFile(path.join(staging, 'large-file'), 'incomplete extraction')
  const partial = path.join(
    root,
    `runtime/claude-v99.0.0-${process.platform}-${process.arch}.tar.gz.part`,
  )
  await writeFile(partial, 'partial')
  await manager.inspect()
  await expect(stat(staging)).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await readFile(partial, 'utf8')).toBe('partial')
})

it('cancellation rejects the connect continuation and a later retry can finish', async () => {
  const { manager, states } = await fixture(false, true)
  await expect(manager.install('claude')).rejects.toThrow('AGENT_DOWNLOAD_CANCELLED')
  expect(states.at(-1)!.claude.status).toBe('paused')
  await manager.install('claude')
  expect(states.at(-1)!.claude.status).toBe('ready')
})
