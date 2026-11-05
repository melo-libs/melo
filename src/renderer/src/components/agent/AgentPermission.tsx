import {
  AGENT_OPERATIONS,
  operationLocation,
  type AgentNativeAccess,
} from '@shared/agentCapabilities'
import { useTranslation } from 'react-i18next'
import type { AgentApproval as Permission } from '@shared/types/agent'
import { Icon } from '../Icon'
import { Button } from '../ui/Button'
import { AgentDiffPreview } from './AgentDiffPreview'

export function NativePermissionDetail({
  detail,
  expanded = false,
  access,
}: {
  detail: string
  expanded?: boolean
  access?: AgentNativeAccess
}) {
  const { t } = useTranslation()
  if (access)
    return (
      <>
        <p className="agent-native-purpose">
          {t(
            access.scope === 'operation'
              ? 'agent.resourceAccess.operationScope'
              : 'agent.resourceAccess.scope',
          )}
        </p>
        {access.read.length > 0 && (
          <>
            <p>{t('agent.resourceAccess.read')}</p>
            <pre>{access.read.join('\n')}</pre>
          </>
        )}
        {access.write.length > 0 && (
          <>
            <p>{t('agent.resourceAccess.write')}</p>
            <pre>{access.write.join('\n')}</pre>
          </>
        )}
        {access.network && <p>{t('agent.resourceAccess.network')}</p>}
        <details className="agent-native-parameters" open={expanded}>
          <summary>{t('agent.operationDetails')}</summary>
          <pre>{detail}</pre>
        </details>
      </>
    )
  let input: unknown
  try {
    input = JSON.parse(detail)
  } catch {
    // Older or non-shell requests can contain an opaque adapter description.
    return <pre>{detail}</pre>
  }
  if (
    !input ||
    typeof input !== 'object' ||
    !('command' in input) ||
    typeof input.command !== 'string'
  )
    return <pre>{detail}</pre>
  const { command, ...parameters } = input
  const description =
    'description' in parameters && typeof parameters.description === 'string'
      ? parameters.description.trim() || undefined
      : undefined
  return (
    <>
      {description && <p className="agent-native-purpose">{description}</p>}
      <details className="agent-native-parameters" open={expanded || !description}>
        <summary>{t('agent.operationDetails')}</summary>
        <pre>{command}</pre>
        {Object.keys(parameters).length > 0 && <pre>{JSON.stringify(parameters, null, 2)}</pre>}
      </details>
    </>
  )
}

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
  const smartLabel = (value: string) => t(`smartVals.${value}`, { defaultValue: value })
  const { operation } = permission
  const metadata = AGENT_OPERATIONS[operation.kind]
  const location = operationLocation(operation)
  const folder = operation.kind === 'create-folder'
  const edit = operation.kind === 'edit'
  const native = operation.kind === 'native'
  const name = location.split('/').pop()
  const parent = location.includes('/')
    ? location.slice(0, location.lastIndexOf('/'))
    : workspaceName
  const title = operation.kind === 'native' ? operation.title : t(`agent.actions.${metadata.label}`)
  const diff = operation.kind === 'edit' ? operation.diff : undefined
  const preview =
    operation.kind === 'tags'
      ? `${t('agent.tagsBefore')}: ${operation.before.map((tag) => '#' + tag).join(', ') || '—'}\n${t('agent.tagsAfter')}: ${operation.after.map((tag) => '#' + tag).join(', ') || '—'}`
      : operation.kind === 'smart-folder'
        ? operation.view.rules
            .map((rule) => `${smartLabel(rule.key)} ${smartLabel(rule.op)} ${smartLabel(rule.val)}`)
            .join('\n') || t('smart.allContent')
        : operation.kind === 'create-note' || operation.kind === 'memory'
          ? operation.content
          : ''
  const target =
    operation.kind === 'move'
      ? t('agent.movedPath', { from: operation.source, to: operation.destination })
      : location
  const pending = operation.kind !== 'organize' && active && permission.status === 'pending'
  const status = permission.status === 'pending' && !pending ? 'expired' : permission.status
  const content =
    operation.kind === 'organize' ? (
      <>
        {operation.files.map((file) => (
          <p key={file.id}>
            {file.name}
            <br />
            {file.source} → {file.destination ?? file.source}
            {file.detail && (
              <>
                <br />
                {file.detail}
              </>
            )}
            {file.facts?.map((fact) => (
              <span key={fact.label}>
                <br />
                {fact.label}: {fact.value}
              </span>
            ))}
          </p>
        ))}
        {!pending && (
          <p className="agent-approval-status" role="status">
            {t(`agent.approvalStatus.${status}`)}
          </p>
        )}
      </>
    ) : (
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
            <strong>{native ? t('agent.nativeAccessTitle') : title}</strong>
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
          !edit &&
          !native && (
            <div className="agent-change-preview">
              <span className="agent-change-icon">
                <Icon name={operation.kind === 'trash' ? 'trash' : 'file'} size={18} />
              </span>
              <span>{target}</span>
            </div>
          )
        )}
        {native ? (
          <NativePermissionDetail detail={operation.detail} access={operation.access} />
        ) : diff ? (
          <AgentDiffPreview source={diff} />
        ) : (
          preview.trim() && <pre>{preview}</pre>
        )}
        {pending ? (
          <div className="agent-card-actions">
            <Button className="agent-primary" disabled={busy} onClick={() => onRespond(true)}>
              {metadata.approve
                ? t(`agent.approve.${metadata.approve}`)
                : t(
                    native && operation.access?.scope === 'task'
                      ? 'agent.resourceAccess.allow'
                      : 'agent.allow',
                  )}
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
            {t(native ? `agent.nativeApproval.${status}` : `agent.approvalStatus.${status}`)}
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
    <details className="agent-permission agent-approval-record">
      <summary>
        {title} · {t(`agent.approvalLabel.${status}`)}
      </summary>
      {content}
    </details>
  )
}
