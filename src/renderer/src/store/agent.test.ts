import { afterEach, expect, it, vi } from 'vitest'
import { appStore } from './appStore'
import { workspacePathAtom } from './workspace'
import { activeTabIdAtom } from './editor'
import {
  agentCommand,
  agentSetupAtom,
  agentNativeCatalogsAtom,
  agentWindowAtom,
  agentViewAtom,
  agentHistoryAtom,
  agentMessagesAtom,
  openAgent,
} from './agent'
import type {
  AgentView,
  AgentHistoryMessage,
  AgentSetup,
  AgentCommandResult,
} from '@shared/types/agent'

vi.mock('./documentSession', () => ({ handleAgentDocument: vi.fn() }))
afterEach(() => {
  vi.unstubAllGlobals()
  appStore.set(agentSetupAtom, null)
  appStore.set(agentNativeCatalogsAtom, {})
  appStore.set(workspacePathAtom, null)
  appStore.set(activeTabIdAtom, null)
  appStore.set(agentHistoryAtom, null)
  appStore.set(agentViewAtom, null)
})

it('keeps an unsent draft across contextual invocations unless explicitly replaced', () => {
  appStore.set(workspacePathAtom, '/notes')
  appStore.set(activeTabIdAtom, '/notes/note.md')
  openAgent({ draft: 'Unsent thought' })
  appStore.set(agentWindowAtom, (state) => ({ ...state, open: false }))
  openAgent()
  expect(appStore.get(agentWindowAtom).draft).toBe('Unsent thought')
  openAgent({ selection: 'Another passage', anchor: { x: 42.4, y: 80.7 } })
  expect(appStore.get(agentWindowAtom)).toMatchObject({
    draft: 'Unsent thought',
    context: { filePath: 'note.md', selection: 'Another passage' },
    anchor: { x: 42, y: 81 },
  })
  openAgent({ draft: 'Explicit search question' })
  expect(appStore.get(agentWindowAtom).draft).toBe('Explicit search question')
})

it('restores a minimized conversation when invoked from another entry point', () => {
  appStore.set(workspacePathAtom, '/notes')
  openAgent({ draft: 'Keep this thought' })
  appStore.set(agentWindowAtom, (state) => ({ ...state, collapsed: true }))
  openAgent()
  expect(appStore.get(agentWindowAtom)).toMatchObject({
    open: true,
    collapsed: false,
    draft: 'Keep this thought',
  })
})

const conversation = {
  id: 'current',
  workspaceRoot: '/notes',
  title: '',
  provider: 'claude' as const,
  updatedAt: 1,
}
const liveView = (messages: AgentView['messages']): AgentView => ({
  conversation,
  messages,
  status: 'running',
  error: null,
  permission: null,
  allowChanges: false,
})
const savedMessage = (id: string, sequence: number, content = id): AgentHistoryMessage => ({
  id,
  sequence,
  conversationId: 'current',
  workspaceRoot: '/notes',
  content,
  createdAt: sequence,
  role: 'assistant',
})

it('reconciles streamed messages without losing saved timeline metadata', () => {
  appStore.set(agentHistoryAtom, {
    messages: [savedMessage('reply', 10, 'Partial')],
    hasOlder: true,
    hasNewer: false,
  })
  appStore.set(
    agentViewAtom,
    liveView([
      { id: 'reply', role: 'assistant', content: 'Complete', createdAt: 10 },
      { id: 'next', role: 'assistant', content: 'Next', createdAt: 11 },
    ]),
  )
  expect(appStore.get(agentMessagesAtom)).toMatchObject([
    { id: 'reply', sequence: 10, content: 'Complete' },
    { id: 'next', workspaceRoot: '/notes', conversationId: 'current' },
  ])
})

it('does not append live output into an older history page', () => {
  appStore.set(agentHistoryAtom, {
    messages: [savedMessage('old', 1)],
    hasOlder: false,
    hasNewer: true,
  })
  appStore.set(
    agentViewAtom,
    liveView([{ id: 'new', role: 'assistant', content: 'New', createdAt: 20 }]),
  )
  expect(appStore.get(agentMessagesAtom).map((message) => message.id)).toEqual(['old'])
})

it('does not reintroduce earlier runtime messages outside the loaded page', () => {
  appStore.set(agentHistoryAtom, {
    messages: [savedMessage('loaded', 10)],
    hasOlder: true,
    hasNewer: false,
  })
  appStore.set(
    agentViewAtom,
    liveView([{ id: 'earlier', role: 'assistant', content: 'Earlier', createdAt: 2 }]),
  )
  expect(appStore.get(agentMessagesAtom).map((message) => message.id)).toEqual(['loaded'])
})

