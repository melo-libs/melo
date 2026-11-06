import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentProvider, AgentSetup } from '@shared/types/agent'
import { agentCommand, type AgentAccountState } from '../../store/agent'
import { Button } from '../ui/Button'
import { Icon } from '../Icon'
import { MeloLogo } from '../MeloLogo'
import {
  AgentRuntimeProgress,
  AgentRuntimeStatus,
  runtimeWorking,
  runtimeMegabytes,
} from './AgentRuntimeProgress'
import { agentErrorText } from './agentError'

export function AgentWelcome({
  setup,
  checking = false,
  accounts,
  busy,
  onProvider,
  onLogin,
  onCheck,
  onSettings,
}: {
  setup: AgentSetup | null
  checking?: boolean
  accounts: Record<AgentProvider, AgentAccountState>
  busy: boolean
  onProvider(provider: AgentProvider): Promise<boolean>
  onLogin(provider: AgentProvider): Promise<void>
  onCheck(provider: AgentProvider): Promise<void>
  onSettings(): void
}) {
  const { t } = useTranslation()
  const [slowCheck, setSlowCheck] = useState(false)
  useEffect(() => {
    setSlowCheck(false)
    if (!checking) return
    const timer = setTimeout(() => setSlowCheck(true), 1000)
    return () => clearTimeout(timer)
  }, [checking])
  const [pending, setPending] = useState<AgentProvider | null>(null)
  const [loggingIn, setLoggingIn] = useState<AgentProvider | null>(null)
  const [error, setError] = useState('')
  const working = useRef(false)
  const visible = useRef(true)
  useEffect(() => {
    visible.current = true
    return () => {
      visible.current = false
    }
  }, [])
  const connect = async (provider: AgentProvider) => {
    if (working.current || !setup) return
    working.current = true
    setPending(provider)
    setError('')
    try {
      let account = accounts[provider]
      const available = setup.components
        ? setup.components[provider].status === 'ready'
        : setup.runtimeAvailable
      if (!available) {
        const installed = await agentCommand({ action: 'install', provider })
        if (!visible.current || installed.setup?.components?.[provider].status !== 'ready') return
        if (setup.connectionProfiles?.[provider]?.access !== 'api') {
          const result = await agentCommand({ action: 'check-sign-in', provider })
          account = result.authentication!
          if (!visible.current) return
          await onCheck(provider)
        }
      }
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
        await agentCommand({ action: 'set-access', provider, access: 'native' })
      }
      if (visible.current && account.status !== 'signed-in') {
        await onLogin(provider)
        setLoggingIn(provider)
      }
    } catch (error) {
      const code = error instanceof Error ? error.message : ''
      if (!code.startsWith('AGENT_DOWNLOAD_') && code !== 'AGENT_RUNTIME_INSTALL_FAILED')
        setError(agentErrorText(code))
    } finally {
      working.current = false
      setPending(null)
    }
  }
  if (checking)
    return (
      <section className="agent-welcome" role="status" aria-label={t('agent.preparingConnection')}>
        <span className="agent-welcome-logo" aria-hidden="true">
          <MeloLogo size={44} />
        </span>
        <p
          className="agent-welcome-description"
          aria-hidden={!slowCheck}
          style={{ visibility: slowCheck ? 'visible' : 'hidden' }}
        >
          {t('agent.preparingConnection')}
        </p>
      </section>
    )
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
          const component = setup?.components?.[provider]
          const downloading = runtimeWorking(component)
          const available = component ? component.status === 'ready' : setup?.runtimeAvailable
          const connected = apiReady || account.status === 'signed-in'
          const showProgress =
            component && ['downloading', 'preparing', 'error', 'paused'].includes(component.status)
          const status = showProgress
            ? 'checking'
            : !setup
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
                  {showProgress ? (
                    <AgentRuntimeStatus component={component} />
                  ) : (
                    t(
                      !setup
                        ? 'agent.accountChecking'
                        : !available
                          ? component?.source === 'local'
                            ? 'agent.componentLocal'
                            : 'agent.componentRequired'
                          : apiReady
                            ? 'agent.apiConfigured'
                            : connected
                              ? 'agent.accountSignedIn'
                              : checking
                                ? 'agent.accountChecking'
                                : account.status === 'error'
                                  ? 'agent.accountCheckFailed'
                                  : component?.source === 'local'
                                    ? 'agent.componentLocal'
                                    : 'agent.accountSignedOut',
                      { size: runtimeMegabytes(component?.total ?? 0) },
                    )
                  )}
                </span>
              </div>
              <Button
                size="small"
                variant={connected || provider === 'claude' ? 'primary' : 'secondary'}
                disabled={
                  !downloading &&
                  (busy ||
                    pending !== null ||
                    !!setup?.installing ||
                    !setup ||
                    (!!available && checking && !apiReady))
                }
                onClick={() =>
                  downloading
                    ? void agentCommand({ action: 'cancel-install', provider }).catch((error) =>
                        setError(agentErrorText(error.message)),
                      )
                    : void connect(provider)
                }
              >
                {t(
                  downloading
                    ? 'common.cancel'
                    : pending === provider
                      ? 'agent.welcomeConnecting'
                      : !setup || (available && checking && !apiReady)
                        ? 'agent.accountChecking'
                        : !available
                          ? component?.status === 'error' || component?.status === 'paused'
                            ? 'agent.componentRetry'
                            : 'agent.componentConnect'
                          : !apiReady && (account.status === 'error' || loggingIn === provider)
                            ? 'agent.checkSignIn'
                            : connected
                              ? 'agent.welcomeUseConnection'
                              : 'agent.welcomeSignIn',
                )}
              </Button>
              {component &&
                ['downloading', 'preparing', 'error', 'paused'].includes(component.status) && (
                  <AgentRuntimeProgress component={component} showLabel={false} />
                )}
            </div>
          )
        })}
      </div>
      {setup?.installing && <p className="agent-welcome-help">{t('agent.componentBackground')}</p>}
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
