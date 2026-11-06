import { createElement, useState } from 'react'
import type { ReactElement, ReactNode, ButtonHTMLAttributes } from 'react'
import { Provider, atom, useAtomValue } from 'jotai'
import { parseHTML } from 'linkedom'
import { afterEach, expect, it, vi } from 'vitest'
import type {
  AgentCommand,
  AgentAuthentication,
  AgentCommandResult,
  AgentProvider,
  AgentSetup,
} from '@shared/types/agent'
import { appStore } from '../../store/appStore'
import { agentAccountsAtom, agentCommand, agentSetupAtom } from '../../store/agent'
import { AgentSettings } from './AgentSettings'
import { useAgentAccounts } from './useAgentAccounts'
import { toast } from '../Toaster'

vi.mock('../../store/agent', () => ({
  agentCommand: vi.fn(),
  agentSetupAtom: atom<AgentSetup | null>(null),
  agentAccountsAtom: atom({ claude: { status: 'unknown' }, codex: { status: 'unknown' } }),
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('./agentError', () => ({ agentErrorText: (code: string) => code }))
vi.mock('../settings/controls', () => ({
  Segmented: ({
    value,
    disabled,
    onChange,
  }: {
    value: string
    disabled: boolean
    onChange(value: string): void
  }) =>
    createElement(
      'button',
      { type: 'button', disabled, onClick: () => onChange(value === 'native' ? 'api' : 'native') },
      'access',
    ),
}))
vi.mock('../ui/Select', () => ({ Select: () => null }))
vi.mock('../Toaster', () => ({ toast: vi.fn() }))
vi.mock('@radix-ui/react-popover', async () => {
  const { createContext, useContext, cloneElement, Fragment } = await import('react')
  const Context = createContext<{ open: boolean; onOpenChange(open: boolean): void } | null>(null)
  Context.displayName = 'MockPopover'
  return {
    Root: ({
      open,
      onOpenChange,
      children,
    }: {
      open: boolean
      onOpenChange(open: boolean): void
      children: ReactNode
    }) => createElement(Context.Provider, { value: { open, onOpenChange } }, children),
    Trigger: ({
      children,
    }: {
      children: ReactElement<ButtonHTMLAttributes<HTMLButtonElement>>
    }) => {
      const context = useContext(Context)!
      return cloneElement(children, { onClick: () => context.onOpenChange(!context.open) })
    },
    Portal: ({ children }: { children: ReactNode }) => createElement(Fragment, null, children),
    Content: ({ children, className }: { children: ReactNode; className: string }) =>
      useContext(Context)!.open
        ? createElement('div', { className, role: 'dialog' }, children)
        : null,
  }
})
afterEach(() => {
  vi.resetAllMocks()
  vi.unstubAllGlobals()
  appStore.set(agentSetupAtom, null)
  appStore.set(agentAccountsAtom, { claude: { status: 'unknown' }, codex: { status: 'unknown' } })
})
const setup: AgentSetup = {
  configuration: { provider: 'codex', access: 'native', baseUrl: '', model: '', hasApiKey: false },
  runtimeAvailable: true,
  installing: false,
}
async function render(configuration = setup) {
  const { window } = parseHTML('<html><body><div id="root"></div></body></html>')
  vi.stubGlobal('window', window)
  vi.stubGlobal('document', window.document)
  window.HTMLElement.prototype.scrollIntoView = vi.fn()
  const { createRoot } = await import('react-dom/client')
  const { flushSync } = await import('react-dom')
  const root = createRoot(window.document.getElementById('root')!)
  const onBusyChange = vi.fn(),
    onProviderChange = vi.fn()
  function Panel() {
    const [busy, setBusy] = useState(false)
    const current = useAtomValue(agentSetupAtom)!
    const { accounts, check, login } = useAgentAccounts(current.runtimeAvailable)
    return createElement(AgentSettings, {
      key: current.configuration.provider,
      accounts,
      disabled: busy,
      onCheckAccount: (provider) => void check(provider),
      onLogin: login,
      onProviderChange,
      onBusyChange: (busy) => {
        setBusy(busy)
        onBusyChange(busy)
      },
    })
  }
  appStore.set(agentSetupAtom, configuration)
  flushSync(() => root.render(createElement(Provider, { store: appStore }, createElement(Panel))))
  return { window, flushSync, root, onBusyChange, onProviderChange }
}
const reply = (status: AgentAuthentication['status']): AgentCommandResult => ({
  authentication: { status },
})

function acceptApiConfiguration(
  command: Extract<AgentCommand, { action: 'configure' }>,
): AgentCommandResult {
  const current = appStore.get(agentSetupAtom)!
  const setup = {
    ...current,
    configuration: {
      provider: command.provider,
      access: 'api' as const,
      baseUrl: command.baseUrl,
      model: command.model,
      apiService: command.apiService,
      hasApiKey: true,
      apiVerified: true,
    },
  }
  appStore.set(agentSetupAtom, setup)
  return { setup }
}

it('queries both cards independently without changing the selected provider', async () => {
  const finish = new Map<AgentProvider, (result: AgentCommandResult) => void>()
  vi.mocked(agentCommand).mockImplementation(
    (command) =>
      new Promise((resolve) => {
        if (command.action === 'check-sign-in') finish.set(command.provider, resolve)
      }),
  )
  const { window, flushSync, root, onProviderChange, onBusyChange } = await render()
  try {
    expect(agentCommand).toHaveBeenCalledTimes(2)
    finish.get('claude')!(reply('signed-out'))
    finish.get('codex')!(reply('signed-in'))
    await vi.waitFor(() =>
      expect(window.document.querySelector('.agent-auth [role="status"]')?.textContent).toContain(
        'agent.accountSignedIn',
      ),
    )
    expect(window.document.querySelectorAll('.agent-tool-status')[0].textContent).toBe(
      'agent.accountSignedOut',
    )
    expect(
      window.document.querySelector('.agent-tool-card[aria-pressed="true"]')?.textContent,
    ).toContain('Codex')
    expect(window.document.querySelector('.agent-auth .ui-button')).toBeNull()
    expect(window.document.querySelector('.agent-settings-actions')).toBeNull()
    flushSync(() => window.document.querySelector<HTMLButtonElement>('.agent-tool-card')!.click())
    expect(onProviderChange).toHaveBeenCalledWith('claude')
    expect(onBusyChange).not.toHaveBeenCalled()
  } finally {
    flushSync(() => root.unmount())
  }
})
it('shows a direct sign-in action only for the signed-out selected tool', async () => {
  vi.mocked(agentCommand).mockImplementation(async (command) =>
    command.action === 'check-sign-in' ? reply('signed-out') : {},
  )
  const { window, flushSync, root } = await render()
  try {
    await vi.waitFor(() =>
      expect(window.document.querySelector('.agent-auth-actions .ui-button')?.textContent).toBe(
        'agent.signInProvider',
      ),
    )
    flushSync(() =>
      window.document.querySelector<HTMLButtonElement>('.agent-auth-actions .ui-button')!.click(),
    )
    await vi.waitFor(() =>
      expect(agentCommand).toHaveBeenCalledWith({ action: 'login', provider: 'codex' }),
    )
  } finally {
    flushSync(() => root.unmount())
  }
})
it('retains failure feedback and allows a failed selected-account query to be retried', async () => {
  vi.mocked(agentCommand)
    .mockImplementationOnce(async () => reply('signed-in'))
    .mockRejectedValueOnce(new Error('AGENT_AUTH_CHECK_TIMEOUT'))
    .mockResolvedValue(reply('signed-in'))
  const { window, flushSync, root } = await render()
  try {
    await vi.waitFor(() =>
      expect(window.document.querySelector('[role="alert"]')?.textContent).toBe(
        'AGENT_AUTH_CHECK_TIMEOUT',
      ),
    )
    flushSync(() =>
      window.document.querySelector<HTMLButtonElement>('.agent-auth .agent-quiet')!.click(),
    )
    await vi.waitFor(() =>
      expect(window.document.querySelector('.agent-auth [role="status"]')?.textContent).toContain(
        'agent.accountSignedIn',
      ),
    )
    expect(window.document.querySelector('[role="alert"]')).toBeNull()
  } finally {
    flushSync(() => root.unmount())
  }
})
it('reuses account results across focus, provider switches, and reopening settings', async () => {
  const finish = new Map<AgentProvider, (result: AgentCommandResult) => void>()
  vi.mocked(agentCommand).mockImplementation(
    (command) =>
      new Promise((resolve) => {
        if (command.action === 'check-sign-in') finish.set(command.provider, resolve)
      }),
  )
  const { window, flushSync, root } = await render()
  try {
    flushSync(() => window.dispatchEvent(new window.Event('focus')))
    expect(agentCommand).toHaveBeenCalledTimes(2)
    finish.get('claude')!(reply('signed-out'))
    finish.get('codex')!(reply('signed-in'))
    await vi.waitFor(() =>
      expect(window.document.querySelector('.agent-auth [role="status"]')?.textContent).toContain(
        'agent.accountSignedIn',
      ),
    )
    flushSync(() => window.dispatchEvent(new window.Event('focus')))
    flushSync(() =>
      appStore.set(agentSetupAtom, {
        ...setup,
        configuration: { ...setup.configuration, provider: 'claude' },
      }),
    )
    flushSync(() => appStore.set(agentSetupAtom, { ...setup, runtimeAvailable: false }))
    flushSync(() => appStore.set(agentSetupAtom, setup))
    expect(agentCommand).toHaveBeenCalledTimes(2)
    expect(window.document.querySelector('.agent-auth [role="status"]')?.textContent).toContain(
      'agent.accountSignedIn',
    )
  } finally {
    flushSync(() => root.unmount())
  }
})
it('refreshes only the account that returns from a Melo-initiated login', async () => {
  vi.mocked(agentCommand).mockImplementation(async (command) =>
    command.action === 'check-sign-in' ? reply('signed-out') : {},
  )
  const { window, flushSync, root } = await render()
  try {
    await vi.waitFor(() =>
      expect(window.document.querySelector('.agent-auth-actions')).not.toBeNull(),
    )
    flushSync(() =>
      window.document.querySelector<HTMLButtonElement>('.agent-auth-actions .ui-button')!.click(),
    )
    await vi.waitFor(() =>
      expect(agentCommand).toHaveBeenCalledWith({ action: 'login', provider: 'codex' }),
    )
    flushSync(() => window.dispatchEvent(new window.Event('focus')))
    await vi.waitFor(() => expect(agentCommand).toHaveBeenCalledTimes(4))
    expect(
      vi
        .mocked(agentCommand)
        .mock.calls.flatMap(([command]) =>
          command.action === 'check-sign-in' ? [command.provider] : [],
        ),
    ).toEqual(['claude', 'codex', 'codex'])
    flushSync(() => window.dispatchEvent(new window.Event('focus')))
    expect(agentCommand).toHaveBeenCalledTimes(4)
  } finally {
    flushSync(() => root.unmount())
  }
})
it('switches to a native account immediately and preserves the saved API profile', async () => {
  vi.mocked(agentCommand).mockImplementation(async (command) => {
    if (command.action === 'check-sign-in') return reply('signed-in')
    if (command.action === 'set-access') {
      const current = appStore.get(agentSetupAtom)!
      appStore.set(agentSetupAtom, {
        ...current,
        configuration: { ...current.configuration, access: command.access },
      })
    }
    return {}
  })
  const { window, flushSync, root } = await render({
    ...setup,
    configuration: {
      ...setup.configuration,
      access: 'api',
      baseUrl: 'https://api.example.com',
      model: 'saved-model',
      hasApiKey: true,
    },
  })
  try {
    await vi.waitFor(() => expect(appStore.get(agentAccountsAtom).codex.status).toBe('signed-in'))
    flushSync(() => appStore.set(agentAccountsAtom, { ...appStore.get(agentAccountsAtom) }))
    flushSync(() =>
      window.document.querySelector<HTMLButtonElement>('.agent-access-mode button')!.click(),
    )
    await vi.waitFor(() =>
      expect(agentCommand).toHaveBeenCalledWith({
        action: 'set-access',
        provider: 'codex',
        access: 'native',
      }),
    )
    expect(window.document.querySelector('.agent-auth')).not.toBeNull()
    await vi.waitFor(() =>
      expect(
        window.document.querySelector('.agent-tool-card[aria-pressed="true"] .agent-tool-status')
          ?.textContent,
      ).toBe('agent.accountSignedIn'),
    )
  } finally {
    flushSync(() => root.unmount())
  }
})
it('leaves an unconfigured API draft inactive until it can be connected', async () => {
  vi.mocked(agentCommand).mockResolvedValue(reply('signed-in'))
  const { window, flushSync, root } = await render()
  try {
    flushSync(() =>
      window.document.querySelector<HTMLButtonElement>('.agent-access-mode button')!.click(),
    )
    expect(window.document.querySelector('.agent-auth')).toBeNull()
    expect(
      window.document
        .querySelector<HTMLButtonElement>('button[type="submit"]')!
        .hasAttribute('disabled'),
    ).toBe(true)
    expect(
      vi.mocked(agentCommand).mock.calls.every(([command]) => command.action === 'check-sign-in'),
    ).toBe(true)
  } finally {
    flushSync(() => root.unmount())
  }
})
it('keeps connection tabs and API fields responsive while serializing the latest selection', async () => {
  const saves: Array<() => void> = []
  vi.mocked(agentCommand).mockImplementation(async (command) => {
    if (command.action === 'check-sign-in') return reply('signed-in')
    if (command.action === 'set-access')
      return new Promise((resolve) => saves.push(() => resolve({})))
    return {}
  })
  const { window, flushSync, root, onBusyChange } = await render({
    ...setup,
    configuration: {
      ...setup.configuration,
      access: 'api',
      baseUrl: 'https://api.example.com',
      model: 'saved-model',
      hasApiKey: true,
    },
  })
  const toggle = () =>
    flushSync(() =>
      window.document.querySelector<HTMLButtonElement>('.agent-access-mode button')!.click(),
    )
  try {
    await vi.waitFor(() => expect(appStore.get(agentAccountsAtom).codex.status).toBe('signed-in'))
    flushSync(() => appStore.set(agentAccountsAtom, { ...appStore.get(agentAccountsAtom) }))
    toggle()
    expect(saves).toHaveLength(1)
    expect(window.document.querySelector('.agent-auth')).not.toBeNull()
    expect(
      window.document.querySelector<HTMLButtonElement>('.agent-access-mode button')!.disabled,
    ).toBe(false)
    toggle()
    toggle()
    toggle()
    expect(saves).toHaveLength(1)
    expect(window.document.querySelector('.agent-auth')).toBeNull()
    expect(
      [...window.document.querySelectorAll<HTMLInputElement>('input')].every(
        (input) => !input.disabled,
      ),
    ).toBe(true)
    expect(
      window.document.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled,
    ).toBe(true)
    saves[0]()
    await vi.waitFor(() => expect(saves).toHaveLength(2))
    expect(
      vi
        .mocked(agentCommand)
        .mock.calls.flatMap(([command]) =>
          command.action === 'set-access' ? [command.access] : [],
        ),
    ).toEqual(['native', 'api'])
    saves[1]()
    await vi.waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(false))
    expect(window.document.querySelector('.agent-auth')).toBeNull()
    expect(
      window.document.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled,
    ).toBe(false)
  } finally {
    for (const finish of saves) finish()
    flushSync(() => root.unmount())
  }
})

it('restores the last saved connection mode and reports a failed switch', async () => {
  vi.mocked(agentCommand).mockImplementation(async (command) => {
    if (command.action === 'check-sign-in') return reply('signed-in')
    throw new Error('AGENT_STORAGE_FAILED')
  })
  const { window, flushSync, root, onBusyChange } = await render({
    ...setup,
    configuration: {
      ...setup.configuration,
      access: 'api',
      baseUrl: 'https://api.example.com',
      model: 'saved-model',
      hasApiKey: true,
    },
  })
  try {
    await vi.waitFor(() => expect(appStore.get(agentAccountsAtom).codex.status).toBe('signed-in'))
    flushSync(() => appStore.set(agentAccountsAtom, { ...appStore.get(agentAccountsAtom) }))
    flushSync(() =>
      window.document.querySelector<HTMLButtonElement>('.agent-access-mode button')!.click(),
    )
    await vi.waitFor(() => expect(window.document.querySelector('.agent-auth')).toBeNull())
    expect(window.document.querySelector('[role="alert"]')?.textContent).toBe(
      'AGENT_STORAGE_FAILED',
    )
    expect(onBusyChange).toHaveBeenLastCalledWith(false)
  } finally {
    flushSync(() => root.unmount())
  }
})
it('tests an API connection before persisting it, and stays in settings with confirmation', async () => {
  vi.mocked(agentCommand).mockImplementation(async (command) =>
    command.action === 'check-sign-in'
      ? reply('signed-out')
      : command.action === 'configure'
        ? acceptApiConfiguration(command)
        : {},
  )
  const { window, flushSync, root } = await render({
    ...setup,
    configuration: {
      ...setup.configuration,
      access: 'api',
      baseUrl: 'https://api.example.com',
      model: 'saved-model',
      hasApiKey: true,
    },
  })
  try {
    flushSync(() =>
      window.document
        .querySelector('form')!
        .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })),
    )
    await vi.waitFor(() =>
      expect(window.document.querySelector('.agent-test-success')?.textContent).toContain(
        'agent.connectionReady',
      ),
    )
    expect(
      vi
        .mocked(agentCommand)
        .mock.calls.filter(([command]) => command.action !== 'check-sign-in')
        .map(([command]) => command.action),
    ).toEqual(['configure'])
    expect(window.document.querySelector('.agent-settings')).not.toBeNull()
  } finally {
    flushSync(() => root.unmount())
  }
})
it.each([false, true])(
  'clears history only after confirming in the popover (confirm: %s)',
  async (confirm) => {
    vi.mocked(agentCommand).mockImplementation(async (command) =>
      command.action === 'check-sign-in' ? reply('signed-in') : {},
    )
    const { window, flushSync, root, onBusyChange } = await render()
    try {
      flushSync(() =>
        window.document.querySelector<HTMLButtonElement>('.agent-history-data .ui-button')!.click(),
      )
      expect(
        vi.mocked(agentCommand).mock.calls.some(([command]) => command.action === 'clear-history'),
      ).toBe(false)
      expect(window.document.querySelector('.agent-history-data .agent-card-actions')).toBeNull()
      expect(window.document.querySelector('.agent-history-confirm')?.textContent).toContain(
        'agent.clearHistoryDetail',
      )
      flushSync(() =>
        window.document
          .querySelectorAll<HTMLButtonElement>('.agent-history-confirm-actions .ui-button')
          [confirm ? 1 : 0].click(),
      )
      if (confirm) {
        await vi.waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(false))
        expect(agentCommand).toHaveBeenCalledWith({ action: 'clear-history' })
        expect(toast).toHaveBeenCalledWith('agent.historyCleared')
      } else {
        expect(
          vi
            .mocked(agentCommand)
            .mock.calls.some(([command]) => command.action === 'clear-history'),
        ).toBe(false)
        expect(toast).not.toHaveBeenCalled()
      }
      expect(window.document.querySelector('.agent-history-confirm')).toBeNull()
    } finally {
      flushSync(() => root.unmount())
    }
  },
)
it('keeps the confirmation open with a retryable error if clearing fails', async () => {
  vi.mocked(agentCommand).mockImplementation(async (command) => {
    if (command.action === 'clear-history') throw new Error('Clear failed')
    return reply('signed-in')
  })
  const { window, flushSync, root } = await render()
  try {
    flushSync(() =>
      window.document.querySelector<HTMLButtonElement>('.agent-history-data .ui-button')!.click(),
    )
    flushSync(() =>
      window.document.querySelector<HTMLButtonElement>('.agent-history-delete')!.click(),
    )
    await vi.waitFor(() =>
      expect(
        window.document.querySelector('.agent-history-confirm [role="alert"]')?.textContent,
      ).toBe('Clear failed'),
    )
    expect(toast).not.toHaveBeenCalled()
    vi.mocked(agentCommand).mockResolvedValue({})
    flushSync(() =>
      window.document.querySelector<HTMLButtonElement>('.agent-history-delete')!.click(),
    )
    await vi.waitFor(() => expect(toast).toHaveBeenCalledWith('agent.historyCleared'))
    expect(window.document.querySelector('.agent-history-confirm')).toBeNull()
  } finally {
    flushSync(() => root.unmount())
  }
})
it('does not probe accounts until the runtime is installed', async () => {
  vi.mocked(agentCommand).mockResolvedValue(reply('signed-in'))
  const { window, flushSync, root } = await render({ ...setup, runtimeAvailable: false })
  try {
    expect(agentCommand).not.toHaveBeenCalled()
    expect(window.document.querySelector('.agent-auth [role="status"]')?.textContent).toContain(
      'agent.errors.AGENT_RUNTIME_REQUIRED',
    )
    flushSync(() => appStore.set(agentSetupAtom, setup))
    await vi.waitFor(() => expect(agentCommand).toHaveBeenCalledTimes(2))
  } finally {
    flushSync(() => root.unmount())
  }
})

