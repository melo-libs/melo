import { beforeEach, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import type { AgentConfiguration, AgentCommand } from '../../shared/types/agent'
import { ipcMain } from 'electron'
import { setupAgentIPC } from './agent'
import type { createRuntimeFactory } from '../agent/runtime/runtime'
import { testAgentApi } from '../agent/runtime/apiConnection'
import { checkNativeAuthentication } from '../agent/runtime/nativeAuthentication'

const {
  profiles,
  sender,
  select,
  save,
  reconcile,
  cancel,
  respond,
  invalidate,
  runtimeOptions,
  suspend,
  resume,
} = vi.hoisted(() => ({
  profiles: {
    claude: { provider: 'claude', access: 'native', baseUrl: '', model: '', hasApiKey: false },
    codex: { provider: 'codex', access: 'native', baseUrl: '', model: '', hasApiKey: false },
  } as Record<'claude' | 'codex', AgentConfiguration>,
  sender: { mainFrame: {}, send: vi.fn() },
  invalidate: vi.fn(),
  runtimeOptions: {
    current: undefined as Parameters<typeof createRuntimeFactory>[0] | undefined,
  },
  suspend: vi.fn(async () => {}),
  resume: vi.fn(),
  select: vi.fn(),
  save: vi.fn(),
  reconcile: vi.fn(),
  cancel: vi.fn().mockResolvedValue(undefined),
  respond: vi.fn(),
}))
vi.mock('electron', () => ({
  app: { getPath: () => '/fixture', getAppPath: () => '/fixture', on: vi.fn() },
  ipcMain: { on: vi.fn(), handle: vi.fn() },
}))
vi.mock('node:fs', () => ({ mkdirSync: vi.fn() }))
vi.mock('../windows', () => ({ getMainWindow: () => ({ webContents: sender }) }))
vi.mock('../api/indexer', () => ({ activeWorkspaceRoot: () => '/notes' }))
vi.mock('../agent/storage/agentSettings', () => ({
  AgentSettings: class {
    get(provider = 'codex') {
      return profiles[provider as keyof typeof profiles]
    }
    key = vi.fn(() => 'fixture-saved-key')
    select = select
    invalidateApiVerification = invalidate
    setAccess = save
    saveVerifiedApi = save
  },
}))
vi.mock('../agent/runtime/runtimeEnvironment', () => ({
  RuntimeEnvironment: class {
    installing = false
    async inspect() {
      const ready = {
        status: 'ready',
        source: 'managed',
        transferred: 0,
        total: 0,
      }
      return { claude: ready, codex: ready }
    }
    async requireProvider() {
      return '/fixture/cli'
    }
    async findNode() {
      return '/fixture/node'
    }
    async requireNode() {
      return '/fixture/node'
    }
  },
}))
vi.mock('../agent/runtime/nativeModels', () => ({
  NativeModels: class {
    cached() {
      return undefined
    }
  },
}))
vi.mock('../agent/runtime/apiConnection', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../agent/runtime/apiConnection')>()),
  testAgentApi: vi.fn(),
}))
vi.mock('../agent/runtime/nativeAuthentication', () => ({ checkNativeAuthentication: vi.fn() }))
vi.mock('../agent/storage/conversationStore', () => ({ ConversationStore: class {} }))
vi.mock('../agent/storage/fileIntake', () => ({ FileIntake: class {} }))
vi.mock('../agent/storage/memory', () => ({ MemoryService: class {} }))
vi.mock('../agent/workspace/documentAccess', () => ({ DocumentAccess: class {} }))
vi.mock('../agent/workspace/changeJournal', () => ({
  ChangeJournal: class {
    reconcileAttachments = reconcile
  },
}))
vi.mock('../agent/workspace/workspaceAccess', () => ({ WorkspaceAccess: class {} }))
vi.mock('../agent/mcp/workspaceTools', () => ({ startWorkspaceTools: vi.fn() }))
vi.mock('../agent/runtime/runtime', () => ({
  createRuntimeFactory: vi.fn((options) => {
    runtimeOptions.current = options
  }),
}))
vi.mock('../agent/agentService', () => ({
  AgentService: class {
    open() {
      return { conversation: { workspaceRoot: '/notes' } }
    }
    cancel = cancel
    respond = respond
    suspend = suspend
    resume = resume
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
  reconcile.mockReset()
  invalidate.mockReset().mockReturnValue(false)
  for (const provider of ['claude', 'codex'] as const)
    profiles[provider] = { provider, access: 'native', baseUrl: '', model: '', hasApiKey: false }
  vi.mocked(testAgentApi).mockReset()
  vi.mocked(checkNativeAuthentication).mockResolvedValue({ status: 'signed-in' })
  setupAgentIPC()
})

it('keeps stop and permission denial available when attachment reconciliation fails', async () => {
  const conversationId = '00000000-0000-4000-8000-000000000001'
  const permissionId = '00000000-0000-4000-8000-000000000002'
  reconcile.mockImplementation(() => {
    throw new Error('registry sync failed')
  })
  expect((await invoke({ action: 'draft-attachments', workspaceRoot: '/notes' })).success).toBe(
    false,
  )
  reconcile.mockClear()
  expect((await invoke({ action: 'cancel', conversationId })).success).toBe(true)
  expect(
    (
      await invoke({
        action: 'permission',
        conversationId,
        permissionId,
        allow: false,
      })
    ).success,
  ).toBe(true)
  expect(cancel).toHaveBeenCalledWith(conversationId)
  expect(respond).toHaveBeenCalledWith(conversationId, permissionId, false, undefined)
  expect(reconcile).not.toHaveBeenCalled()
})

function invoke(command: AgentCommand) {
  const handler = vi.mocked(ipcMain.handle).mock.calls[0][1]
  return handler(
    { sender, senderFrame: sender.mainFrame } as unknown as IpcMainInvokeEvent,
    command,
  )
}

it('switches providers without waiting for a CLI account check', async () => {
  vi.mocked(checkNativeAuthentication).mockImplementation(() => new Promise(() => {}))
  const result = await invoke({ action: 'select-provider', provider: 'claude' })
  expect(select).toHaveBeenCalledWith('claude')
  expect(result.success).toBe(true)
  expect(result.data.setup.configuration.provider).toBe('claude')
  expect(result.data.setup.connectionProfiles).toEqual({
    claude: { access: 'native', apiConfigured: false },
    codex: { access: 'native', apiConfigured: false },
  })
  expect(checkNativeAuthentication).not.toHaveBeenCalled()
})

it('saves an account-mode switch without waiting for a CLI account check', async () => {
  vi.mocked(checkNativeAuthentication).mockImplementation(() => new Promise(() => {}))
  const result = await invoke({
    action: 'set-access',
    provider: 'codex',
    access: 'native',
  })
  expect(result.success).toBe(true)
  expect(save).toHaveBeenCalled()
  expect(checkNativeAuthentication).not.toHaveBeenCalled()
})

it('returns configuration without probing accounts and checks only on the dedicated command', async () => {
  const initial = await invoke({ action: 'setup', provider: 'codex' })
  expect(initial.success).toBe(true)
  expect(checkNativeAuthentication).not.toHaveBeenCalled()
  const refresh = await invoke({ action: 'check-sign-in', provider: 'claude' })
  expect(refresh.data.authentication).toEqual({ status: 'signed-in' })
  expect(checkNativeAuthentication).toHaveBeenCalledTimes(1)
  expect(checkNativeAuthentication).toHaveBeenCalledWith('/fixture/cli', 'claude', '/fixture/node')
})

it.each([true, false])(
  'only persists verified API configuration when the probe succeeds: %s',
  async (success) => {
    vi.mocked(testAgentApi).mockReset()
    if (success) vi.mocked(testAgentApi).mockResolvedValue(undefined)
    else vi.mocked(testAgentApi).mockRejectedValue(new Error('AGENT_API_AUTH_FAILED'))
    const result = await invoke({
      action: 'configure',
      provider: 'codex',
      access: 'api',
      apiService: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'fixture-model',
      apiKey: 'fixture-key',
    })
    expect(result.success).toBe(success)
    expect(testAgentApi).toHaveBeenCalledTimes(1)
    if (success)
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'fixture-model', apiKey: 'fixture-key' }),
      )
    else {
      expect(save).not.toHaveBeenCalled()
      expect(result.error).toBe('AGENT_API_AUTH_FAILED')
    }
  },
)

