import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { afterEach, expect, it, vi } from 'vitest'
import { AgentSettings } from '../storage/agentSettings'
import { RuntimeEnvironment } from './runtimeEnvironment'
import { openHarnessSession } from './harnessSession'
import { NativeModels } from './nativeModels'

vi.mock('./harnessSession', () => ({ openHarnessSession: vi.fn() }))
vi.mock('electron', () => ({ safeStorage: {} }))
const directories: string[] = []
afterEach(async () => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  await Promise.all(directories.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'melo-native-test-'))
  directories.push(root)
  const settings = new AgentSettings(root)
  const environment = new RuntimeEnvironment(root)
  return { root, settings, models: new NativeModels(settings, environment, 'fixture-launcher') }
}
const options = (model = 'sonnet', levels = ['medium', 'high']) => [
  {
    id: 'model',
    name: 'Model',
    category: 'model',
    type: 'select' as const,
    currentValue: model,
    options: ['sonnet', 'opus'].map((value) => ({ value, name: value })),
  },
  {
    id: 'effort',
    name: 'Effort',
    category: 'thought_level',
    type: 'select' as const,
    currentValue: levels[0],
    options: levels.map((value) => ({ value, name: value })),
  },
]
it('inherits once, keeps API fields separate, and restores Melo choices after restart', async () => {
  const { root, settings, models } = await fixture()
  const global = await mkdtemp(path.join(os.tmpdir(), 'melo-cli-prefs-'))
  directories.push(global)
  vi.stubEnv('CLAUDE_CONFIG_DIR', global)
  const file = path.join(global, 'settings.json')
  const original = JSON.stringify({
    model: 'sonnet',
    effortLevel: 'medium',
    hooks: { dangerous: 'ignored' },
    env: { SECRET: 'not-inherited' },
  })
  await writeFile(file, original)
  const close = vi.fn(async () => {})
  vi.mocked(openHarnessSession).mockImplementation(async (input) => {
    expect(input.mcpServers).toEqual([])
    expect(input.workspaceRoot).not.toBe(root)
    expect(input.configuration.native).toEqual(
      vi.mocked(openHarnessSession).mock.calls.length === 1
        ? undefined
        : { model: 'sonnet', effort: 'medium' },
    )
    return {
      connection: { close, setConfigOption: async () => options('opus', ['high']) },
      configOptions: options(),
    } as unknown as Awaited<ReturnType<typeof openHarnessSession>>
  })
  expect(await models.resolve('claude')).toEqual({ model: 'sonnet', effort: 'medium' })
  await writeFile(file, JSON.stringify({ model: 'terminal-changed', effortLevel: 'low' }))
  await models.load('claude', { category: 'model', value: 'opus' })
  expect(settings.get('claude').native).toEqual({ model: 'opus', effort: 'high' })
  settings.save({
    provider: 'claude',
    access: 'api',
    model: 'api-model',
    baseUrl: 'https://example.com',
  })
  expect(settings.get().model).toBe('api-model')
  expect(settings.get().native).toEqual({ model: 'opus', effort: 'high' })
  const restored = new NativeModels(new AgentSettings(root), new RuntimeEnvironment(root), '')
  expect(await restored.resolve('claude')).toEqual({ model: 'opus', effort: 'high' })
  expect(vi.mocked(openHarnessSession)).toHaveBeenCalledTimes(2)
  expect(close).toHaveBeenCalledTimes(2)
  expect(await readFile(file, 'utf8')).toBe(
    JSON.stringify({ model: 'terminal-changed', effortLevel: 'low' }),
  )
  expect(await readFile(path.join(root, 'settings.json'), 'utf8')).not.toContain('SECRET')
})
it('validates against advertised choices and recovers discovery after a failure', async () => {
  const { models, settings } = await fixture()
  settings.saveNative('codex', { model: 'sonnet', effort: 'medium' })
  const close = vi.fn(async () => {})
  vi.mocked(openHarnessSession).mockResolvedValue({
    connection: { close },
    configOptions: options(),
  } as unknown as Awaited<ReturnType<typeof openHarnessSession>>)
  await expect(
    models.load('codex', { category: 'thought_level', value: 'unsupported' }),
  ).rejects.toThrow('no longer available')
  await models.load('codex')
  expect(close).toHaveBeenCalledTimes(2)
  expect(models.cached('codex')).toHaveLength(2)
})

