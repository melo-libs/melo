import { createElement } from 'react'
import { Provider, atom } from 'jotai'
import { parseHTML } from 'linkedom'
import { afterEach, expect, it, vi } from 'vitest'
import type { AgentCommandResult, AgentSetup, AgentView, AgentProvider } from '@shared/types/agent'
import { appStore } from '../../store/appStore'
import {
  agentAccountsAtom,
  agentCommand,
  agentSetupAtom,
  agentViewAtom,
  agentWindowAtom,
  agentNativeCatalogsAtom,
  agentIntakeAtom,
} from '../../store/agent'
import { activeTabIdAtom } from '../../store/editor'
import { useAgentController } from './useAgentController'

vi.mock('../../store/workspace', () => ({ workspacePathAtom: atom('/notes') }))
vi.mock('../../store/agent', () => ({
  agentCommand: vi.fn(),
  agentViewAtom: atom<AgentView | null>(null),
  agentWindowAtom: atom({ open: false, collapsed: false, context: {}, anchor: null, draft: '' }),
  agentHistoryAtom: atom(null),
  agentIntakeAtom: atom(null),
  agentSetupAtom: atom<AgentSetup | null>(null),
  agentNativeCatalogsAtom: atom({}),
  agentAccountsAtom: atom({ claude: { status: 'signed-out' }, codex: { status: 'signed-in' } }),
}))
afterEach(() => {
  appStore.set(activeTabIdAtom, null)
  appStore.set(agentIntakeAtom, null)
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  appStore.set(agentSetupAtom, null)
  appStore.set(agentNativeCatalogsAtom, {})
  appStore.set(agentViewAtom, null)
  appStore.set(agentWindowAtom, {
    open: false,
    collapsed: false,
    context: {},
    anchor: null,
    draft: '',
  })
  appStore.set(agentAccountsAtom, {
    claude: { status: 'signed-out' },
    codex: { status: 'signed-in' },
  })
})

