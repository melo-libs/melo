import { createHash } from 'node:crypto'
import { expect, it, vi, afterEach } from 'vitest'
import { AcpConnection } from './acpConnection'
import { openHarnessSession } from './harnessSession'
import { RuntimeEnvironment } from './runtimeEnvironment'
import { codexLaunch } from './codexLaunch'
import { HarnessProcess } from './harnessProcess'

vi.mock('./codexLaunch', () => ({
  CODEX_API_PROVIDER: 'melo-api',
  CODEX_API_KEY_ENV: 'MELO_CODEX_API_KEY',
  codexLaunch: vi.fn(async () => ({})),
}))
afterEach(() => vi.restoreAllMocks())

it('reserves the MCP deadline during prewarm and supplies task transports under that key', async () => {
  const environment = new RuntimeEnvironment('unused')
  vi.spyOn(environment, 'requireNode').mockResolvedValue(process.execPath)
  vi.spyOn(environment, 'requireProvider').mockResolvedValue('/fixture/cli')
  const createSession = vi.fn(async () => ({ sessionId: 'test', configOptions: [] }))
  const start = vi.spyOn(AcpConnection, 'start').mockResolvedValue({
    isClosed: false,
    close: async () => {},
    closeSession: async () => {},
    createSession,
  } as unknown as AcpConnection)
  const options = {
    environment,
    codexLauncher: '',
    workspaceRoot: '/fixture',
    configuration: {
      provider: 'codex' as const,
      access: 'native' as const,
      model: '',
      baseUrl: '',
      hasApiKey: false,
    },
  }
  const host = new HarnessProcess()
  try {
    await host.prepare(options)
    const config = JSON.parse(start.mock.calls[0][0].launch.env!.CODEX_CONFIG!)
    expect(createSession).not.toHaveBeenCalled()
    for (const port of [1234, 5678]) {
      const lease = await host.open({
        ...options,
        signal: new AbortController().signal,
        mcpServers: [{ type: 'http', name: 'task', url: `http://127.0.0.1:${port}`, headers: [] }],
        onUpdate: () => {},
      })
      expect(config.mcp_servers[lease.toolName]).toEqual({ tool_timeout_sec: 1800 })
      expect(createSession).toHaveBeenLastCalledWith({
        mcpServers: [
          { type: 'http', name: lease.toolName, url: `http://127.0.0.1:${port}`, headers: [] },
        ],
      })
      await lease.release(true)
    }
    expect(start).toHaveBeenCalledTimes(1)
  } finally {
    await host.close()
  }
})

it.each(['claude', 'codex'] as const)(
  'pins %s preferences only in the owned subprocess/session',
  async (provider) => {
    const environment = new RuntimeEnvironment('unused')
    vi.spyOn(environment, 'requireNode').mockResolvedValue(process.execPath)
    vi.spyOn(environment, 'requireProvider').mockResolvedValue('/fixture/cli')
    const close = vi.fn(async () => {})
    const createSession = vi.fn(async () => ({ sessionId: 'test', configOptions: [] }))
    const start = vi
      .spyOn(AcpConnection, 'start')
      .mockResolvedValue({ close, createSession } as unknown as AcpConnection)
    const fingerprint = () => createHash('sha256').update(JSON.stringify(process.env)).digest('hex')
    const original = fingerprint()
    const { connection } = await openHarnessSession({
      environment,
      codexLauncher: 'fixture',
      workspaceRoot: process.cwd(),
      signal: new AbortController().signal,
      configuration: {
        provider,
        access: 'native',
        model: 'api-profile',
        baseUrl: 'https://api.example',
        hasApiKey: true,
        native: { model: 'saved-native-model', effort: 'high' },
      },
      mcpServers: [],
      onUpdate: () => {},
    })
    await connection.close()
    expect(fingerprint()).toBe(original)
    const env = start.mock.calls[0][0].launch.env!
    expect(env).not.toBe(process.env)
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(env.OPENAI_API_KEY).toBeUndefined()
    if (provider === 'codex') {
      expect(codexLaunch).toHaveBeenCalled()
      expect(env.INITIAL_AGENT_MODE).toBe('agent-full-access')
      expect(JSON.parse(env.CODEX_CONFIG!)).toMatchObject({
        sandbox_mode: 'danger-full-access',
        approval_policy: 'never',
        model: 'saved-native-model',
        model_reasoning_effort: 'high',
        features: { shell_tool: true, apply_patch_freeform: true, hooks: false, memories: false },
      })
    } else {
      expect(createSession).toHaveBeenCalledWith(
        expect.objectContaining({
          _meta: {
            claudeCode: {
              options: expect.objectContaining({
                model: 'saved-native-model',
                settingSources: [],
                tools: { type: 'preset', preset: 'claude_code' },
                allowDangerouslySkipPermissions: true,
                sandbox: { enabled: false },
                settings: { disableAllHooks: true },
              }),
            },
          },
        }),
      )
    }
  },
)