it('does not let a slow native catalog overwrite a newer model choice', async () => {
  let finishCatalog!: (result: { success: true; data: AgentCommandResult }) => void
  const setup = (model: string): AgentSetup => ({
    configuration: {
      provider: 'codex',
      access: 'native',
      model: '',
      baseUrl: '',
      hasApiKey: false,
      native: { model },
    },
    runtimeAvailable: true,
    installing: false,
  })
  const invoke = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishCatalog = resolve
        }),
    )
    .mockResolvedValueOnce({ success: true, data: { setup: setup('new-choice') } })
  vi.stubGlobal('window', { api: { invoke } })
  const pending = agentCommand({ action: 'native-options', provider: 'codex' })
  await agentCommand({
    action: 'native-option',
    provider: 'codex',
    category: 'model',
    value: 'new-choice',
  })
  finishCatalog({ success: true, data: { setup: setup('old-choice') } })
  await pending
  expect(appStore.get(agentSetupAtom)?.configuration.native?.model).toBe('new-choice')
})

it('does not let parallel account checks invalidate a provider selection', async () => {
  let finish!: (result: { success: true; data: AgentCommandResult }) => void
  const selected: AgentSetup = {
    configuration: {
      provider: 'codex',
      access: 'native',
      baseUrl: '',
      model: '',
      hasApiKey: false,
    },
    runtimeAvailable: true,
    installing: false,
  }
  vi.stubGlobal('window', {
    api: {
      invoke: vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              finish = resolve
            }),
        )
        .mockResolvedValueOnce({
          success: true,
          data: { authentication: { status: 'signed-out' } },
        }),
    },
  })
  const pending = agentCommand({ action: 'select-provider', provider: 'codex' })
  await agentCommand({ action: 'check-sign-in', provider: 'claude' })
  finish({ success: true, data: { setup: selected } })
  await pending
  expect(appStore.get(agentSetupAtom)?.configuration.provider).toBe('codex')
})

it.each(['prepare', 'native-options'] as const)(
  'does not let background %s invalidate a foreground provider selection',
  async (action) => {
    let finish!: (result: { success: true; data: AgentCommandResult }) => void
    const selected: AgentSetup = {
      configuration: {
        provider: 'claude',
        access: 'api',
        baseUrl: 'http://127.0.0.1',
        model: 'fixture',
        hasApiKey: true,
      },
      runtimeAvailable: true,
      installing: false,
    }
    vi.stubGlobal('window', {
      api: {
        invoke: vi
          .fn()
          .mockImplementationOnce(
            () =>
              new Promise((resolve) => {
                finish = resolve
              }),
          )
          .mockResolvedValueOnce({ success: true, data: {} }),
      },
    })
    const pending = agentCommand({ action: 'select-provider', provider: 'claude' })
    await agentCommand(
      action === 'prepare' ? { action, conversationId: 'current' } : { action, provider: 'codex' },
    )
    finish({ success: true, data: { setup: selected } })
    await pending
    expect(appStore.get(agentSetupAtom)?.configuration.provider).toBe('claude')
  },
)

it('retains a catalog that completes after navigating away and back without rewriting connection preferences', async () => {
  const setup = (provider: 'claude' | 'codex'): AgentSetup => ({
    configuration: {
      provider,
      access: 'native',
      baseUrl: '',
      model: '',
      hasApiKey: false,
      native: { model: 'saved', effort: 'high' },
    },
    runtimeAvailable: true,
    installing: false,
  })
  let finish!: (value: { success: true; data: AgentCommandResult }) => void
  vi.stubGlobal('window', {
    api: {
      invoke: vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              finish = resolve
            }),
        )
        .mockResolvedValueOnce({ success: true, data: { setup: setup('claude') } })
        .mockResolvedValueOnce({ success: true, data: { setup: setup('codex') } }),
    },
  })
  appStore.set(agentSetupAtom, setup('codex'))
  const pending = agentCommand({ action: 'native-options', provider: 'codex' })
  await agentCommand({ action: 'select-provider', provider: 'claude' })
  await agentCommand({ action: 'select-provider', provider: 'codex' })
  const controls = [
    {
      id: 'model',
      category: 'model' as const,
      value: 'saved',
      options: [{ value: 'saved', label: 'Saved model' }],
    },
  ]
  finish({ success: true, data: { setup: { ...setup('codex'), nativeControls: controls } } })
  await pending
  expect(appStore.get(agentNativeCatalogsAtom).codex?.controls).toEqual(controls)
  expect(appStore.get(agentSetupAtom)?.configuration.native).toEqual({
    model: 'saved',
    effort: 'high',
  })
})