it('refreshes candidates without replacing an existing user configuration', async () => {
  const { models, settings } = await fixture()
  settings.saveNative('codex', { model: 'sonnet', effort: 'high' })
  const close = vi.fn(async () => {})
  vi.mocked(openHarnessSession).mockResolvedValue({
    connection: { close },
    configOptions: options('opus', ['medium']),
  } as unknown as Awaited<ReturnType<typeof openHarnessSession>>)
  await models.load('codex')
  expect(models.cached('codex')?.[0].options).toHaveLength(2)
  expect(settings.get('codex').native).toEqual({ model: 'sonnet', effort: 'high' })
})
it('accepts the harness-reconciled default and effort without replaying raw global aliases', async () => {
  const { models, settings } = await fixture()
  const close = vi.fn(async () => {})
  const setConfigOption = vi.fn()
  vi.mocked(openHarnessSession).mockResolvedValue({
    connection: { close, setConfigOption },
    configOptions: options('sonnet', ['high']),
  } as unknown as Awaited<ReturnType<typeof openHarnessSession>>)
  await models.resolve('claude')
  expect(settings.get('claude').native).toEqual({ model: 'sonnet', effort: 'high' })
  expect(setConfigOption).not.toHaveBeenCalled()
})

it('cancels a queued discovery immediately without disrupting the preceding request', async () => {
  const { models } = await fixture()
  let release: (value: Awaited<ReturnType<typeof openHarnessSession>>) => void = () => {}
  vi.mocked(openHarnessSession).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve
      }),
  )
  const first = models.load('codex')
  await vi.waitFor(() => expect(vi.mocked(openHarnessSession)).toHaveBeenCalledTimes(1))
  const controller = new AbortController()
  const next = models.resolve('codex', controller.signal)
  controller.abort(new Error('queued request cancelled'))
  await expect(next).rejects.toThrow('queued request cancelled')
  release({ connection: { close: async () => {} }, configOptions: options() } as unknown as Awaited<
    ReturnType<typeof openHarnessSession>
  >)
  await first
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(vi.mocked(openHarnessSession)).toHaveBeenCalledTimes(1)
})

it('does not queue a different Harness behind a slow catalog', async () => {
  const { models } = await fixture()
  let release!: (value: Awaited<ReturnType<typeof openHarnessSession>>) => void
  vi.mocked(openHarnessSession)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    .mockResolvedValue({
      connection: { close: async () => {} },
      configOptions: options(),
    } as unknown as Awaited<ReturnType<typeof openHarnessSession>>)
  const first = models.load('codex')
  try {
    await vi.waitFor(() => expect(openHarnessSession).toHaveBeenCalledTimes(1))
    await models.load('claude')
    expect(openHarnessSession).toHaveBeenCalledTimes(2)
    expect(models.cached('claude')).toHaveLength(2)
  } finally {
    release({
      connection: { close: async () => {} },
      configOptions: options(),
    } as unknown as Awaited<ReturnType<typeof openHarnessSession>>)
    await first
  }
})

it('drains active and queued discovery on suspension, then allows a later query', async () => {
  const { models } = await fixture()
  vi.mocked(openHarnessSession).mockImplementationOnce(
    (input) =>
      new Promise((_resolve, reject) => {
        input.signal.addEventListener('abort', () => reject(input.signal.reason), { once: true })
      }),
  )
  const first = models.load('codex')
  const rejected = expect(first).rejects.toThrow('Model discovery cancelled')
  await vi.waitFor(() => expect(vi.mocked(openHarnessSession)).toHaveBeenCalledTimes(1))
  const queued = expect(models.load('codex')).rejects.toThrow('Model discovery cancelled')
  await models.cancel()
  await Promise.all([rejected, queued])
  expect(vi.mocked(openHarnessSession)).toHaveBeenCalledTimes(1)
  vi.mocked(openHarnessSession).mockResolvedValue({
    connection: { close: async () => {} },
    configOptions: options(),
  } as unknown as Awaited<ReturnType<typeof openHarnessSession>>)
  await models.load('codex')
  expect(models.cached('codex')).toHaveLength(2)
})

it('drains both Harness discovery processes when the workspace is suspended', async () => {
  const { models } = await fixture()
  vi.mocked(openHarnessSession).mockImplementation(
    (input) =>
      new Promise((_resolve, reject) => {
        input.signal.addEventListener('abort', () => reject(input.signal.reason), { once: true })
      }),
  )
  const codex = expect(models.load('codex')).rejects.toThrow('Model discovery cancelled')
  const claude = expect(models.load('claude')).rejects.toThrow('Model discovery cancelled')
  await vi.waitFor(() => expect(openHarnessSession).toHaveBeenCalledTimes(2))
  await models.cancel()
  await Promise.all([codex, claude])
})
