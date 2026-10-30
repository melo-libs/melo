import { useTranslation } from 'react-i18next'
import type { AgentProvider } from '@shared/types/agent'
import type { AgentAccountState } from '../../store/agent'
import { Button } from '../ui/Button'
import { Icon } from '../Icon'

export function AgentAccount({
  provider,
  account,
  usingApi = false,
  onUse,
  runtimeAvailable,
  busy,
  onLogin,
  onCheck,
}: {
  provider: AgentProvider
  account: AgentAccountState
  usingApi?: boolean
  onUse?(): void
  runtimeAvailable: boolean
  busy: boolean
  onLogin(): void
  onCheck(): void
}) {
  const { t } = useTranslation()
  const status = runtimeAvailable
    ? account.status === 'unknown'
      ? 'checking'
      : account.status
    : 'unavailable'
  const label =
    status === 'signed-in'
      ? 'agent.accountSignedIn'
      : status === 'signed-out'
        ? usingApi
          ? 'agent.accountNotSignedInWithApi'
          : 'agent.accountNotSignedIn'
        : status === 'checking'
          ? 'agent.checkingSignIn'
          : status === 'unavailable'
            ? 'agent.errors.AGENT_RUNTIME_REQUIRED'
            : 'agent.signInCheckUnknown'
  return (
    <div className="agent-auth" data-state={status}>
      <div className="agent-auth-row">
        <div className="agent-auth-status" role="status" aria-live="polite">
          {status === 'signed-in' ? (
            <span className="agent-auth-check">
              <Icon name="tick" size={12} />
            </span>
          ) : status !== 'signed-out' ? (
            <span className="agent-auth-indicator" aria-hidden="true" />
          ) : null}
          <span>{t(label, { provider: provider === 'claude' ? 'Claude Code' : 'Codex' })}</span>
          {account.status === 'signed-in' && (
            <span className="agent-auth-identity">
              {account.email ||
                (account.method === 'chatgpt'
                  ? t('agent.chatgptAccount')
                  : account.method === 'api-key'
                    ? 'API Key'
                    : '')}
            </span>
          )}
        </div>
        {status !== 'signed-out' && (
          <button
            type="button"
            className="agent-quiet"
            disabled={busy || status === 'checking' || !runtimeAvailable}
            onClick={onCheck}
          >
            {t('agent.checkSignIn')}
          </button>
        )}
      </div>
      {account.status === 'error' && runtimeAvailable && (
        <p className="agent-auth-error" role="alert">
          {account.message}
        </p>
      )}
      {status === 'signed-out' && (
        <div className="agent-auth-actions">
          <Button variant="primary" disabled={busy} onClick={onLogin}>
            {t('agent.signInProvider', { provider: provider === 'claude' ? 'Claude' : 'ChatGPT' })}
          </Button>
          <button type="button" className="agent-quiet" disabled={busy} onClick={onCheck}>
            {t('agent.signedInElsewhere')}
          </button>
        </div>
      )}
      {status === 'signed-in' && onUse && (
        <div className="agent-auth-actions">
          <Button variant="primary" disabled={busy} onClick={onUse}>
            {t('agent.useAccount')}
          </Button>
        </div>
      )}
    </div>
  )
}