it('reports an incomplete IPC response without rendering an empty account record', async () => {
  vi.mocked(agentCommand).mockResolvedValue({})
  const { window, flushSync, root } = await render()
  try {
    await vi.waitFor(() =>
      expect(window.document.querySelector('[role="alert"]')?.textContent).toBe(
        'AGENT_AUTH_CHECK_FAILED',
      ),
    )
    expect(window.document.querySelectorAll('.agent-tool-status[data-state="error"]')).toHaveLength(
      2,
    )
  } finally {
    flushSync(() => root.unmount())
  }
})

it('shows a configured API instead of native sign-out on the selected tool', async () => {
  vi.mocked(agentCommand).mockResolvedValue(reply('signed-out'))
  const { window, flushSync, root } = await render({
    ...setup,
    configuration: {
      provider: 'claude',
      access: 'api',
      hasApiKey: true,
      baseUrl: 'https://api.deepseek.com/anthropic',
      model: 'deepseek-flash',
    },
  })
  try {
    expect(
      window.document.querySelector('.agent-tool-card[aria-pressed="true"] .agent-tool-status')
        ?.textContent,
    ).toBe('agent.apiConfigured')
    await vi.waitFor(() => expect(appStore.get(agentAccountsAtom).claude.status).toBe('signed-out'))
    expect(
      window.document.querySelector('.agent-tool-card[aria-pressed="true"] .agent-tool-status')
        ?.textContent,
    ).toBe('agent.apiConfigured')
  } finally {
    flushSync(() => root.unmount())
  }
})
it.each(['signed-out', 'checking', 'error'] as const)(
  'keeps the saved API active while browsing an account that is %s',
  async (status) => {
    vi.mocked(agentCommand).mockImplementation(async (command) => {
      if (command.action !== 'check-sign-in') return {}
      if (status === 'checking') return new Promise(() => {})
      if (status === 'error') throw new Error('AGENT_AUTH_CHECK_FAILED')
      return reply('signed-out')
    })
    const apiSetup: AgentSetup = {
      ...setup,
      configuration: {
        provider: 'claude',
        access: 'api',
        hasApiKey: true,
        baseUrl: 'https://api.example.com',
        model: 'saved-model',
      },
    }
    const { window, flushSync, root } = await render(apiSetup)
    try {
      await vi.waitFor(() => expect(appStore.get(agentAccountsAtom).claude.status).toBe(status))
      flushSync(() =>
        window.document.querySelector<HTMLButtonElement>('.agent-access-mode button')!.click(),
      )
      expect(window.document.querySelector('.agent-auth')).not.toBeNull()
      expect(appStore.get(agentSetupAtom)!.configuration.access).toBe('api')
      expect(
        window.document.querySelector('.agent-tool-card[aria-pressed="true"] .agent-tool-status')
          ?.textContent,
      ).toBe('agent.apiConfigured')
      expect(
        vi.mocked(agentCommand).mock.calls.some(([command]) => command.action === 'configure'),
      ).toBe(false)
      flushSync(() =>
        appStore.set(agentSetupAtom, {
          ...apiSetup,
          configuration: { ...apiSetup.configuration, provider: 'codex' },
        }),
      )
      flushSync(() => appStore.set(agentSetupAtom, apiSetup))
      expect(window.document.querySelector('.agent-auth')).toBeNull()
      expect(appStore.get(agentSetupAtom)!.configuration.access).toBe('api')
    } finally {
      flushSync(() => root.unmount())
    }
  },
)
it('activates a newly signed-in account only after choosing to use it', async () => {
  vi.mocked(agentCommand).mockImplementation(async (command) => {
    if (command.action === 'check-sign-in') return reply('signed-out')
    if (command.action === 'set-access') {
      const current = appStore.get(agentSetupAtom)!
      appStore.set(agentSetupAtom, {
        ...current,
        configuration: { ...current.configuration, access: command.access },
      })
    }
    return {}
  })
  const { window, flushSync, root } = await render({
    ...setup,
    configuration: {
      ...setup.configuration,
      access: 'api',
      hasApiKey: true,
      baseUrl: 'https://api.example.com',
      model: 'saved-model',
    },
  })
  try {
    await vi.waitFor(() => expect(appStore.get(agentAccountsAtom).codex.status).toBe('signed-out'))
    flushSync(() => appStore.set(agentAccountsAtom, { ...appStore.get(agentAccountsAtom) }))
    flushSync(() =>
      window.document.querySelector<HTMLButtonElement>('.agent-access-mode button')!.click(),
    )
    expect(window.document.querySelector('.agent-auth-status')?.textContent).toContain(
      'agent.accountNotSignedInWithApi',
    )
    flushSync(() =>
      appStore.set(agentAccountsAtom, {
        claude: { status: 'signed-out' },
        codex: { status: 'signed-in' },
      }),
    )
    expect(
      vi.mocked(agentCommand).mock.calls.some(([command]) => command.action === 'configure'),
    ).toBe(false)
    const useAccount = window.document.querySelector<HTMLButtonElement>(
      '.agent-auth-actions .ui-button',
    )!
    expect(useAccount.textContent).toBe('agent.useAccount')
    flushSync(() => useAccount.click())
    await vi.waitFor(() =>
      expect(appStore.get(agentSetupAtom)!.configuration.access).toBe('native'),
    )
    expect(appStore.get(agentSetupAtom)!.configuration.hasApiKey).toBe(true)
    expect(
      window.document.querySelector('.agent-tool-card[aria-pressed="true"] .agent-tool-status')
        ?.textContent,
    ).toBe('agent.accountSignedIn')
  } finally {
    flushSync(() => root.unmount())
  }
})
it('uses the saved API mode on an inactive tool instead of its unrelated CLI account', async () => {
  vi.mocked(agentCommand).mockResolvedValue(reply('signed-out'))
  const { window, flushSync, root } = await render({
    ...setup,
    connectionProfiles: {
      claude: { access: 'api', apiConfigured: true },
      codex: { access: 'native', apiConfigured: false },
    },
  })
  try {
    expect(window.document.querySelectorAll('.agent-tool-status')[0].textContent).toBe(
      'agent.apiConfigured',
    )
    await vi.waitFor(() =>
      expect(window.document.querySelectorAll('.agent-tool-status')[1].textContent).toBe(
        'agent.accountSignedOut',
      ),
    )
    expect(window.document.querySelectorAll('.agent-tool-status')[0].textContent).toBe(
      'agent.apiConfigured',
    )
  } finally {
    flushSync(() => root.unmount())
  }
})
it.each([
  { hasApiKey: false, baseUrl: 'https://api.example.com', model: 'model' },
  { hasApiKey: true, baseUrl: '', model: 'model' },
  { hasApiKey: true, baseUrl: 'https://api.example.com', model: '' },
])('shows setup required for an incomplete API profile', async (profile) => {
  vi.mocked(agentCommand).mockResolvedValue(reply('signed-in'))
  const { window, flushSync, root } = await render({
    ...setup,
    configuration: { ...setup.configuration, access: 'api', ...profile },
  })
  try {
    expect(
      window.document.querySelector('.agent-tool-card[aria-pressed="true"] .agent-tool-status')
        ?.textContent,
    ).toBe('agent.apiUnconfigured')
  } finally {
    flushSync(() => root.unmount())
  }
})

