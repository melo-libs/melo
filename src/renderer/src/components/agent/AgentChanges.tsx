import { useTranslation } from 'react-i18next'
import type { AgentChange, AgentMessage, AgentPlanEntry } from '@shared/types/agent'
import { Button } from '../ui/Button'
import { Icon } from '../Icon'

export function AgentPlan({ entries, active }: { entries: AgentPlanEntry[]; active: boolean }) {
  return (
    <ol className="agent-plan" data-active={active || undefined}>
      {entries.map((entry, index) => (
        <li key={index} data-status={entry.status}>
          <span className="agent-plan-marker">
            {entry.status === 'completed' && <Icon name="tick" size={12} />}
          </span>
          <span>{entry.content}</span>
        </li>
      ))}
    </ol>
  )
}

export function AgentChanges({
  messages,
  disabled,
  onUndo,
  onOpenFile,
}: {
  messages: AgentMessage[]
  disabled: boolean
  onUndo(ids: string[]): void
  onOpenFile(path: string): void
}) {
  const { t } = useTranslation()
  const changes = messages.flatMap((message) =>
    message.change && message.change.kind !== 'import' ? [message.change] : [],
  )
  const pending = changes.filter((change) => !change.undone)
  const single = changes.length === 1
  const trashed = changes.every((change) => change.kind === 'trash')
  const caption = (change: AgentChange) =>
    change.kind === 'move'
      ? t('agent.movedPath', { from: change.source, to: change.path })
      : t(`agent.changeStatus.${change.kind}`)
  const rows = changes.map((change) => (
    <div className="agent-change-row" key={change.id} data-undone={change.undone || undefined}>
      <span
        className={`agent-change-icon${change.kind === 'create-folder' ? ' agent-folder-icon' : ''}`}
      >
        <Icon
          name={
            change.kind === 'create-folder'
              ? 'folder'
              : change.kind === 'trash'
                ? 'trash'
                : change.path.toLowerCase().endsWith('.md')
                  ? 'fileMd'
                  : 'file'
          }
          size={18}
        />
      </span>
      <div className="agent-change-description">
        {change.kind === 'trash' ||
        change.kind === 'create-folder' ||
        change.kind === 'smart-folder' ||
        change.undone ? (
          <span className="agent-change-name" title={change.path}>
            {change.path.split('/').pop()}
          </span>
        ) : (
          <button
            className="agent-change-name"
            onClick={() => onOpenFile(change.path)}
            title={change.path}
          >
            {change.path.split('/').pop()}
          </button>
        )}
        <span>
          {change.undone
            ? t(change.kind === 'trash' ? 'agent.restored' : 'agent.undone')
            : caption(change)}
        </span>
      </div>
      {pending.length > 1 && !change.undone && (
        <button className="agent-quiet" disabled={disabled} onClick={() => onUndo([change.id])}>
          {t(change.kind === 'trash' ? 'agent.restore' : 'agent.undo')}
        </button>
      )}
    </div>
  ))
  if (!changes.length) return null
  return (
    <div className="agent-changes" aria-label={t('agent.changes')}>
      <details className="agent-change-details">
        <summary>
          <Icon name={pending.length ? 'tick' : 'history'} size={14} />
          <span role="status">
            {t(
              !pending.length
                ? trashed
                  ? 'agent.restored'
                  : 'agent.undone'
                : trashed
                  ? 'agent.trashedCount'
                  : single
                    ? `agent.changeStatus.${changes[0].kind}`
                    : 'agent.changeCount',
              { count: trashed && pending.length ? pending.length : changes.length },
            )}
          </span>
          <Icon name="chev" size={12} />
        </summary>
        <div className="agent-change-files">{rows}</div>
      </details>
      {!!pending.length && (
        <Button
          className="agent-change-undo"
          size="small"
          disabled={disabled}
          onClick={() => onUndo(pending.map((change) => change.id))}
        >
          {t(
            trashed
              ? pending.length === 1
                ? 'agent.restore'
                : 'agent.restoreAll'
              : pending.length === 1
                ? 'agent.undo'
                : 'agent.undoAll',
          )}
        </Button>
      )}
    </div>
  )
}