it.each(
  (
    [
      { access: 'api', status: 'signed-out', hadRuntime: true },
      { access: 'api', status: 'checking', hadRuntime: true },
      { access: 'api', status: 'error', hadRuntime: true },
      { access: 'native', status: 'checking', hadRuntime: true },
      { access: 'native', status: 'checking', hadRuntime: false },
      { access: 'native', status: 'signed-in', hadRuntime: true },
      { access: 'native', status: 'signed-out', hadRuntime: true },
    ] as const
  ).flatMap((scenario) => [false, true].map((fails) => ({ ...scenario, fails }))),
)(
  'keeps the connection UI stable while switching ($access, $status, runtime=$hadRuntime, fails=$fails)',
  async ({ access, status, hadRuntime, fails }) => {
    const { window } = parseHTML('<html><body><div id="root"></div></body></html>')
    vi.stubGlobal('window', window)
    vi.stubGlobal('document', window.document)
    const { createRoot } = await import('react-dom/client')
    const { flushSync } = await import('react-dom')
    const root = createRoot(window.document.getElementById('root')!)
    const initial: AgentSetup = {
      configuration: {
        provider: 'codex',
        access: 'native',
        baseUrl: '',
        model: '',
        hasApiKey: false,
        native: { model: 'codex-model', effort: 'high' },
      },
      runtimeAvailable: hadRuntime,
      installing: false,
    }
    const target: AgentSetup = {
      ...initial,
      runtimeAvailable: true,
      configuration: {
        provider: 'claude',
        access,
        baseUrl: 'http://127.0.0.1',
        model: 'api-model',
        hasApiKey: true,
        ...(access === 'native' ? { native: { model: 'claude-model', effort: 'high' } } : {}),
      },
    }
    const view: AgentView = {
      conversation: {
        id: 'conversation',
        workspaceRoot: '/notes',
        title: '',
        provider: 'codex',
        updatedAt: 1,
      },
      messages: [],
      status: 'idle',
      allowChanges: false,
      permission: null,
      error: null,
    }
    appStore.set(agentSetupAtom, initial)
    appStore.set(agentViewAtom, view)
    appStore.set(agentWindowAtom, {
      open: true,
      collapsed: false,
      context: {},
      anchor: null,
      draft: 'Hello',
    })
    appStore.set(agentAccountsAtom, {
      codex: { status: 'signed-in' },
      claude: status === 'error' ? { status, message: 'fixture failure' } : { status },
    })
    let finish!: (value: AgentCommandResult) => void
    let fail!: (error: Error) => void
    vi.mocked(agentCommand).mockImplementation(async (command) => {
      if (command.action === 'current') return { view }
      if (command.action === 'setup') return { setup: initial }
      if (command.action === 'provider') {
        const next = { ...view, conversation: { ...view.conversation, provider: command.provider } }
        appStore.set(agentViewAtom, next)
        return { view: next }
      }
      if (command.action === 'select-provider')
        return new Promise((resolve, reject) => {
          finish = resolve
          fail = reject
        })
      return {}
    })
    const navigate = vi.fn()
    let controller!: ReturnType<typeof useAgentController>
    function Panel() {
      controller = useAgentController(navigate)
      return null
    }
    try {
      flushSync(() =>
        root.render(createElement(Provider, { store: appStore }, createElement(Panel))),
      )
      await vi.waitFor(() => expect(controller.loading).toBe(false))
      navigate.mockClear()
      flushSync(() => controller.changeProvider('claude'))
      await vi.waitFor(() =>
        expect(agentCommand).toHaveBeenCalledWith({
          action: 'select-provider',
          provider: 'claude',
        }),
      )
      expect(appStore.get(agentViewAtom)!.conversation.provider).toBe('claude')
      expect(appStore.get(agentSetupAtom)!.configuration.provider).toBe('codex')
      expect(controller.selectedProvider).toBe('codex')
      expect(controller.setup?.configuration.native?.model).toBe('codex-model')
      expect(controller.connected).toBe(hadRuntime)
      expect(controller.busy).toBe(true)
      expect(controller.canSend).toBe(false)
      expect(controller.send('Cannot send while switching', {})).toBe(false)
      expect(controller.state.draft).toBe('Hello')
      expect(navigate).not.toHaveBeenCalledWith(true)
      if (fails) {
        fail(new Error('Connection switch failed'))
        await vi.waitFor(() => expect(controller.busy).toBe(false))
        expect(controller.error).toBe('Connection switch failed')
        expect(controller.connected).toBe(false)
        expect(controller.canSend).toBe(false)
      } else {
        appStore.set(agentSetupAtom, target)
        finish({ setup: target })
        await vi.waitFor(() => expect(navigate).toHaveBeenLastCalledWith(false))
        if (access === 'native' && status === 'checking') {
          expect(controller.connected).toBe(hadRuntime)
          expect(controller.runtimeAvailable).toBe(true)
          expect(controller.selectedProvider).toBe('codex')
          expect(controller.busy).toBe(true)
          expect(controller.canSend).toBe(false)
          appStore.set(agentAccountsAtom, {
            codex: { status: 'signed-in' },
            claude: { status: 'signed-out' },
          })
        }
        await vi.waitFor(() => expect(controller.busy).toBe(false))
        expect(controller.selectedProvider).toBe('claude')
        expect(controller.connected).toBe(access === 'api' || status === 'signed-in')
        expect(navigate).not.toHaveBeenCalledWith(true)
      }
      expect(controller.state.draft).toBe('Hello')
    } finally {
      if (finish) finish({ setup: target })
      flushSync(() => root.unmount())
    }
  },
)

