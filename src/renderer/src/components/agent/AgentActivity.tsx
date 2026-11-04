import { agentTool } from '@shared/agentCapabilities'
import type { AgentMessage } from '@shared/types/agent'
import { useTranslation } from 'react-i18next'
import { Icon } from '../Icon'
import { NativePermissionDetail } from './AgentPermission'

export function AgentActivity({ messages, active }: { messages: AgentMessage[]; active: boolean }) {
  const { t } = useTranslation()
  const label = (message: AgentMessage) =>
    agentTool(message.content) || message.content === 'network_fallback'
      ? t(`agent.tools.${message.content}`)
      : t(`agent.activityKinds.${message.toolActivity?.kind ?? 'other'}`)
  return (
    <details className="agent-activity">
      <summary>
        <Icon name="chev" size={14} />
        <span>{t('agent.activityDetails')}</span>
      </summary>
      {messages.map((message) => {
        const approval = message.approval
        return (
          <details className="agent-tool" key={message.id} data-status={message.toolStatus}>
            <summary>
              <Icon name="chev" size={12} />
              <span className="agent-tool-label">
                {approval
                  ? t(
                      `agent.nativeApproval.${approval.status === 'pending' ? 'expired' : approval.status}`,
                    )
                  : label(message)}
                {message.toolActivity?.target && (
                  <span title={message.toolActivity.target}>
                    {message.toolActivity.target.split(/[\\/]/).pop()}
                  </span>
                )}
              </span>
              {!approval && (
                <span className="agent-tool-result">
                  {t(
                    message.toolStatus === 'pending'
                      ? active
                        ? 'agent.activityInProgress'
                        : 'agent.activityEnded'
                      : message.toolStatus === 'failed'
                        ? 'agent.activityAttemptFailed'
                        : 'agent.activityComplete',
                  )}
                </span>
              )}
            </summary>
            {approval?.operation.kind === 'native' ? (
              <NativePermissionDetail
                detail={approval.operation.detail}
                access={approval.operation.access}
                expanded
              />
            ) : (
              <pre>{message.content}</pre>
            )}
          </details>
        )
      })}
    </details>
  )
}