it('keeps rejected DeepSeek keys unsaved, marks the connection failed and reveals the error at the key field, and clears it on retry', async () => {
  let rejectKey = true
  vi.mocked(agentCommand).mockImplementation(async (command) => {
    if (command.action === 'check-sign-in') return reply('signed-out')
    if ((command.action === 'configure' || command.action === 'test-connection') && rejectKey)
      throw new Error('AGENT_API_AUTH_FAILED')
    return command.action === 'configure' ? acceptApiConfiguration(command) : {}
  })
  const { window, flushSync, root } = await render({
    ...setup,
    configuration: {
      provider: 'claude',
      access: 'api',
      apiService: 'deepseek',
      baseUrl: 'https://api.deepseek.com/anthropic',
      model: 'deepseek-flash',
      hasApiKey: true,
    },
  })
  const submit = () =>
    flushSync(() =>
      window.document
        .querySelector('form')!
        .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })),
    )
  try {
    submit()
    await vi.waitFor(() =>
      expect(window.document.querySelector('[role="alert"]')?.textContent).toBe(
        'AGENT_API_AUTH_FAILED',
      ),
    )
    const error = window.document.querySelector('[role="alert"]')!
    expect(error.className).toBe('agent-key-error')
    expect(
      error.previousElementSibling
        ?.querySelector('input[type="password"]')
        ?.getAttribute('aria-invalid'),
    ).toBe('true')
    expect(
      window.document
        .querySelector('.agent-tool-card[aria-pressed="true"] .agent-tool-status')
        ?.getAttribute('data-state'),
    ).toBe('api-error')
    expect(error.parentElement!.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
    expect(window.document.querySelector('.agent-test-success')).toBeNull()
    expect(
      window.document.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled,
    ).toBe(false)
    rejectKey = false
    submit()
    await vi.waitFor(() =>
      expect(window.document.querySelector('.agent-test-success')).not.toBeNull(),
    )
    expect(window.document.querySelector('[role="alert"]')).toBeNull()
    expect(
      window.document
        .querySelector('.agent-tool-card[aria-pressed="true"] .agent-tool-status')
        ?.getAttribute('data-state'),
    ).toBe('api-connected')
    expect(
      window.document.querySelector('input[type="password"]')?.hasAttribute('aria-invalid'),
    ).toBe(false)
    rejectKey = true
    submit()
    await vi.waitFor(() => expect(window.document.querySelector('[role="alert"]')).not.toBeNull())
    expect(window.document.querySelector('.agent-test-success')).toBeNull()
  } finally {
    flushSync(() => root.unmount())
  }
})

