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
          action: 'configure',
          provider: 'codex',
          access: 'native',
          baseUrl: config.baseUrl,
          model: config.model,
          apiService: config.apiService,
        })
      }
    } finally {
      flushSync(() => root.unmount())
    }
  },
)
