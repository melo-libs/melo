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
  connectAgent,
  openAgent,
} from './agent'
import type {
  AgentView,
  AgentHistoryMessage,
  AgentSetup,
  AgentCommandResult,
  AgentFiling,
} from '@shared/types/agent'
import { IpcChannels } from '@shared/types/ipc'

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
const filingSnapshot = (version: number, undone = false): AgentFiling => ({
  id: 'batch',
  version,
  state: 'completed',
  unresolved: [],
  fileCount: 1,
  createdAt: 1,
  changes: [
    {
      id: 'move',
      batchId: 'batch',
      kind: 'move',
      source: 'Inbox/a.pdf',
      path: 'Filed/a.pdf',
      undone,
    },
  ],
})
const filingMessage = (filing: AgentFiling): AgentView['messages'][number] => ({
  id: 'filing:batch',
  role: 'tool',
  content: '',
  createdAt: 1,
  filing,
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

it('refreshes filing summaries attached to older history pages after batch undo', () => {
  const filing = filingSnapshot(1)
  appStore.set(agentHistoryAtom, {
    messages: [{ ...savedMessage('change:move', 10), filing }],
    hasOlder: true,
    hasNewer: true,
  })
  appStore.set(agentViewAtom, liveView([filingMessage(filingSnapshot(2, true))]))
  expect(appStore.get(agentMessagesAtom)[0].filing!.changes[0].undone).toBe(true)
  appStore.set(agentViewAtom, null)
  expect(appStore.get(agentMessagesAtom)[0].filing!.changes[0].undone).toBe(true)
  appStore.set(workspacePathAtom, '/other')
  appStore.set(agentViewAtom, {
    ...liveView([]),
    conversation: { ...conversation, id: 'other', workspaceRoot: '/other' },
  })
  expect(appStore.get(agentMessagesAtom)[0].filing!.changes[0].undone).toBe(true)
})

it.each([true, false])(
  'preserves a hydrated filing on a saved change when its live copy omits it (hasNewer: %s)',
  (hasNewer) => {
    const filing = filingSnapshot(2)
    const change = {
      ...savedMessage('change:move', 10),
      role: 'tool' as const,
      change: filing.changes[0],
      filing,
    }
    appStore.set(agentHistoryAtom, {
      messages: [change],
      hasOlder: true,
      hasNewer,
    })
    appStore.set(agentViewAtom, liveView([filingMessage(filing), { ...change, filing: undefined }]))
    const messages = appStore.get(agentMessagesAtom)
    expect(messages.find((message) => message.id === change.id)?.filing).toBe(filing)
    expect(messages.map((message) => message.id)).toEqual(['change:move'])
    expect(
      new Set(messages.flatMap((message) => (message.filing ? [message.filing.id] : []))).size,
    ).toBe(1)
  },
)

it('does not roll back filing versions when an older history request completes after undo', async () => {
  let finish!: (response: { success: true; data: AgentCommandResult }) => void
  vi.stubGlobal('window', {
    api: { invoke: vi.fn(() => new Promise((resolve) => (finish = resolve))) },
  })
  const pending = agentCommand({ action: 'history' })
  appStore.set(agentViewAtom, liveView([filingMessage(filingSnapshot(3, true))]))
  appStore.set(agentViewAtom, null)
  finish({
    success: true,
    data: {
      history: {
        messages: [{ ...savedMessage('change:move', 10), filing: filingSnapshot(2) }],
        hasOlder: true,
        hasNewer: true,
      },
    },
  })
  await pending
  expect(appStore.get(agentMessagesAtom)[0].filing).toMatchObject({
    version: 3,
    changes: [{ undone: true }],
  })
})

it.each(['command', 'stream'] as const)(
  'keeps background %s filing updates after switching workspaces',
  async (source) => {
    appStore.set(agentHistoryAtom, {
      messages: [{ ...savedMessage('change:move', 10), filing: filingSnapshot(1) }],
      hasOlder: true,
      hasNewer: true,
    })
    appStore.set(workspacePathAtom, '/other')
    const active = {
      ...liveView([]),
      conversation: { ...conversation, id: 'other', workspaceRoot: '/other' },
    }
    appStore.set(agentViewAtom, active)
    const update = liveView([filingMessage(filingSnapshot(2, true))])
    if (source === 'command') {
      vi.stubGlobal('window', {
        api: { invoke: vi.fn().mockResolvedValue({ success: true, data: { view: update } }) },
      })
      await agentCommand({ action: 'undo-filing', conversationId: 'current', batchId: 'batch' })
    } else {
      let publish!: (view: AgentView) => void
      vi.stubGlobal('window', {
        api: {
          on: vi.fn((channel: IpcChannels, listener: (view: AgentView) => void) => {
            if (channel === IpcChannels.OnAgentView) publish = listener
            return vi.fn()
          }),
        },
      })
      const disconnect = connectAgent()
      publish(update)
      disconnect()
    }
    expect(appStore.get(agentViewAtom)).toBe(active)
    appStore.set(agentViewAtom, null)
    expect(appStore.get(agentMessagesAtom)[0].filing).toMatchObject({
      version: 2,
      changes: [{ undone: true }],
    })
  },
)

it('resets filing snapshots when history is cleared', async () => {
  appStore.set(agentViewAtom, liveView([filingMessage(filingSnapshot(3, true))]))
  appStore.set(agentViewAtom, null)
  vi.stubGlobal('window', {
    api: {
      invoke: vi.fn().mockResolvedValue({
        success: true,
        data: { history: { messages: [], hasOlder: false, hasNewer: false } },
      }),
    },
  })
  await agentCommand({ action: 'clear-history' })
  appStore.set(agentHistoryAtom, {
    messages: [{ ...savedMessage('change:move', 10), filing: filingSnapshot(1) }],
    hasOlder: false,
    hasNewer: false,
  })
  expect(appStore.get(agentMessagesAtom)[0].filing!.version).toBe(1)
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