it.each([true, false])(
  'restores saved API verification when reopening settings: %s',
  async (apiVerified) => {
    vi.mocked(agentCommand).mockResolvedValue(reply('signed-out'))
    const { window, flushSync, root } = await render({
      ...setup,
      configuration: {
        ...setup.configuration,
        access: 'api',
        baseUrl: 'https://api.example.com',
        model: 'saved-model',
        hasApiKey: true,
        apiVerified,
      },
    })
    try {
      expect(
        window.document
          .querySelector('.agent-tool-card[aria-pressed="true"] .agent-tool-status')
          ?.getAttribute('data-state'),
      ).toBe(apiVerified ? 'api-connected' : 'api-configured')
      expect(agentCommand).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: 'configure' }),
      )
    } finally {
      flushSync(() => root.unmount())
    }
  },
)

it('waits for runtime inspection before querying local accounts', async () => {
  const { window } = parseHTML('<html><body><div id="root"></div></body></html>')
  vi.stubGlobal('window', window)
  vi.stubGlobal('document', window.document)
  const { createRoot } = await import('react-dom/client')
  const { flushSync } = await import('react-dom')
  const root = createRoot(window.document.getElementById('root')!)
  function Panel() {
    useAgentAccounts(true)
    return null
  }
  vi.mocked(agentCommand).mockResolvedValue(reply('signed-out'))
  const missing = { status: 'missing' as const, source: null, transferred: 0, total: 0 }
  try {
    appStore.set(agentSetupAtom, null)
    flushSync(() => root.render(createElement(Provider, { store: appStore }, createElement(Panel))))
    expect(agentCommand).not.toHaveBeenCalled()
    flushSync(() =>
      appStore.set(agentSetupAtom, {
        ...setup,
        runtimeAvailable: false,
        components: { claude: missing, codex: missing },
      }),
    )
    expect(agentCommand).not.toHaveBeenCalled()
    flushSync(() =>
      appStore.set(agentSetupAtom, {
        ...setup,
        components: { claude: missing, codex: { ...missing, status: 'ready', source: 'local' } },
      }),
    )
    await vi.waitFor(() =>
      expect(agentCommand).toHaveBeenCalledWith({ action: 'check-sign-in', provider: 'codex' }),
    )
    expect(agentCommand).not.toHaveBeenCalledWith({ action: 'check-sign-in', provider: 'claude' })
  } finally {
    flushSync(() => root.unmount())
  }
})