it.each(['different-endpoint', 'different-product'])(
  'does not reuse saved credentials for %s',
  async (change) => {
    profiles.claude = {
      provider: 'claude',
      access: 'api',
      baseUrl: 'https://open.bigmodel.cn/api/anthropic',
      model: 'glm-5.3',
      hasApiKey: true,
      apiService: 'zhipu',
      apiVerified: true,
    }
    const result = await invoke({
      action: 'configure',
      provider: 'claude',
      access: 'api',
      baseUrl: change === 'different-endpoint' ? 'https://other.example' : profiles.claude.baseUrl,
      model: 'glm-5.3',
      apiService: change === 'different-endpoint' ? 'custom' : 'zhipu-coding',
    })
    expect(result.success).toBe(false)
    expect(result.error).toBe('AGENT_API_KEY_REQUIRED')
    expect(testAgentApi).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
  },
)

it.each([true, false])(
  'publishes verification invalidation only when the rejected runtime credentials still match: %s',
  (changed) => {
    invalidate.mockReturnValue(changed)
    const configuration: AgentConfiguration = {
      provider: 'claude',
      access: 'api',
      baseUrl: 'https://api.deepseek.com/anthropic',
      model: 'deepseek-flash',
      apiService: 'deepseek',
      hasApiKey: true,
      apiVerified: true,
    }
    runtimeOptions.current!.onApiAuthenticationFailed!(configuration, 'private-fixture-key')
    expect(invalidate).toHaveBeenCalledWith({ ...configuration, apiKey: 'private-fixture-key' })
    if (changed) {
      expect(sender.send).toHaveBeenCalledWith('on-agent-api-verification-invalidated', {
        provider: 'claude',
        baseUrl: configuration.baseUrl,
        model: configuration.model,
        apiService: 'deepseek',
      })
      expect(JSON.stringify(sender.send.mock.calls)).not.toContain('private-fixture-key')
    } else expect(sender.send).not.toHaveBeenCalled()
  },
)

