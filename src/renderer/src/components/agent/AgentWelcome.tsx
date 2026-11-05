import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentProvider, AgentSetup } from '@shared/types/agent'
import { agentCommand, type AgentAccountState } from '../../store/agent'
import { Button } from '../ui/Button'
import { Icon } from '../Icon'
import { MeloLogo } from '../MeloLogo'
import { agentErrorText } from './agentError'

export function AgentWelcome({
  setup,
  accounts,
  busy,
  onProvider,
  onLogin,
  onCheck,
  onSettings,
}: {
  setup: AgentSetup | null
  accounts: Record<AgentProvider, AgentAccountState>
  busy: boolean
  onProvider(provider: AgentProvider): Promise<boolean>
  onLogin(provider: AgentProvider): Promise<void>
  onCheck(provider: AgentProvider): Promise<void>
  onSettings(): void
}) {
  const { t } = useTranslation()
  const [pending, setPending] = useState<AgentProvider | null>(null)
  const [loggingIn, setLoggingIn] = useState<AgentProvider | null>(null)
  const [error, setError] = useState('')
  const working = useRef(false)
  const connect = async (provider: AgentProvider) => {
    if (working.current || !setup) return
    working.current = true
    setPending(provider)
    setError('')
    try {
      if (!setup.runtimeAvailable) {
        await agentCommand({ action: 'install' })
        await Promise.all([onCheck('claude'), onCheck('codex')])
        return
      }
      const account = accounts[provider]
      const profile = setup.connectionProfiles?.[provider]
      if (profile?.access === 'api' && profile.apiConfigured) {
        await onProvider(provider)
        return
      }
      if (account.status === 'error' || loggingIn === provider) {
        await onCheck(provider)
        setLoggingIn(null)
        return
      }
      if (!(await onProvider(provider))) return
      if (profile?.access === 'api') {
        const response = await agentCommand({ action: 'setup', provider })
        const configuration = response.setup!.configuration
        await agentCommand({
          action: 'configure',
          provider,
          access: 'native',
          baseUrl: configuration.baseUrl,
          model: configuration.model,
          apiService: configuration.apiService,
        })
      }
      if (account.status !== 'signed-in') {
        await onLogin(provider)
        setLoggingIn(provider)
      }
    } catch (error) {
      setError(agentErrorText(error instanceof Error ? error.message : ''))
    } finally {
      working.current = false
      setPending(null)
    }
  }
  return (
    <section className="agent-welcome" aria-labelledby="agent-welcome-title">
      <span className="agent-welcome-logo">
        <MeloLogo size={44} />
      </span>
      <h2 id="agent-welcome-title">{t('agent.welcomeConnectTitle')}</h2>
      <p className="agent-welcome-description">{t('agent.welcomeConnectDescription')}</p>
      <div className="agent-connect-options">
        {(['claude', 'codex'] as const).map((provider) => {
          const account = accounts[provider]
          const profile = setup?.connectionProfiles?.[provider]
          const apiReady = profile?.access === 'api' && profile.apiConfigured
          const checking = !setup || account.status === 'checking' || account.status === 'unknown'
          const available = setup?.runtimeAvailable
          const connected = apiReady || account.status === 'signed-in'
          const status = !setup
            ? 'checking'
            : !available
              ? 'unavailable'
              : apiReady
                ? 'api-configured'
                : account.status
          return (
            <div className="agent-connect-option" key={provider}>
              <span className="agent-tool-icon">
                <Icon name={provider === 'claude' ? 'terminal' : 'cube'} size={20} />
              </span>
              <div className="agent-tool-info">
                <strong>{provider === 'claude' ? 'Claude Code' : 'Codex'}</strong>
                <span className="agent-tool-status" data-state={status} role="status">
                  <span />
                  {t(
                    !setup
                      ? 'agent.accountChecking'
                      : !available
                        ? 'agent.welcomeRuntimeRequired'
                        : apiReady
                          ? 'agent.apiConfigured'
                          : connected
                            ? 'agent.accountSignedIn'
                            : checking
                              ? 'agent.accountChecking'
                              : account.status === 'error'
                                ? 'agent.accountCheckFailed'
                                : 'agent.accountSignedOut',
                  )}
                </span>
              </div>
              <Button
                size="small"
                variant={connected || provider === 'claude' ? 'primary' : 'secondary'}
                disabled={
                  busy || pending !== null || !setup || (!!available && checking && !apiReady)
                }
                onClick={() => void connect(provider)}
              >
                {t(
                  pending === provider
                    ? 'agent.welcomeConnecting'
                    : !setup || (available && checking && !apiReady)
                      ? 'agent.accountChecking'
                      : !available
                        ? 'agent.install'
                        : !apiReady && (account.status === 'error' || loggingIn === provider)
                          ? 'agent.checkSignIn'
                          : connected
                            ? 'agent.welcomeUseConnection'
                            : 'agent.welcomeSignIn',
                )}
              </Button>
            </div>
          )
        })}
      </div>
      {loggingIn && (
        <p className="agent-welcome-help" role="status">
          {t('agent.welcomeLoginHelp')}
        </p>
      )}
      {error && (
        <p className="agent-welcome-error" role="alert">
          {error}
        </p>
      )}
      <button
        className="agent-quiet agent-welcome-api"
        onClick={onSettings}
        disabled={!setup || busy || pending !== null}
      >
        {t('agent.welcomeApi')}
      </button>
    </section>
  )
}
