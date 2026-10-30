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
    message.change ? [{ change: message.change, at: message.createdAt }] : [],
  )
  const pending = changes.filter(({ change }) => !change.undone)
  const caption = (change: AgentChange) =>
    change.kind === 'move'
      ? t('agent.movedPath', { from: change.source, to: change.path })
      : t(`agent.changeStatus.${change.kind}`)
  if (!changes.length) return null
  return (
    <section className="agent-changes" aria-label={t('agent.changes')}>
      <div className="agent-card-heading">
        <strong>{t('agent.changeCount', { count: changes.length })}</strong>
        <time>
          {new Date(changes.at(-1)!.at).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </time>
      </div>
      {changes.map(({ change }) => (
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
            {change.kind === 'trash' || change.kind === 'create-folder' || change.undone ? (
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
            <span>{change.undone ? t('agent.undone') : caption(change)}</span>
          </div>
          <button
            className="agent-quiet"
            disabled={disabled || change.undone}
            onClick={() => onUndo([change.id])}
          >
            {t(
              change.undone
                ? 'agent.undone'
                : change.kind === 'trash'
                  ? 'agent.restore'
                  : 'agent.undo',
            )}
          </button>
        </div>
      ))}
      {pending.length > 1 && (
        <div className="agent-card-actions">
          <Button
            className="agent-secondary"
            disabled={disabled}
            onClick={() => onUndo(pending.map(({ change }) => change.id))}
          >
            {t('agent.undoAll')}
          </Button>
        </div>
      )}
    </section>
  )
}