it.each([false, true])(
  'prepares an opened native Harness automatically, with saved choices=%s',
  async (saved) => {
    const { window } = parseHTML('<html><body><div id="root"></div></body></html>')
    vi.stubGlobal('window', window)
    vi.stubGlobal('document', window.document)
    const { createRoot } = await import('react-dom/client')
    const { flushSync } = await import('react-dom')
    const root = createRoot(window.document.getElementById('root')!)
    const preferences = { model: 'saved-model', effort: 'high' }
    const setup: AgentSetup = {
      configuration: {
        provider: 'codex',
        access: 'native',
        baseUrl: '',
        model: '',
        hasApiKey: false,
        ...(saved ? { native: preferences } : {}),
      },
      runtimeAvailable: true,
      installing: false,
    }
    const view: AgentView = {
      conversation: {
        id: 'conversation',
        workspaceRoot: '/notes',
        title: '',
        provider: 'codex',
        updatedAt: 1,
      },
      messages: [],
      status: 'idle',
      allowChanges: false,
      permission: null,
      error: null,
    }
    appStore.set(agentSetupAtom, setup)
    appStore.set(agentViewAtom, view)
    appStore.set(agentWindowAtom, {
      open: true,
      collapsed: false,
      context: {},
      anchor: null,
      draft: 'Hello',
    })
    let finish!: (value: AgentCommandResult) => void
    vi.mocked(agentCommand).mockImplementation(async (command) => {
      if (command.action === 'prepare')
        return new Promise((resolve) => {
          finish = resolve
        })
      if (command.action === 'current') return { view }
      if (command.action === 'setup') return { setup }
      return {}
    })
    let controller!: ReturnType<typeof useAgentController>
    const onConnectionRequired = vi.fn()
    function Panel() {
      controller = useAgentController(onConnectionRequired)
      return null
    }
    try {
      flushSync(() =>
        root.render(createElement(Provider, { store: appStore }, createElement(Panel))),
      )
      await vi.waitFor(() =>
        expect(agentCommand).toHaveBeenCalledWith({
          action: 'prepare',
          conversationId: 'conversation',
        }),
      )
      await vi.waitFor(() => expect(controller.loading).toBe(false))
      expect(controller.busy).toBe(false)
      expect(controller.canSend).toBe(saved)
      if (!saved) await vi.waitFor(() => expect(controller.modelLoad.status).toBe('loading'))
      expect(
        vi.mocked(agentCommand).mock.calls.some(([command]) => command.action === 'native-options'),
      ).toBe(false)
      const restored = { ...setup, configuration: { ...setup.configuration, native: preferences } }
      appStore.set(agentSetupAtom, restored)
      finish({ setup: restored })
      await vi.waitFor(() => expect(controller.canSend).toBe(true))
      expect(
        vi.mocked(agentCommand).mock.calls.filter(([command]) => command.action === 'prepare'),
      ).toHaveLength(1)
    } finally {
      flushSync(() => root.unmount())
    }
  },
)