it.each([true, false])(
  'uses read-only testing for an unchanged verified API profile (runtime ready=%s)',
  async (runtimeAvailable) => {
    let finish!: (result: AgentCommandResult) => void
    vi.mocked(agentCommand).mockImplementation(async (command) =>
      command.action === 'test-connection'
        ? new Promise((resolve) => {
            finish = resolve
          })
        : {},
    )
    const saved: AgentSetup = {
      ...setup,
      runtimeAvailable,
      configuration: {
        ...setup.configuration,
        access: 'api',
        baseUrl: 'https://api.example.com',
        model: 'fixture-model',
        hasApiKey: true,
        apiVerified: true,
      },
    }
    const { window, flushSync, root } = await render(saved)
    try {
      const button = window.document.querySelector<HTMLButtonElement>('button[type="submit"]')!
      expect(button.textContent).toBe('agent.testConnection')
      flushSync(() =>
        window.document
          .querySelector('form')!
          .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })),
      )
      expect(button.textContent).toBe('agent.testingConnection')
      expect(button.disabled).toBe(true)
      finish({})
      await vi.waitFor(() => expect(toast).toHaveBeenCalledWith('agent.connectionTestPassed'))
      expect(button.textContent).toBe('agent.testConnection')
      expect(agentCommand).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: 'configure' }),
      )
      expect(agentCommand).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'install' }))
      expect(appStore.get(agentSetupAtom)).toEqual(saved)
    } finally {
      flushSync(() => root.unmount())
    }
  },
)

it('keeps a persistence failure distinct from a rejected API key', async () => {
  vi.mocked(agentCommand).mockRejectedValue(new Error('AGENT_SECURE_STORAGE_UNAVAILABLE'))
  const { window, flushSync, root } = await render({
    ...setup,
    configuration: {
      ...setup.configuration,
      access: 'api',
      baseUrl: 'https://fixture.example',
      model: 'fixture',
      hasApiKey: true,
    },
  })
  try {
    expect(window.document.querySelector('button[type="submit"]')!.textContent).toBe(
      'agent.saveApiConnection',
    )
    flushSync(() =>
      window.document
        .querySelector('form')!
        .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })),
    )
    await vi.waitFor(() =>
      expect(window.document.querySelector('[role="alert"]')?.textContent).toBe(
        'AGENT_SECURE_STORAGE_UNAVAILABLE',
      ),
    )
    expect(
      window.document.querySelector('input[type="password"]')?.hasAttribute('aria-invalid'),
    ).toBe(false)
    expect(window.document.querySelector('.agent-test-success')).toBeNull()
  } finally {
    flushSync(() => root.unmount())
  }
})
