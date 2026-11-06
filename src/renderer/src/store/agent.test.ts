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
  agentPresenceAtom,
  agentAccountsAtom,
} from './agent'
import type {
  AgentComponents,
  AgentConfiguration,
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
  appStore.set(agentWindowAtom, {
    open: false,
    collapsed: false,
    context: {},
    anchor: null,
    draft: '',
  })
  appStore.set(agentAccountsAtom, { claude: { status: 'unknown' }, codex: { status: 'unknown' } })
  vi.useRealTimers()
})

it('keeps an unsent draft across contextual invocations unless explicitly replaced', () => {
  appStore.set(workspacePathAtom, '/notes')
  appStore.set(activeTabIdAtom, '/notes/note.md')
  openAgent({ draft: 'Unsent thought' })
  appStore.set(agentWindowAtom, (state) => ({ ...state, open: false }))
  openAgent()
  expect(appStore.get(agentWindowAtom).draft).toBe('Unsent thought')
  expect(appStore.get(agentWindowAtom).context).toEqual({})
  openAgent({ selection: 'Another passage', anchor: { x: 42.4, y: 80.7 } })
  expect(appStore.get(agentWindowAtom)).toMatchObject({
    draft: 'Unsent thought',
    context: { filePath: 'note.md', selection: 'Another passage' },
    anchor: null,
  })
  openAgent({ draft: 'Explicit search question' })
  expect(appStore.get(agentWindowAtom).draft).toBe('Explicit search question')
})