it.each(['success', 'AGENT_API_AUTH_FAILED', 'AGENT_API_NETWORK_ERROR'] as const)(
  'tests only the saved API profile without reconfiguring the active runtime: %s',
  async (outcome) => {
    profiles.claude = {
      provider: 'claude',
      access: 'api',
      baseUrl: 'https://api.deepseek.com/anthropic',
      model: 'deepseek-flash',
      apiService: 'deepseek',
      hasApiKey: true,
      apiVerified: true,
    }
    const saved = { ...profiles.claude }
    if (outcome === 'success') vi.mocked(testAgentApi).mockResolvedValue(undefined)
    else vi.mocked(testAgentApi).mockRejectedValue(new Error(outcome))
    const result = await invoke({ action: 'test-connection', provider: 'claude' })
    expect(testAgentApi).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'claude',
        baseUrl: saved.baseUrl,
        model: saved.model,
        apiKey: 'fixture-saved-key',
      }),
    )
    expect(result.success).toBe(outcome === 'success')
    expect(save).not.toHaveBeenCalled()
    expect(suspend).not.toHaveBeenCalled()
    expect(resume).not.toHaveBeenCalled()
    expect(select).not.toHaveBeenCalled()
    expect(profiles.claude).toEqual(saved)
    if (outcome === 'AGENT_API_AUTH_FAILED')
      expect(invalidate).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: 'fixture-saved-key' }),
      )
    else expect(invalidate).not.toHaveBeenCalled()
  },
)

it('rejects an invalid replacement key before stopping the runtime or overwriting the saved connection', async () => {
  profiles.claude = {
    provider: 'claude',
    access: 'api',
    baseUrl: 'https://api.deepseek.com/anthropic',
    model: 'deepseek-flash',
    apiService: 'deepseek',
    hasApiKey: true,
    apiVerified: true,
  }
  vi.mocked(testAgentApi).mockRejectedValue(new Error('AGENT_API_AUTH_FAILED'))
  const saved = { ...profiles.claude }
  const result = await invoke({
    action: 'configure',
    provider: 'claude',
    access: 'api',
    baseUrl: saved.baseUrl,
    model: saved.model,
    apiService: 'deepseek',
    apiKey: 'wrong-replacement',
  })
  expect(result.success).toBe(false)
  expect(save).not.toHaveBeenCalled()
  expect(suspend).not.toHaveBeenCalled()
  expect(result.data?.setup?.configuration).toEqual(saved)
})
