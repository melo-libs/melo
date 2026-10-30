import { beforeEach, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import type { AgentConfiguration, AgentCommand } from '../../shared/types/agent'
import { ipcMain } from 'electron'
import { setupAgentIPC } from './agent'
import { checkNativeAuthentication } from '../agent/runtime/nativeAuthentication'

const { profiles, sender, select, save } = vi.hoisted(() => ({
  profiles: {
    claude: { provider: 'claude', access: 'native', baseUrl: '', model: '', hasApiKey: false },
    codex: { provider: 'codex', access: 'native', baseUrl: '', model: '', hasApiKey: false },
  } satisfies Record<string, AgentConfiguration>,
  sender: { mainFrame: {} },
  select: vi.fn(),
  save: vi.fn(),
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
    select = select
    save = save
  },
}))
vi.mock('../agent/runtime/runtimeEnvironment', () => ({
  RuntimeEnvironment: class {
    installing = false
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
vi.mock('../agent/runtime/nativeAuthentication', () => ({ checkNativeAuthentication: vi.fn() }))
vi.mock('../agent/storage/conversationStore', () => ({ ConversationStore: class {} }))
vi.mock('../agent/storage/memory', () => ({ MemoryService: class {} }))
vi.mock('../agent/workspace/documentAccess', () => ({ DocumentAccess: class {} }))
vi.mock('../agent/workspace/changeJournal', () => ({ ChangeJournal: class {} }))
vi.mock('../agent/workspace/workspaceAccess', () => ({ WorkspaceAccess: class {} }))
vi.mock('../agent/mcp/workspaceTools', () => ({ startWorkspaceTools: vi.fn() }))
vi.mock('../agent/runtime/runtime', () => ({ createRuntimeFactory: vi.fn() }))
vi.mock('../agent/agentService', () => ({
  AgentService: class {
    suspend = vi.fn().mockResolvedValue(undefined)
    resume = vi.fn()
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(checkNativeAuthentication).mockResolvedValue({ status: 'signed-in' })
  setupAgentIPC()
})

function invoke(command: AgentCommand) {
  const handler = vi.mocked(ipcMain.handle).mock.calls[0][1]
  return handler({ sender, senderFrame: sender.mainFrame } as IpcMainInvokeEvent, command)
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
    action: 'configure',
    provider: 'codex',
    access: 'native',
    baseUrl: '',
    model: '',
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
  expect(checkNativeAuthentication).toHaveBeenCalledWith('/fixture/node', 'claude')
})
