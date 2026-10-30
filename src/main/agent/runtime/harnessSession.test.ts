import { createHash } from 'node:crypto'
import { expect, it, vi, afterEach } from 'vitest'
import { AcpConnection } from './acpConnection'
import { openHarnessSession } from './harnessSession'
import { RuntimeEnvironment } from './runtimeEnvironment'
import { codexLaunch } from './codexLaunch'

vi.mock('./codexLaunch', () => ({ codexLaunch: vi.fn(async () => ({})) }))
afterEach(() => vi.restoreAllMocks())

it.each(['claude', 'codex'] as const)(
  'pins %s preferences only in the owned subprocess/session',
  async (provider) => {
    const environment = new RuntimeEnvironment('unused')
    vi.spyOn(environment, 'requireNode').mockResolvedValue(process.execPath)
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
      expect(JSON.parse(env.CODEX_CONFIG!)).toMatchObject({
        model: 'saved-native-model',
        model_reasoning_effort: 'high',
        features: { shell_tool: false, hooks: false, memories: false },
      })
    } else {
      expect(createSession).toHaveBeenCalledWith(
        expect.objectContaining({
          _meta: {
            claudeCode: {
              options: expect.objectContaining({
                model: 'saved-native-model',
                settingSources: [],
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
