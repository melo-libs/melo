import { AGENT_OPERATIONS, operationLocation } from '@shared/agentCapabilities'
import { useTranslation } from 'react-i18next'
import type { AgentApproval as Permission } from '@shared/types/agent'
import { Icon } from '../Icon'
import { Button } from '../ui/Button'
import { AgentDiffPreview } from './AgentDiffPreview'

export function AgentPermission({
  permission,
  busy,
  active,
  onRespond,
  workspaceName,
}: {
  permission: Permission
  busy: boolean
  active: boolean
  workspaceName: string
  onRespond(allow: boolean, conversation?: boolean): void
}) {
  const { t } = useTranslation()
  const { operation } = permission
  const metadata = AGENT_OPERATIONS[operation.kind]
  const location = operationLocation(operation)
  const folder = operation.kind === 'create-folder'
  const edit = operation.kind === 'edit'
  const name = location.split('/').pop()
  const parent = location.includes('/')
    ? location.slice(0, location.lastIndexOf('/'))
    : workspaceName
  const title = operation.kind === 'native' ? operation.title : t(`agent.actions.${metadata.label}`)
  const diff = operation.kind === 'edit' ? operation.diff : undefined
  const preview =
    operation.kind === 'create-note' || operation.kind === 'memory' ? operation.content : ''
  const target =
    operation.kind === 'move'
      ? t('agent.movedPath', { from: operation.source, to: operation.destination })
      : location
  const pending = active && permission.status === 'pending'
  const status = permission.status === 'pending' && !active ? 'expired' : permission.status
  const content = (
    <>
      {edit ? (
        <div className="agent-edit-heading">
          <span className="agent-edit-file-icon">
            <Icon name="fileMd" size={18} />
          </span>
          <div>
            <strong>{name}</strong>
            <span>{parent}</span>
          </div>
          <span className="agent-edit-heading-label">{t('agent.editDiff')}</span>
        </div>
      ) : (
        <div className="agent-card-heading">
          <strong>{title}</strong>
          {folder && <span title={parent}>{t('agent.inFolder', { folder: parent })}</span>}
        </div>
      )}
      {folder ? (
        <div className="agent-permission-items">
          <span className="agent-folder-chip" title={location}>
            <Icon name="folderFilled" size={20} />
            <span>{name}</span>
          </span>
        </div>
      ) : (
        !edit && (
          <div className="agent-change-preview">
            <span className="agent-change-icon">
              <Icon name={operation.kind === 'trash' ? 'trash' : 'file'} size={18} />
            </span>
            <span>{target}</span>
          </div>
        )
      )}
      {diff ? <AgentDiffPreview source={diff} /> : preview.trim() && <pre>{preview}</pre>}
      {pending ? (
        <div className="agent-card-actions">
          <Button className="agent-primary" disabled={busy} onClick={() => onRespond(true)}>
            {metadata.approve ? t(`agent.approve.${metadata.approve}`) : t('agent.allow')}
          </Button>
          <Button className="agent-secondary" disabled={busy} onClick={() => onRespond(false)}>
            {t('agent.decline')}
          </Button>
          {metadata.allowRun && (
            <button
              className="agent-quiet agent-allow-conversation"
              disabled={busy}
              onClick={() => onRespond(true, true)}
            >
              {t('agent.allowConversation')}
            </button>
          )}
        </div>
      ) : (
        <p className="agent-approval-status" role="status">
          {t(`agent.approvalStatus.${status}`)}
        </p>
      )}
    </>
  )
  if (pending)
    return (
      <section
        className="agent-permission"
        data-pending
        data-permission-id={permission.id}
        aria-label={t('agent.reviewChange')}
      >
        {content}
      </section>
    )
  return (
    <details className="agent-permission agent-approval-record" open={status === 'expired'}>
      <summary>
        {title} · {t(`agent.approvalLabel.${status}`)}
      </summary>
      {content}
    </details>
  )
}