it('updates quotes without repositioning an expanded window, but anchors a collapsed one', () => {
  appStore.set(workspacePathAtom, '/notes')
  appStore.set(activeTabIdAtom, '/notes/first.md')
  openAgent({ selection: 'First passage', anchor: { x: 42.4, y: 80.7 } })
  const anchor = appStore.get(agentWindowAtom).anchor
  expect(anchor).toEqual({ x: 42, y: 81 })
  appStore.set(activeTabIdAtom, '/notes/second.md')
  openAgent({ selection: 'Second passage', anchor: { x: 300, y: 400 } })
  expect(appStore.get(agentWindowAtom).anchor).toBe(anchor)
  expect(appStore.get(agentWindowAtom).context).toEqual({
    filePath: 'second.md',
    selection: 'Second passage',
  })
  appStore.set(agentWindowAtom, (state) => ({ ...state, collapsed: true }))
  openAgent({ selection: 'Third passage', anchor: { x: 300, y: 400 } })
  expect(appStore.get(agentWindowAtom)).toMatchObject({
    open: true,
    collapsed: false,
    anchor: { x: 300, y: 400 },
  })
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

it('uses explicit task states, not response text or a missing native process, for the mascot', () => {
  appStore.set(workspacePathAtom, '/notes')
  const view = liveView([{ id: 'u', role: 'user', content: 'Help', createdAt: 1 }])
  appStore.set(agentViewAtom, view)
  expect(appStore.get(agentPresenceAtom).state).toBe('working')
  appStore.set(agentViewAtom, {
    ...view,
    status: 'awaiting-permission',
    permission: {
      id: 'permission',
      operation: { kind: 'trash', path: 'Inbox/file.pdf' },
    },
  })
  expect(appStore.get(agentPresenceAtom).state).toBe('waiting')
  appStore.set(agentViewAtom, {
    ...view,
    status: 'idle',
    messages: [
      ...view.messages,
      { id: 'a', role: 'assistant', content: 'Shall I move it?', createdAt: 2 },
    ],
  })
  expect(appStore.get(agentPresenceAtom).state).toBe('idle')
  appStore.set(agentViewAtom, { ...view, status: 'error', error: 'Failed' })
  expect(appStore.get(agentPresenceAtom).state).toBe('error')
  appStore.set(workspacePathAtom, '/other')
  expect(appStore.get(agentPresenceAtom).state).toBe('idle')
})

it('does not mistake API access or an unknown account for a disconnected harness', () => {
  appStore.set(agentSetupAtom, {
    runtimeAvailable: true,
    installing: false,
    configuration: {
      provider: 'claude',
      access: 'api',
      baseUrl: 'https://example.test',
      model: 'model',
      hasApiKey: true,
    },
  })
  appStore.set(agentAccountsAtom, {
    claude: { status: 'signed-out' },
    codex: { status: 'unknown' },
  })
  expect(appStore.get(agentPresenceAtom).state).toBe('idle')
  const setup = appStore.get(agentSetupAtom)!
  appStore.set(agentSetupAtom, {
    ...setup,
    configuration: { ...setup.configuration, hasApiKey: false },
  })
  expect(appStore.get(agentPresenceAtom).state).toBe('offline')
  appStore.set(agentSetupAtom, {
    ...setup,
    configuration: { ...setup.configuration, access: 'native' },
  })
  expect(appStore.get(agentPresenceAtom).state).toBe('offline')
  appStore.set(agentAccountsAtom, { claude: { status: 'checking' }, codex: { status: 'unknown' } })
  expect(appStore.get(agentPresenceAtom).state).toBe('idle')
})

it('keeps unread replies until opened, without marking visible replies, cancellation or history unread', () => {
  appStore.set(workspacePathAtom, '/notes')
  appStore.set(agentWindowAtom, {
    open: true,
    collapsed: true,
    context: {},
    anchor: null,
    draft: '',
  })
  const view = liveView([])
  appStore.set(agentViewAtom, view)
  appStore.set(agentViewAtom, { ...view, status: 'idle' })
  expect(appStore.get(agentPresenceAtom).state).toBe('idle')
  appStore.set(agentViewAtom, view)
  const finished: AgentView = { ...view, status: 'idle', completedTurn: 'turn-1' }
  appStore.set(agentViewAtom, finished)
  expect(appStore.get(agentPresenceAtom).state).toBe('ready')
  appStore.set(agentViewAtom, { ...finished })
  expect(appStore.get(agentPresenceAtom).state).toBe('ready')
  appStore.set(agentWindowAtom, (state) => ({ ...state, collapsed: false }))
  expect(appStore.get(agentPresenceAtom).state).toBe('idle')
  appStore.set(agentWindowAtom, (state) => ({ ...state, collapsed: true }))
  appStore.set(agentViewAtom, { ...finished })
  expect(appStore.get(agentPresenceAtom).state).toBe('idle')
  appStore.set(agentViewAtom, null)
  appStore.set(agentViewAtom, finished)
  expect(appStore.get(agentPresenceAtom).state).toBe('idle')
  appStore.set(agentWindowAtom, (state) => ({ ...state, collapsed: false }))
  appStore.set(agentViewAtom, view)
  appStore.set(agentViewAtom, { ...finished, completedTurn: 'turn-2' })
  appStore.set(agentWindowAtom, (state) => ({ ...state, collapsed: true }))
  expect(appStore.get(agentPresenceAtom).state).toBe('idle')
})

it('acknowledges an error when opened without hiding subsequent errors', () => {
  appStore.set(workspacePathAtom, '/notes')
  appStore.set(agentWindowAtom, {
    open: true,
    collapsed: true,
    context: {},
    anchor: null,
    draft: '',
  })
  const view = liveView([])
  appStore.set(agentViewAtom, view)
  appStore.set(agentViewAtom, { ...view, status: 'error', error: 'Failed' })
  expect(appStore.get(agentPresenceAtom).state).toBe('error')
  openAgent()
  appStore.set(agentWindowAtom, (state) => ({ ...state, collapsed: true }))
  expect(appStore.get(agentPresenceAtom).state).toBe('idle')
  appStore.set(agentViewAtom, view)
  appStore.set(agentViewAtom, { ...view, status: 'error', error: 'Failed again' })
  expect(appStore.get(agentPresenceAtom).state).toBe('error')
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

it('appends search questions without replacing a draft or moving the expanded window', () => {
  appStore.set(workspacePathAtom, '/notes')
  openAgent({ draft: 'Existing draft', selection: 'Quoted passage', anchor: { x: 240, y: 180 } })
  openAgent({ draft: 'Find travel notes', appendDraft: true })
  expect(appStore.get(agentWindowAtom)).toMatchObject({
    draft: 'Existing draft\n\nFind travel notes',
    anchor: { x: 240, y: 180 },
    open: true,
    collapsed: false,
    context: { selection: 'Quoted passage' },
  })
  const beforeEmptySearch = appStore.get(agentWindowAtom)
  openAgent({ appendDraft: true })
  expect(appStore.get(agentWindowAtom)).toEqual(beforeEmptySearch)
})

it('shows background preparation and a completion notice without switching the selected provider', () => {
  const missing = {
    status: 'missing' as const,
    source: null,
    total: 100,
    transferred: 0,
  }
  appStore.set(agentSetupAtom, {
    configuration: {
      provider: 'codex',
      access: 'native',
      baseUrl: '',
      model: '',
      hasApiKey: false,
    },
    runtimeAvailable: false,
    installing: false,
    components: { claude: missing, codex: missing },
  })
  appStore.set(agentWindowAtom, (state) => ({ ...state, collapsed: true }))
  let publish!: (components: AgentComponents) => void
  vi.stubGlobal('window', {
    api: {
      on: (channel: IpcChannels, listener: (components: AgentComponents) => void) => {
        if (channel === IpcChannels.OnAgentComponents) publish = listener
        return () => {}
      },
    },
  })
  const disconnect = connectAgent()
  try {
    publish({ claude: { ...missing, status: 'downloading', transferred: 40 }, codex: missing })
    expect(appStore.get(agentPresenceAtom).state).toBe('working')
    publish({
      claude: {
        ...missing,
        status: 'ready',
        source: 'managed',
        transferred: 100,
      },
      codex: missing,
    })
    expect(appStore.get(agentPresenceAtom).state).toBe('ready')
    expect(appStore.get(agentSetupAtom)?.configuration.provider).toBe('codex')
    expect(appStore.get(agentSetupAtom)?.runtimeAvailable).toBe(false)
    appStore.set(agentWindowAtom, (state) => ({ ...state, open: true, collapsed: false }))
    expect(appStore.get(agentPresenceAtom).state).not.toBe('ready')
  } finally {
    disconnect()
  }
})

it('refreshes saved verification before reporting a rejected API draft', async () => {
  const saved: AgentSetup = {
    configuration: {
      provider: 'claude',
      access: 'api',
      baseUrl: 'https://api.deepseek.com/anthropic',
      model: 'deepseek-flash',
      hasApiKey: true,
      apiVerified: true,
    },
    runtimeAvailable: true,
    installing: false,
  }
  appStore.set(agentSetupAtom, saved)
  const refreshed = { ...saved, configuration: { ...saved.configuration, apiVerified: false } }
  vi.stubGlobal('window', {
    api: {
      invoke: vi.fn(async () => ({
        success: false,
        error: 'AGENT_API_AUTH_FAILED',
        data: { setup: refreshed },
      })),
    },
  })
  await expect(
    agentCommand({
      action: 'configure',
      provider: 'claude',
      access: 'api',
      baseUrl: saved.configuration.baseUrl,
      model: saved.configuration.model,
    }),
  ).rejects.toThrow('AGENT_API_AUTH_FAILED')
  expect(appStore.get(agentSetupAtom)?.configuration.apiVerified).toBe(false)
})

it.each([true, false])(
  'applies runtime credential rejection while settings are closed (matching profile=%s)',
  (matches) => {
    const configuration: AgentConfiguration = {
      provider: 'claude',
      access: 'api',
      baseUrl: 'https://api.deepseek.com/anthropic',
      model: 'deepseek-flash',
      apiService: 'deepseek',
      hasApiKey: true,
      apiVerified: true,
    }
    const setup: AgentSetup = {
      configuration,
      runtimeAvailable: true,
      installing: false,
      connectionProfiles: {
        claude: { access: 'api', apiConfigured: true, apiVerified: true },
        codex: { access: 'native', apiConfigured: false },
      },
    }
    appStore.set(agentSetupAtom, setup)
    let invalidate!: (
      profile: Pick<AgentConfiguration, 'provider' | 'baseUrl' | 'model' | 'apiService'>,
    ) => void
    vi.stubGlobal('window', {
      api: {
        on: (channel: IpcChannels, listener: typeof invalidate) => {
          if (channel === IpcChannels.OnAgentApiVerificationInvalidated) invalidate = listener
          return vi.fn()
        },
      },
    })
    const disconnect = connectAgent()
    try {
      expect(appStore.get(agentWindowAtom).open).toBe(false)
      invalidate({ ...configuration, model: matches ? configuration.model : 'different-model' })
      const current = appStore.get(agentSetupAtom)!
      expect(current.configuration.apiVerified).toBe(!matches)
      expect(current.connectionProfiles?.claude.apiVerified).toBe(!matches)
      expect(current.configuration.hasApiKey).toBe(true)
      expect(current.configuration.access).toBe('api')
    } finally {
      disconnect()
    }
  },
)
