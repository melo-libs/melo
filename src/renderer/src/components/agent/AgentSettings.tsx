import { useEffect, useId, useRef, useState } from 'react'
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
import { AgentRuntimeProgress, runtimeWorking, runtimeMegabytes } from './AgentRuntimeProgress'
import { toast } from '../Toaster'

const connectionLabels = {
  'api-unverified': 'agent.apiUnverified',
  'api-error': 'agent.apiConnectionFailed',
  'api-connected': 'agent.apiVerified',
  'api-checking': 'agent.testingConnection',
  'api-configured': 'agent.apiConfigured',
  'api-unconfigured': 'agent.apiUnconfigured',
  'signed-in': 'agent.accountSignedIn',
  'signed-out': 'agent.accountSignedOut',
  checking: 'agent.accountChecking',
  unknown: 'agent.accountChecking',
  unavailable: 'agent.accountUnavailable',
  error: 'agent.accountCheckFailed',
} as const

export function AgentSettings({
  disabled = false,
  initialAccess,
  accounts,
  onCheckAccount,
  onLogin,
  onProviderChange,
  onBusyChange,
}: {
  disabled?: boolean
  initialAccess?: 'api'
  accounts: Record<AgentProvider, AgentAccountState>
  onCheckAccount(provider: AgentProvider): void
  onLogin(provider: AgentProvider): Promise<void>
  onProviderChange(provider: AgentProvider): void
  onBusyChange(busy: boolean): void
}) {
  const { t } = useTranslation()
  const setup = useAtomValue(agentSetupAtom)!
  const configuration = setup.configuration
  const component = setup.components?.[configuration.provider]
  const downloading = runtimeWorking(component)
  const presets = agentApiPresets(configuration.provider)
  const savedService = savedAgentApiService(
    configuration.provider,
    configuration.baseUrl,
    configuration.apiService,
  )
  const [apiService, setApiService] = useState(savedService)
  const preset = agentApiService(configuration.provider, savedService)
  const [access, setAccess] = useState(initialAccess ?? configuration.access)
  const [baseUrl, setBaseUrl] = useState(
    normalizeAgentApiUrl(configuration.provider, configuration.baseUrl),
  )
  const [model, setModel] = useState(
    preset.id === 'deepseek' && configuration.model === 'deepseek'
      ? preset.model
      : configuration.model,
  )
  const [apiKey, setApiKey] = useState('')
  const [pending, setPending] = useState<
    'access' | 'test' | 'save' | 'install' | 'login' | 'clear' | null
  >(null)
  const [error, setError] = useState<{
    operation: NonNullable<typeof pending>
    code: string
  } | null>(null)
  const errorElement = useRef<HTMLDivElement>(null)
  useEffect(() => {
    errorElement.current?.scrollIntoView({ block: 'nearest' })
  }, [error])
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
  const matchesSavedApi = hasKey && !apiKey.trim() && model === configuration.model
  const verified = matchesSavedApi && !!configuration.apiVerified
  const apiEdited =
    !!apiKey.trim() ||
    apiService !== savedService ||
    baseUrl !== normalizeAgentApiUrl(configuration.provider, configuration.baseUrl) ||
    model !== configuration.model
  const apiError =
    error && (error.operation === 'save' || error.operation === 'test') ? error : null
  const keyError = apiError?.code === 'AGENT_API_AUTH_FAILED'
  const testOnly = verified && configuration.access === 'api'
  const keyErrorId = useId()
  const ready = !!(baseUrl.trim() && model.trim() && (apiKey.trim() || hasKey))
  const change = (update: () => void) => {
    update()
    setError(null)
  }
  const run = async (operation: NonNullable<typeof pending>, work: () => Promise<void>) => {
    if (working.current) return
    working.current = operation
    setPending(operation)
    onBusyChange(true)
    setError(null)
    try {
      await work()
      return true
    } catch (error) {
      if (!(error instanceof Error && error.message === 'AGENT_DOWNLOAD_CANCELLED'))
        setError({
          operation,
          code: error instanceof Error ? error.message : '',
        })
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
    setAccess(value)
    setError(null)
    if (working.current) return
    if ((value === 'native' && !nativeReady) || (value === 'api' && !savedApiReady)) return
    const saved = await run('access', async () => {
      // Runtime teardown can be slow; coalesce clicks without overlapping configuration writes.
      while (desiredAccess.current !== savedAccess.current) {
        const next = desiredAccess.current
        if ((next === 'native' && !nativeReady) || (next === 'api' && !savedApiReady)) return
        await agentCommand({
          action: 'set-access',
          provider: configuration.provider,
          access: next,
        })
        savedAccess.current = next
      }
    })
    if (!saved) {
      desiredAccess.current = savedAccess.current
      setAccess(savedAccess.current)
    }
  }
  const saveApi = async () => {
    if (!ready) return
    let needsRuntime = false
    const saved = await run('save', async () => {
      const result = await agentCommand({
        action: 'configure',
        provider: configuration.provider,
        access: 'api',
        apiService,
        baseUrl,
        model,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      })
      const updated = result.setup!
      setBaseUrl(updated.configuration.baseUrl)
      setModel(updated.configuration.model)
      setApiService(
        savedAgentApiService(
          configuration.provider,
          updated.configuration.baseUrl,
          updated.configuration.apiService,
        ),
      )
      setApiKey('')
      savedAccess.current = 'api'
      needsRuntime = !updated.runtimeAvailable
    })
    if (saved && needsRuntime)
      await run('install', async () => {
        await agentCommand({ action: 'install', provider: configuration.provider })
      })
  }
  const connected =
    verified && configuration.access === 'api' && setup.runtimeAvailable && !busy && !error
  return (
    <form
      className="agent-settings"
      onSubmit={(event) => {
        event.preventDefault()
        if (access !== 'api') return
        if (testOnly)
          void run('test', async () => {
            await agentCommand({ action: 'test-connection', provider: configuration.provider })
            toast(t('agent.connectionTestPassed'))
          })
        else void saveApi()
      }}
    >
      <div className="agent-settings-fields">
        <fieldset className="agent-tool-choice">
          <legend>Harness</legend>
          <div className="agent-tool-cards">
            {(['claude', 'codex'] as const).map((provider) => {
              const selected = configuration.provider === provider
              const profile = setup.connectionProfiles?.[provider]
              const usesApi = selected ? configuration.access === 'api' : profile?.access === 'api'
              const apiConfigured = selected ? savedApiReady : profile?.apiConfigured
              const apiStatus =
                pending === 'save' || pending === 'test'
                  ? 'api-checking'
                  : apiError
                    ? 'api-error'
                    : verified
                      ? 'api-connected'
                      : apiEdited
                        ? 'api-unverified'
                        : apiConfigured
                          ? 'api-configured'
                          : 'api-unconfigured'
              const status =
                selected && access === 'api'
                  ? apiStatus
                  : !(setup.components
                        ? setup.components[provider].status === 'ready'
                        : setup.runtimeAvailable)
                    ? 'unavailable'
                    : usesApi
                      ? (selected ? configuration.apiVerified : profile?.apiVerified)
                        ? 'api-connected'
                        : apiConfigured
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
                      {t(connectionLabels[status])}
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
        {(!setup.runtimeAvailable || error?.operation === 'install') && (
          <div className="agent-runtime">
            {error?.operation === 'install' && (
              <div className="agent-error" role="alert" ref={errorElement}>
                {agentErrorText(error.code)}
              </div>
            )}
            {component &&
            ['downloading', 'preparing', 'paused', 'error'].includes(component.status) ? (
              <AgentRuntimeProgress component={component} />
            ) : (
              <p>
                {t(
                  component?.source === 'local'
                    ? 'agent.componentLocal'
                    : 'agent.componentRequired',
                  { size: runtimeMegabytes(component?.total ?? 0) },
                )}
              </p>
            )}
            <Button
              disabled={!downloading && (busy || setup.installing)}
              onClick={() =>
                downloading
                  ? void agentCommand({
                      action: 'cancel-install',
                      provider: configuration.provider,
                    }).catch((error) =>
                      setError({
                        operation: 'install',
                        code: error.message,
                      }),
                    )
                  : void run('install', async () => {
                      await agentCommand({
                        action: 'install',
                        provider: configuration.provider,
                      })
                    })
              }
            >
              {t(
                downloading
                  ? 'common.cancel'
                  : component?.status === 'error' || component?.status === 'paused'
                    ? 'agent.componentRetry'
                    : 'agent.componentConnect',
              )}
            </Button>
          </div>
        )}
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
                label={t('agent.apiProvider')}
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
            <div ref={keyError ? errorElement : undefined}>
              <label>
                API key
                <input
                  type="password"
                  aria-invalid={keyError || undefined}
                  aria-describedby={keyError ? keyErrorId : undefined}
                  value={apiKey}
                  disabled={editingDisabled}
                  autoComplete="off"
                  onChange={(event) => change(() => setApiKey(event.target.value))}
                  placeholder={hasKey ? t('agent.keySaved') : ''}
                />
              </label>
              {apiError && keyError && (
                <div className="agent-key-error" role="alert" id={keyErrorId}>
                  {agentErrorText(apiError.code)}
                </div>
              )}
            </div>
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
            <div ref={apiError && !keyError ? errorElement : undefined}>
              {apiError && !keyError && (
                <div className="agent-error" role="alert">
                  {agentErrorText(apiError.code)}
                </div>
              )}
              <div className="agent-test-row">
                <Button type="submit" variant="primary" size="small" disabled={busy || !ready}>
                  {t(
                    pending === 'test'
                      ? 'agent.testingConnection'
                      : pending === 'save'
                        ? 'agent.verifyingConnection'
                        : testOnly
                          ? 'agent.testConnection'
                          : 'agent.saveApiConnection',
                  )}
                </Button>
                {connected && (
                  <span className="agent-test-success" role="status">
                    <Icon name="tick" size={14} />
                    {t('agent.connectionReady')}
                  </span>
                )}
              </div>
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
              if (open) setError(null)
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
                    {agentErrorText(error.code)}
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
        {error && !['save', 'test', 'install'].includes(error.operation) && !confirmClear && (
          <div className="agent-error" role="alert" ref={errorElement}>
            {agentErrorText(error.code)}
          </div>
        )}
      </div>
    </form>
  )
}