it('closes the adapter when cancellation occurs after initialize but during session creation', async () => {
  const controller = new AbortController()
  const environment = new RuntimeEnvironment('unused')
  vi.spyOn(environment, 'requireNode').mockResolvedValue(process.execPath)
  vi.spyOn(environment, 'requireProvider').mockResolvedValue('/fixture/cli')
  let rejectSession: (reason: Error) => void = () => {}
  const close = vi.fn(async () => {
    rejectSession(new Error('disconnected'))
  })
  vi.spyOn(AcpConnection, 'start').mockResolvedValue({
    close,
    createSession: () =>
      new Promise((_resolve, reject) => {
        rejectSession = reject
        controller.abort()
      }),
  } as unknown as AcpConnection)
  await expect(
    openHarnessSession({
      environment,
      codexLauncher: '',
      workspaceRoot: process.cwd(),
      signal: controller.signal,
      configuration: {
        provider: 'claude',
        access: 'native',
        model: '',
        baseUrl: '',
        hasApiKey: false,
      },
      mcpServers: [],
      onUpdate: () => {},
    }),
  ).rejects.toThrow('disconnected')
  expect(close).toHaveBeenCalled()
})

it('selects native full access without changing the workspace or persistent settings', async () => {
  const environment = new RuntimeEnvironment('unused')
  vi.spyOn(environment, 'requireNode').mockResolvedValue(process.execPath)
  vi.spyOn(environment, 'requireProvider').mockResolvedValue('/fixture/cli')
  const createSession = vi.fn(async () => ({ sessionId: 'scratch', configOptions: [] }))
  const close = vi.fn(async () => {})
  const setConfigOption = vi.fn(async () => [])
  const start = vi
    .spyOn(AcpConnection, 'start')
    .mockResolvedValue({ createSession, setConfigOption, close } as unknown as AcpConnection)
  const scratchDirectory = '/private/tmp/melo-fixture'
  const original = process.env.CLAUDE_CODE_TMPDIR
  const session = await openHarnessSession({
    environment,
    codexLauncher: '',
    workspaceRoot: '/workspace',
    scratchDirectory,
    signal: new AbortController().signal,
    configuration: {
      provider: 'claude',
      access: 'native',
      model: '',
      baseUrl: '',
      hasApiKey: false,
    },
    mcpServers: [],
    onUpdate: () => {},
  })
  await session.connection.close()
  expect(process.env.CLAUDE_CODE_TMPDIR).toBe(original)
  expect(setConfigOption).toHaveBeenCalledWith('mode', 'bypassPermissions')
  expect(start.mock.calls[0][0].workspaceRoot).toBe('/workspace')
  expect(start.mock.calls[0][0].launch.env!.CLAUDE_CODE_TMPDIR).toBe(scratchDirectory)
  expect(createSession).toHaveBeenCalledWith(
    expect.objectContaining({
      _meta: {
        claudeCode: {
          options: expect.objectContaining({
            systemPrompt: {
              type: 'preset',
              preset: 'claude_code',
              append: expect.stringContaining(scratchDirectory),
            },
            allowDangerouslySkipPermissions: true,
            sandbox: { enabled: false },
            settings: { disableAllHooks: true },
          }),
        },
      },
    }),
  )
})

it('pins API routing for Codex without placing credentials in config or native preferences', async () => {
  const environment = new RuntimeEnvironment('unused')
  vi.spyOn(environment, 'requireNode').mockResolvedValue(process.execPath)
  vi.spyOn(environment, 'requireProvider').mockResolvedValue('/fixture/cli')
  const close = vi.fn(async () => {}),
    authenticate = vi.fn(async () => {})
  const start = vi.spyOn(AcpConnection, 'start').mockResolvedValue({
    close,
    authenticate,
    createSession: async () => ({ sessionId: 'fixture', configOptions: [] }),
  } as unknown as AcpConnection)
  const { connection } = await openHarnessSession({
    environment,
    codexLauncher: 'fixture',
    workspaceRoot: process.cwd(),
    signal: new AbortController().signal,
    configuration: {
      provider: 'codex',
      access: 'api',
      apiService: 'kimi',
      baseUrl: 'https://api.moonshot.cn/v1',
      model: 'kimi-k3.1-pro',
      hasApiKey: true,
      native: { model: 'native-model', effort: 'xhigh' },
    },
    apiKey: 'fixture-key',
    mcpServers: [],
    onUpdate: () => {},
  })
  await connection.close()
  const env = start.mock.calls[0][0].launch.env!
  expect(JSON.parse(env.CODEX_CONFIG!)).toMatchObject({
    model_provider: 'melo-api',
    model: 'kimi-k3.1-pro',
    model_reasoning_effort: 'high',
  })
  expect(env.CODEX_CONFIG).not.toContain('fixture-key')
  expect(env.CODEX_CONFIG).not.toContain('native-model')
  expect(codexLaunch).toHaveBeenCalledWith(
    expect.anything(),
    '/fixture/cli',
    expect.anything(),
    expect.anything(),
    expect.anything(),
    expect.anything(),
    { baseUrl: 'https://api.moonshot.cn/v1', apiService: 'kimi' },
  )
  expect(authenticate).not.toHaveBeenCalled()
  expect(env.MODEL_PROVIDER).toBe('melo-api')
  expect(env.MELO_CODEX_API_KEY).toBe('fixture-key')
})
