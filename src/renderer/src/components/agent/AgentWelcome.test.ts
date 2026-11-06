import { createElement } from 'react'
import { parseHTML } from 'linkedom'
import { afterEach, expect, it, vi } from 'vitest'
import type { AgentSetup } from '@shared/types/agent'
import { agentCommand } from '../../store/agent'
import { AgentWelcome } from './AgentWelcome'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../../store/agent', () => ({ agentCommand: vi.fn() }))
vi.mock('./agentError', () => ({ agentErrorText: (message: string) => message }))
afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

const setup: AgentSetup = {
  configuration: { provider: 'claude', access: 'native', baseUrl: '', model: '', hasApiKey: false },
  connectionProfiles: {
    claude: { access: 'native', apiConfigured: false },
    codex: { access: 'api', apiConfigured: true },
  },
  runtimeAvailable: true,
  installing: false,
}

it.each([true, false])(
  'chooses an API profile independently of native auth errors, configured=%s',
  async (configured) => {
    const { window } = parseHTML('<html><body><div id="root"></div></body></html>')
    vi.stubGlobal('window', window)
    vi.stubGlobal('document', window.document)
    const { createRoot } = await import('react-dom/client')
    const { flushSync } = await import('react-dom')
    const root = createRoot(window.document.getElementById('root')!)
    const onProvider = vi.fn().mockResolvedValue(true)
    const onCheck = vi.fn().mockResolvedValue(undefined)
    const onLogin = vi.fn().mockResolvedValue(undefined)
    const config = {
      provider: 'codex' as const,
      access: 'api' as const,
      baseUrl: 'https://api.example.com/v1',
      model: 'saved-model',
      apiService: 'custom' as const,
      hasApiKey: true,
    }
    vi.mocked(agentCommand).mockResolvedValue({ setup: { ...setup, configuration: config } })
    try {
      flushSync(() =>
        root.render(
          createElement(AgentWelcome, {
            setup: {
              ...setup,
              connectionProfiles: {
                ...setup.connectionProfiles!,
                codex: { access: 'api', apiConfigured: configured },
              },
            },
            accounts: {
              claude: { status: 'signed-out' },
              codex: configured
                ? { status: 'error', message: 'native auth unavailable' }
                : { status: 'signed-out' },
            },
            busy: false,
            onProvider,
            onCheck,
            onLogin,
            onSettings: vi.fn(),
          }),
        ),
      )
      const button = window.document.querySelectorAll<HTMLButtonElement>(
        '.agent-connect-option button',
      )[1]
      expect(button.textContent).toBe(
        configured ? 'agent.welcomeUseConnection' : 'agent.welcomeSignIn',
      )
      button.click()
      await vi.waitFor(() => expect(onProvider).toHaveBeenCalledWith('codex'))
      if (configured) {
        expect(onCheck).not.toHaveBeenCalled()
        expect(agentCommand).not.toHaveBeenCalled()
        expect(onLogin).not.toHaveBeenCalled()
      } else {
        await vi.waitFor(() => expect(onLogin).toHaveBeenCalledWith('codex'))
        expect(agentCommand).toHaveBeenCalledWith({
          action: 'set-access',
          provider: 'codex',
          access: 'native',
        })
      }
    } finally {
      flushSync(() => root.unmount())
    }
  },
)

it.each([false, true])(
  'continues to login only while the welcome panel is visible (closed=%s)',
  async (closed) => {
    const { window } = parseHTML('<html><body><div id="root"></div></body></html>')
    vi.stubGlobal('window', window)
    vi.stubGlobal('document', window.document)
    const { createRoot } = await import('react-dom/client')
    const { flushSync } = await import('react-dom')
    const root = createRoot(window.document.getElementById('root')!)
    const missing = {
      status: 'missing' as const,
      source: null,
      transferred: 0,
      total: 100,
    }
    const unconfigured = {
      ...setup,
      runtimeAvailable: false,
      components: { claude: missing, codex: missing },
    }
    let complete!: (value: { setup: AgentSetup }) => void
    const install = new Promise<{ setup: AgentSetup }>((resolve) => {
      complete = resolve
    })
    vi.mocked(agentCommand).mockImplementation(async (command) =>
      command.action === 'install' ? install : { authentication: { status: 'signed-out' } },
    )
    const onLogin = vi.fn().mockResolvedValue(undefined)
    const onProvider = vi.fn().mockResolvedValue(true)
    try {
      flushSync(() =>
        root.render(
          createElement(AgentWelcome, {
            setup: unconfigured,
            accounts: { claude: { status: 'signed-out' }, codex: { status: 'signed-out' } },
            busy: false,
            onProvider,
            onLogin,
            onCheck: vi.fn().mockResolvedValue(undefined),
            onSettings: vi.fn(),
          }),
        ),
      )
      window.document.querySelector<HTMLButtonElement>('.agent-connect-option button')!.click()
      await vi.waitFor(() =>
        expect(agentCommand).toHaveBeenCalledWith({ action: 'install', provider: 'claude' }),
      )
      if (closed) flushSync(() => root.unmount())
      complete({
        setup: {
          ...unconfigured,
          runtimeAvailable: true,
          components: {
            ...unconfigured.components,
            claude: { ...missing, status: 'ready', source: 'managed' },
          },
        },
      })
      if (closed) {
        await install
        await new Promise((resolve) => setTimeout(resolve, 10))
        expect(onLogin).not.toHaveBeenCalled()
        expect(onProvider).not.toHaveBeenCalled()
      } else await vi.waitFor(() => expect(onLogin).toHaveBeenCalledWith('claude'))
    } finally {
      if (!closed) flushSync(() => root.unmount())
    }
  },
)

it('keeps initial checks neutral and only adds a hint when they take longer', async () => {
  const { window } = parseHTML('<html><body><div id="root"></div></body></html>')
  vi.stubGlobal('window', window)
  vi.stubGlobal('document', window.document)
  const { createRoot } = await import('react-dom/client')
  const { flushSync } = await import('react-dom')
  const root = createRoot(window.document.getElementById('root')!)
  const props = {
    setup: null,
    checking: true,
    accounts: { claude: { status: 'unknown' as const }, codex: { status: 'unknown' as const } },
    busy: false,
    onProvider: vi.fn(),
    onLogin: vi.fn(),
    onCheck: vi.fn(),
    onSettings: vi.fn(),
  }
  vi.useFakeTimers()
  try {
    flushSync(() => root.render(createElement(AgentWelcome, props)))
    expect(window.document.querySelector('.agent-welcome-logo')).not.toBeNull()
    expect(window.document.querySelector('.agent-connect-options')).toBeNull()
    expect(window.document.querySelector('button')).toBeNull()
    expect(window.document.querySelector('p')?.style.visibility).toBe('hidden')
    flushSync(() => vi.advanceTimersByTime(1000))
    expect(window.document.querySelector('p')?.textContent).toBe('agent.preparingConnection')
    expect(window.document.querySelector('p')?.style.visibility).toBe('visible')
    flushSync(() => root.render(createElement(AgentWelcome, { ...props, setup, checking: false })))
    expect(window.document.querySelector('.agent-connect-options')).not.toBeNull()
    expect(
      window.document.querySelector('[role="status"][aria-label="agent.preparingConnection"]'),
    ).toBeNull()
    expect(agentCommand).not.toHaveBeenCalled()
  } finally {
    flushSync(() => root.unmount())
    vi.useRealTimers()
  }
})
