import { useId, useRef, useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import {
  agentApiService,
  savedAgentApiService,
  agentApiPresets,
  canReuseAgentApiKey,
  normalizeAgentApiUrl,
} from '@shared/agentApi'
import { agentCommand, agentSetupAtom } from '../../store/agent'
import { Button } from '../ui/Button'
import { Select } from '../ui/Select'
import { Segmented } from '../settings/controls'
import { Icon } from '../Icon'
import type { AgentAccountState } from '../../store/agent'
import type { AgentProvider } from '@shared/types/agent'
import { agentErrorText } from './agentError'
import { AgentAccount } from './AgentAccount'
import { AgentApiModelField } from './AgentApiModelField'
import { toast } from '../Toaster'

export function AgentSettings({
  disabled = false,
  accounts,
  onCheckAccount,
  onLogin,
  onProviderChange,
  onBusyChange,
}: {
  disabled?: boolean
  accounts: Record<AgentProvider, AgentAccountState>
  onCheckAccount(provider: AgentProvider): void
  onLogin(provider: AgentProvider): Promise<void>
  onProviderChange(provider: AgentProvider): void
  onBusyChange(busy: boolean): void
}) {
  const { t } = useTranslation()
  const setup = useAtomValue(agentSetupAtom)!
  const configuration = setup.configuration
  const presets = agentApiPresets(configuration.provider)
  const savedService = savedAgentApiService(
    configuration.provider,
    configuration.baseUrl,
    configuration.apiService,
  )
  const [apiService, setApiService] = useState(savedService)
  const preset = agentApiService(configuration.provider, savedService)
  const [access, setAccess] = useState(configuration.access)
  const [baseUrl, setBaseUrl] = useState(
    normalizeAgentApiUrl(configuration.provider, configuration.baseUrl),
  )
  const [model, setModel] = useState(
    preset.id === 'deepseek' && configuration.model === 'deepseek'
      ? preset.model
      : configuration.model,
  )
  const [apiKey, setApiKey] = useState('')
  const [pending, setPending] = useState<'access' | 'save' | 'install' | 'login' | 'clear' | null>(
    null,
  )
  const [error, setError] = useState('')
  const [connected, setConnected] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const confirmationId = useId()
  const working = useRef<typeof pending>(null)
  const desiredAccess = useRef(access)
  const savedAccess = useRef(configuration.access)
  const busy = pending !== null || disabled
  const editingDisabled = busy && pending !== 'access'
  const nativeReady = accounts[configuration.provider].status === 'signed-in'
  const savedApiReady = !!(
    configuration.hasApiKey &&
    configuration.baseUrl.trim() &&
    configuration.model.trim()
  )
  const hasKey =
    configuration.hasApiKey &&
    canReuseAgentApiKey(configuration.provider, configuration, { baseUrl, apiService })
  const ready = !!(baseUrl.trim() && model.trim() && (apiKey.trim() || hasKey))
  const change = (update: () => void) => {
    update()
    setConnected(false)
    setError('')
  }
  const run = async (operation: NonNullable<typeof pending>, work: () => Promise<void>) => {
    if (working.current) return
    working.current = operation
    setPending(operation)
    onBusyChange(true)
    setError('')
    try {
      await work()
      return true
    } catch (error) {
      setError(agentErrorText(error instanceof Error ? error.message : ''))
      return false
    } finally {
      working.current = null
      setPending(null)
      onBusyChange(false)
    }
  }
  const chooseAccess = async (value: 'native' | 'api') => {
    if (
      (value === desiredAccess.current && (value === savedAccess.current || working.current)) ||
      (working.current && working.current !== 'access')
    )
      return
    desiredAccess.current = value
    change(() => setAccess(value))
    if (working.current) return
    if ((value === 'native' && !nativeReady) || (value === 'api' && !savedApiReady)) return
    const saved = await run('access', async () => {
      // Runtime teardown can be slow; coalesce clicks without overlapping configuration writes.
      while (desiredAccess.current !== savedAccess.current) {
        const next = desiredAccess.current
        if ((next === 'native' && !nativeReady) || (next === 'api' && !savedApiReady)) return
        await agentCommand({
          action: 'configure',
          provider: configuration.provider,
          access: next,
          apiService: savedService,
          baseUrl: configuration.baseUrl,
          model: configuration.model,
        })
        savedAccess.current = next
      }
    })
    if (!saved) {
      desiredAccess.current = savedAccess.current
      setAccess(savedAccess.current)
    }
  }
  return (
    <form
      className="agent-settings"
      onSubmit={(event) => {
        event.preventDefault()
        if (access !== 'api' || !ready) return
        void run('save', async () => {
          await agentCommand({
            action: 'test-connection',
            provider: configuration.provider,
            apiService,
            baseUrl,
            model,
            ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
          })
          await agentCommand({
            action: 'configure',
            provider: configuration.provider,
            access,
            apiService,
            baseUrl,
            model,
            ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
          })
          savedAccess.current = access
          setConnected(true)
        })
      }}
    >
      <div className="agent-settings-fields">
        {!setup.runtimeAvailable && (
          <div className="agent-runtime">
            <p>{t('agent.installDescription')}</p>
            <Button
              disabled={busy}
              onClick={() =>
                void run('install', async () => {
                  await agentCommand({ action: 'install' })
                })
              }
            >
              {t(pending === 'install' ? 'agent.installing' : 'agent.install')}
            </Button>
          </div>
        )}
        <fieldset className="agent-tool-choice">
          <legend>Harness</legend>
          <div className="agent-tool-cards">
            {(['claude', 'codex'] as const).map((provider) => {
              const selected = configuration.provider === provider
              const profile = setup.connectionProfiles?.[provider]
              const usesApi = selected ? configuration.access === 'api' : profile?.access === 'api'
              const apiConfigured = selected ? savedApiReady : profile?.apiConfigured
              const status = !setup.runtimeAvailable
                ? 'unavailable'
                : usesApi
                  ? apiConfigured
                    ? 'api-configured'
                    : 'api-unconfigured'
                  : accounts[provider].status
              return (
                <Button
                  key={provider}
                  className="agent-tool-card"
                  disabled={busy}
                  aria-pressed={selected}
                  onClick={() => {
                    if (!selected) onProviderChange(provider)
                  }}
                >
                  <span className="agent-tool-icon">
                    <Icon name={provider === 'claude' ? 'terminal' : 'cube'} size={20} />
                  </span>
                  <span className="agent-tool-info">
                    <strong>{provider === 'claude' ? 'Claude Code' : 'Codex'}</strong>
                    <span className="agent-tool-status" data-state={status}>
                      <span />
                      {t(
                        status === 'api-configured'
                          ? 'agent.apiConfigured'
                          : status === 'api-unconfigured'
                            ? 'agent.apiUnconfigured'
                            : status === 'signed-in'
                              ? 'agent.accountSignedIn'
                              : status === 'signed-out'
                                ? 'agent.accountSignedOut'
                                : status === 'checking' || status === 'unknown'
                                  ? 'agent.accountChecking'
                                  : status === 'unavailable'
                                    ? 'agent.accountUnavailable'
                                    : 'agent.accountCheckFailed',
                      )}
                    </span>
                  </span>
                  {selected && (
                    <span className="agent-tool-selected">
                      <Icon name="tick" size={12} />
                    </span>
                  )}
                </Button>
              )
            })}
          </div>
          <p>{t('agent.apiHarnessRecommendation')}</p>
        </fieldset>
        <div className="agent-access-mode" aria-busy={pending === 'access'}>
          <span>{t('agent.access')}</span>
          <Segmented
            value={access}
            disabled={editingDisabled}
            options={[
              {
                value: 'native',
                label: t(
                  configuration.provider === 'claude'
                    ? 'agent.claudeAccount'
                    : 'agent.chatgptAccount',
                ),
              },
              { value: 'api', label: 'API Key' },
            ]}
            onChange={(value) => void chooseAccess(value)}
          />
        </div>
        {access === 'native' ? (
          <AgentAccount
            provider={configuration.provider}
            account={accounts[configuration.provider]}
            usingApi={configuration.access === 'api'}
            onUse={
              configuration.access === 'api' && nativeReady
                ? () => void chooseAccess('native')
                : undefined
            }
            onCheck={() => onCheckAccount(configuration.provider)}
            runtimeAvailable={setup.runtimeAvailable}
            busy={busy}
            onLogin={() =>
              void run('login', async () => {
                await onLogin(configuration.provider)
              })
            }
          />
        ) : (
          <>
            <label>
              {t('agent.apiProvider')}
              <Select
                value={apiService}
                displayValue={
                  apiService === 'custom'
                    ? t('agent.customProvider')
                    : agentApiService(configuration.provider, apiService).label
                }
                description={
                  configuration.provider === 'codex' ? t('agent.apiProtocolHelp') : undefined
                }
                disabled={editingDisabled}
                options={presets.map((item) => ({
                  value: item.id,
                  label: item.id === 'custom' ? t('agent.customProvider') : item.label,
                }))}
                onChange={(value) =>
                  change(() => {
                    const next = presets.find((item) => item.id === value)!
                    setApiService(next.id)
                    setBaseUrl(next.baseUrl)
                    setModel(next.model)
                    setApiKey('')
                  })
                }
              />
            </label>
            <small>{t('agent.apiServiceKeyHelp')}</small>
            <label>
              {t('agent.baseUrl')}
              <input
                value={baseUrl}
                readOnly={apiService !== 'custom'}
                disabled={editingDisabled}
                spellCheck={false}
                autoComplete="off"
                onChange={(event) => change(() => setBaseUrl(event.target.value))}
                placeholder={
                  configuration.provider === 'claude'
                    ? 'https://api.anthropic.com'
                    : 'https://api.openai.com/v1'
                }
              />
            </label>
            <label>
              API key
              <input
                type="password"
                value={apiKey}
                disabled={editingDisabled}
                autoComplete="off"
                onChange={(event) => change(() => setApiKey(event.target.value))}
                placeholder={hasKey ? t('agent.keySaved') : ''}
              />
            </label>
            <small className="agent-key-note">
              <Icon name="lock" size={14} />
              {t('agent.keyStorage')}
            </small>
            <AgentApiModelField
              key={apiService}
              provider={configuration.provider}
              apiService={apiService}
              baseUrl={baseUrl}
              apiKey={apiKey}
              hasKey={hasKey}
              model={model}
              disabled={editingDisabled}
              onChange={(value) => change(() => setModel(value))}
            />
            <div className="agent-test-row">
              <Button type="submit" variant="primary" size="small" disabled={busy || !ready}>
                {t(pending === 'save' ? 'agent.testingConnection' : 'agent.connectApi')}
              </Button>
              {connected && (
                <span className="agent-test-success" role="status">
                  <Icon name="tick" size={14} />
                  {t('agent.connectionReady')}
                </span>
              )}
            </div>
          </>
        )}
        <section className="agent-history-data">
          <div>
            <h3>{t('agent.historyData')}</h3>
            <p>{t('agent.clearHistoryHelp')}</p>
          </div>
          <Popover.Root
            open={confirmClear}
            onOpenChange={(open) => {
              if (pending === 'clear') return
              setConfirmClear(open)
              if (open) setError('')
            }}
          >
            <Popover.Trigger asChild>
              <Button
                className="agent-history-clear"
                variant="danger-ghost"
                size="small"
                disabled={busy}
              >
                {t('agent.clearHistoryShort')}
              </Button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                className="agent-history-confirm"
                side="top"
                align="end"
                sideOffset={8}
                collisionPadding={12}
                aria-labelledby={confirmationId}
                aria-describedby={`${confirmationId}-description`}
              >
                <h3 id={confirmationId}>{t('agent.confirmClearHistory')}</h3>
                <p id={`${confirmationId}-description`}>{t('agent.clearHistoryDetail')}</p>
                {error && (
                  <p className="agent-error" role="alert">
                    {error}
                  </p>
                )}
                <div className="agent-history-confirm-actions">
                  <Button size="small" disabled={busy} onClick={() => setConfirmClear(false)}>
                    {t('common.cancel')}
                  </Button>
                  <Button
                    className="agent-history-delete"
                    variant="danger"
                    size="small"
                    disabled={busy}
                    onClick={() =>
                      void run('clear', async () => {
                        await agentCommand({ action: 'clear-history' })
                        setConfirmClear(false)
                        toast(t('agent.historyCleared'))
                      })
                    }
                  >
                    {t('agent.clearHistory')}
                  </Button>
                </div>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        </section>
        {error && !confirmClear && (
          <div className="agent-error" role="alert">
            {error}
          </div>
        )}
      </div>
    </form>
  )
}