it('tracks model discovery explicitly, deduplicates slow requests, and offers a local retry after failure', async () => {
  const { window } = parseHTML('<html><body><div id="root"></div></body></html>')
  vi.stubGlobal('window', window)
  vi.stubGlobal('document', window.document)
  const { createRoot } = await import('react-dom/client')
  const { flushSync } = await import('react-dom')
  const root = createRoot(window.document.getElementById('root')!)
  let controller!: ReturnType<typeof useAgentController>
  const connectionRequired = vi.fn()
  function Panel() {
    controller = useAgentController(connectionRequired)
    return null
  }
  const setup: AgentSetup = {
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
  appStore.set(agentSetupAtom, setup)
  let finish!: (result: AgentCommandResult) => void
  vi.mocked(agentCommand).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  try {
    flushSync(() => root.render(createElement(Provider, { store: appStore }, createElement(Panel))))
    expect(agentCommand).not.toHaveBeenCalled()
    let loading!: Promise<void>
    flushSync(() => {
      loading = controller.loadModels()
      void controller.loadModels()
    })
    expect(controller.modelLoad.status).toBe('loading')
    expect(controller.busy).toBe(false)
    expect(agentCommand).toHaveBeenCalledTimes(1)
    finish({ setup: { ...setup, nativeControls: [] } })
    await loading
    await vi.waitFor(() => expect(controller.modelLoad.status).toBe('idle'))
    expect(controller.busy).toBe(false)
    vi.mocked(agentCommand).mockRejectedValueOnce(new Error('Catalog unavailable'))
    await controller.loadModels()
    await vi.waitFor(() =>
      expect(controller.modelLoad).toEqual({ status: 'error', message: 'Catalog unavailable' }),
    )
    expect(controller.error).toBe('')
    expect(controller.busy).toBe(false)
    vi.mocked(agentCommand).mockResolvedValueOnce({ setup: { ...setup, nativeControls: [] } })
    await controller.loadModels()
    await vi.waitFor(() => expect(controller.modelLoad.status).toBe('idle'))
    vi.mocked(agentCommand).mockResolvedValueOnce({})
    await controller.loadModels()
    await vi.waitFor(() =>
      expect(controller.modelLoad).toEqual({
        status: 'error',
        message: 'AGENT_MODELS_UNAVAILABLE',
      }),
    )
  } finally {
    flushSync(() => root.unmount())
  }
})

it('loads catalogs independently when switching Harnesses before the previous request finishes', async () => {
  const { window } = parseHTML('<html><body><div id="root"></div></body></html>')
  vi.stubGlobal('window', window)
  vi.stubGlobal('document', window.document)
  const { createRoot } = await import('react-dom/client')
  const { flushSync } = await import('react-dom')
  const root = createRoot(window.document.getElementById('root')!)
  const makeSetup = (provider: AgentProvider): AgentSetup => ({
    configuration: {
      provider,
      access: 'native',
      baseUrl: '',
      model: '',
      hasApiKey: false,
      native: { model: 'saved' },
    },
    runtimeAvailable: true,
    installing: false,
  })
  appStore.set(agentSetupAtom, makeSetup('codex'))
  const finish = new Map<AgentProvider, (result: AgentCommandResult) => void>()
  vi.mocked(agentCommand).mockImplementation(
    async (command) =>
      new Promise((resolve) => {
        if (command.action === 'native-options') finish.set(command.provider, resolve)
      }),
  )
  let controller!: ReturnType<typeof useAgentController>
  const navigate = vi.fn()
  function Panel() {
    controller = useAgentController(navigate)
    return null
  }
  try {
    flushSync(() => root.render(createElement(Provider, { store: appStore }, createElement(Panel))))
    const codex = controller.loadModels()
    flushSync(() => appStore.set(agentSetupAtom, makeSetup('claude')))
    await vi.waitFor(() => expect(controller.selectedProvider).toBe('claude'))
    const claude = controller.loadModels()
    await vi.waitFor(() => expect(finish.has('claude')).toBe(true))
    finish.get('codex')!({ setup: { ...makeSetup('codex'), nativeControls: [] } })
    await codex
    await vi.waitFor(() => expect(controller.modelLoad.status).toBe('loading'))
    finish.get('claude')!({ setup: { ...makeSetup('claude'), nativeControls: [] } })
    await claude
    await vi.waitFor(() => expect(controller.modelLoad.status).toBe('idle'))
  } finally {
    finish.forEach((resolve, provider) =>
      resolve({ setup: { ...makeSetup(provider), nativeControls: [] } }),
    )
    flushSync(() => root.unmount())
  }
})

it('keeps commands busy until overlapping requests settle and exposes a recoverable error', async () => {
  const { window } = parseHTML('<html><body><div id="root"></div></body></html>')
  vi.stubGlobal('window', window)
  vi.stubGlobal('document', window.document)
  const { createRoot } = await import('react-dom/client')
  const { flushSync } = await import('react-dom')
  const root = createRoot(window.document.getElementById('root')!)
  let controller!: ReturnType<typeof useAgentController>
  const connectionRequired = vi.fn()
  function Panel() {
    controller = useAgentController(connectionRequired)
    return null
  }
  appStore.set(agentViewAtom, {
    conversation: {
      id: 'conversation',
      workspaceRoot: '/notes',
      title: '',
      provider: 'claude',
      updatedAt: 1,
    },
    messages: [],
    status: 'idle',
    allowChanges: false,
    permission: null,
    error: null,
  })
  let resolveHistory!: (result: AgentCommandResult) => void
  let rejectUndo!: (error: Error) => void
  vi.mocked(agentCommand)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveHistory = resolve
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectUndo = reject
        }),
    )
    .mockResolvedValue({})
  try {
    flushSync(() => root.render(createElement(Provider, { store: appStore }, createElement(Panel))))
    let history!: Promise<boolean>
    flushSync(() => {
      history = controller.loadHistory({ around: 'older-message' })
      controller.undo('conversation', ['change'])
    })
    expect(controller.busy).toBe(true)
    resolveHistory({})
    expect(await history).toBe(true)
    flushSync(() => {})
    expect(controller.busy).toBe(true)
    rejectUndo(new Error('File changed; cannot undo'))
    await vi.waitFor(() => expect(controller.error).toBe('File changed; cannot undo'))
    expect(controller.busy).toBe(false)
    const loaded = controller.loadHistory()
    await expect(loaded).resolves.toBe(true)
    await vi.waitFor(() => expect(controller.error).toBe(''))
    expect(agentCommand).toHaveBeenNthCalledWith(1, { action: 'history', around: 'older-message' })
    expect(agentCommand).toHaveBeenNthCalledWith(2, {
      action: 'undo',
      conversationId: 'conversation',
      changeIds: ['change'],
    })
    vi.mocked(agentCommand).mockResolvedValue({
      setup: {
        configuration: {
          provider: 'codex',
          access: 'native',
          baseUrl: '',
          model: '',
          hasApiKey: false,
        },
        runtimeAvailable: true,
        installing: false,
      },
    })
    controller.changeProvider('codex', true)
    await vi.waitFor(() => expect(connectionRequired).toHaveBeenLastCalledWith(true))
    await vi.waitFor(() => expect(controller.busy).toBe(false))
    controller.changeProvider('codex')
    await vi.waitFor(() => expect(connectionRequired).toHaveBeenLastCalledWith(false))
    await vi.waitFor(() => expect(controller.busy).toBe(false))
    appStore.set(agentAccountsAtom, {
      claude: { status: 'signed-out' },
      codex: { status: 'signed-out' },
    })
    connectionRequired.mockClear()
    controller.changeProvider('codex')
    await vi.waitFor(() => expect(connectionRequired).toHaveBeenLastCalledWith(false))
  } finally {
    flushSync(() => root.unmount())
    appStore.set(agentViewAtom, null)
  }
})

it('snapshots the active tab on every send while chat stays open, independently of quotes and attachments', async () => {
  const { window } = parseHTML('<html><body><div id="root"></div></body></html>')
  vi.stubGlobal('window', window)
  vi.stubGlobal('document', window.document)
  const { createRoot } = await import('react-dom/client')
  const { flushSync } = await import('react-dom')
  const root = createRoot(window.document.getElementById('root')!)
  const setup: AgentSetup = {
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
  const view: AgentView = {
    conversation: {
      id: 'conversation',
      workspaceRoot: '/notes',
      title: '',
      provider: 'claude',
      updatedAt: 1,
    },
    messages: [],
    status: 'idle',
    allowChanges: false,
    permission: null,
    error: null,
  }
  appStore.set(agentSetupAtom, setup)
  appStore.set(agentViewAtom, view)
  appStore.set(agentWindowAtom, {
    open: true,
    collapsed: false,
    context: {},
    anchor: null,
    draft: '',
  })
  vi.mocked(agentCommand).mockImplementation(async (command) => {
    if (command.action === 'current') return { view }
    if (command.action === 'setup') return { setup }
    return {}
  })
  let controller!: ReturnType<typeof useAgentController>
  const navigate = vi.fn()
  function Panel() {
    controller = useAgentController(navigate)
    return null
  }
  try {
    flushSync(() => root.render(createElement(Provider, { store: appStore }, createElement(Panel))))
    await vi.waitFor(() => expect(controller.ready).toBe(true))
    for (const file of [
      '/notes/Inbox/photo.png',
      '/notes/Inbox/report.pdf',
      '/notes/note.md',
      null,
      'untitled-1',
      '/elsewhere/private.md',
    ]) {
      appStore.set(activeTabIdAtom, file)
      flushSync(() => expect(controller.send('What am I viewing?', {})).toBe(true))
      expect(agentCommand).toHaveBeenLastCalledWith({
        action: 'send',
        conversationId: 'conversation',
        text: 'What am I viewing?',
        context: {
          activeFilePath: file?.startsWith('/notes/') ? file.slice('/notes/'.length) : null,
        },
      })
      await vi.waitFor(() => expect(controller.busy).toBe(false))
    }
    const attachments = [{ id: 'attachment', name: 'ticket.pdf', size: 10 }]
    flushSync(() => appStore.set(agentIntakeAtom, { workspaceRoot: '/notes', attachments }))
    appStore.set(activeTabIdAtom, '/notes/Inbox/report.pdf')
    flushSync(() =>
      expect(
        controller.send('Explain this passage', {
          filePath: 'note.md',
          selection: 'Quoted passage',
        }),
      ).toBe(true),
    )
    // Changing tabs after sending must not change the context of the submitted question.
    appStore.set(activeTabIdAtom, '/notes/later.md')
    expect(agentCommand).toHaveBeenLastCalledWith({
      action: 'send',
      conversationId: 'conversation',
      text: 'Explain this passage',
      context: {
        activeFilePath: 'Inbox/report.pdf',
        filePath: 'note.md',
        selection: 'Quoted passage',
        attachments,
      },
    })
    await vi.waitFor(() => expect(controller.busy).toBe(false))
    expect(appStore.get(agentWindowAtom).open).toBe(true)
  } finally {
    flushSync(() => root.unmount())
  }
})

it.each([
  { access: 'native', runtimeAvailable: true, account: 'signed-in', connected: true },
  { access: 'native', runtimeAvailable: true, account: 'signed-out', connected: false },
  { access: 'native', runtimeAvailable: true, account: 'error', connected: false },
  { access: 'native', runtimeAvailable: false, account: 'unknown', connected: false },
  { access: 'api', runtimeAvailable: true, account: 'unknown', connected: true },
] as const)(
  'keeps cold startup unresolved until the required facts are known: $access/$account/$runtimeAvailable',
  async ({ access, runtimeAvailable, account, connected }) => {
    const { window } = parseHTML('<html><body><div id="root"></div></body></html>')
    vi.stubGlobal('window', window)
    vi.stubGlobal('document', window.document)
    const { createRoot } = await import('react-dom/client')
    const { flushSync } = await import('react-dom')
    const root = createRoot(window.document.getElementById('root')!)
    const setup: AgentSetup = {
      configuration: {
        provider: 'claude',
        access,
        baseUrl: 'https://fixture.example',
        model: 'fixture',
        hasApiKey: access === 'api',
        native: { model: 'fixture' },
      },
      runtimeAvailable,
      installing: false,
    }
    const view: AgentView = {
      conversation: {
        id: 'cold',
        workspaceRoot: '/notes',
        title: '',
        provider: 'claude',
        updatedAt: 1,
      },
      messages: [],
      status: 'idle',
      allowChanges: false,
      permission: null,
      error: null,
    }
    appStore.set(agentAccountsAtom, { claude: { status: 'unknown' }, codex: { status: 'unknown' } })
    appStore.set(agentWindowAtom, {
      open: true,
      collapsed: false,
      context: {},
      anchor: null,
      draft: '',
    })
    let finishCurrent!: () => void
    let finishSetup!: () => void
    vi.mocked(agentCommand).mockImplementation(async (command) => {
      if (command.action === 'current')
        return new Promise((resolve) => {
          finishCurrent = () => {
            appStore.set(agentViewAtom, view)
            resolve({ view })
          }
        })
      if (command.action === 'setup')
        return new Promise((resolve) => {
          finishSetup = () => {
            appStore.set(agentSetupAtom, setup)
            resolve({ setup })
          }
        })
      return {}
    })
    let controller!: ReturnType<typeof useAgentController>
    const snapshots: Array<{ checking: boolean; connected: boolean }> = []
    const navigate = vi.fn()
    function Panel() {
      controller = useAgentController(navigate)
      snapshots.push({ checking: controller.connectionChecking, connected: controller.connected })
      return null
    }
    try {
      flushSync(() =>
        root.render(createElement(Provider, { store: appStore }, createElement(Panel))),
      )
      expect(snapshots.every((state) => state.checking && !state.connected)).toBe(true)
      flushSync(() => finishCurrent())
      await vi.waitFor(() => expect(finishSetup).toBeTypeOf('function'))
      expect(controller.connectionChecking).toBe(true)
      flushSync(() => finishSetup())
      await vi.waitFor(() => expect(controller.loading).toBe(false))
      if (access === 'native' && runtimeAvailable) {
        expect(controller.connectionChecking).toBe(true)
        flushSync(() =>
          appStore.set(agentAccountsAtom, {
            claude:
              account === 'error' ? { status: 'error', message: 'fixture' } : { status: account },
            codex: { status: 'unknown' },
          }),
        )
      }
      await vi.waitFor(() => expect(controller.connectionChecking).toBe(false))
      expect(controller.connected).toBe(connected)
      // Reopening with known data must not introduce another initialization screen.
      flushSync(() =>
        root.render(
          createElement(Provider, { store: appStore }, createElement(Panel, { key: 'reopen' })),
        ),
      )
      expect(controller.connectionChecking).toBe(false)
      expect(controller.connected).toBe(connected)
    } finally {
      flushSync(() => root.unmount())
    }
  },
)
