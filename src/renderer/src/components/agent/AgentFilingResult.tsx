import { useTranslation } from 'react-i18next'
import type { AgentFiling } from '@shared/types/agent'
import { Button } from '../ui/Button'
import { Icon } from '../Icon'

export function AgentFilingResult({
  filing,
  disabled,
  onUndo,
  onOpenFile,
}: {
  filing: AgentFiling
  disabled: boolean
  onUndo(): void
  onOpenFile(path: string): void
}) {
  const { t } = useTranslation()
  const pending = filing.changes.filter((change) => !change.undone)
  const unresolved = filing.unresolved.length > 0
  const undone = filing.changes.length > 0 && !pending.length && !unresolved
  const partial = !undone && pending.length < filing.changes.length
  const moved = filing.changes.filter((change) => change.kind === 'move').length
  const label =
    filing.state === 'applying'
      ? 'applying'
      : unresolved
        ? 'unresolved'
        : undone
          ? 'undone'
          : partial
            ? 'partiallyUndone'
            : filing.state === 'failed'
              ? 'failed'
              : 'completed'
  return (
    <div className="agent-filing-result" data-undone={undone || undefined}>
      <details className="agent-filing-details">
        <summary>
          <Icon
            name={
              undone ? 'history' : filing.state === 'completed' && !unresolved ? 'tick' : 'info'
            }
            size={14}
          />
          <span role="status">
            {t(`agent.organization.${label}`, {
              count: unresolved ? filing.unresolved.length : moved,
              total: filing.fileCount,
            })}
          </span>
          <Icon name="chev" size={12} />
        </summary>
        <div className="agent-filing-files">
          {filing.changes.map((change) => (
            <div
              className="agent-change-row"
              key={change.id}
              data-undone={change.undone || undefined}
            >
              <Icon name={change.kind === 'create-folder' ? 'folder' : 'file'} size={18} />
              <div className="agent-change-description">
                {change.undone || change.kind === 'create-folder' ? (
                  <span className="agent-change-name" title={change.path}>
                    {change.path.split('/').pop()}
                  </span>
                ) : (
                  <Button
                    size="small"
                    className="agent-change-name"
                    title={change.path}
                    onClick={() => onOpenFile(change.path)}
                  >
                    {change.path.split('/').pop()}
                  </Button>
                )}
                <span title={change.source ? `${change.source} → ${change.path}` : change.path}>
                  {change.undone
                    ? t('agent.undone')
                    : change.kind === 'move'
                      ? t('agent.movedPath', { from: change.source, to: change.path })
                      : t(`agent.changeStatus.${change.kind}`)}
                </span>
              </div>
            </div>
          ))}
          {unresolved && (
            <div className="agent-filing-unresolved">
              <p>{t('agent.organization.unresolvedHelp')}</p>
              {filing.unresolved.map((change) => (
                <div className="agent-change-row" key={change.id}>
                  <Icon name="info" size={18} />
                  <div className="agent-change-description">
                    <span className="agent-change-name">{change.path.split('/').pop()}</span>
                    <span>{change.source ? `${change.source} → ${change.path}` : change.path}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </details>
      {!!pending.length && (
        <Button
          className="agent-filing-undo"
          size="small"
          disabled={disabled || filing.state === 'applying'}
          aria-label={t(
            unresolved ? 'agent.organization.undoConfirmed' : 'agent.organization.undoAll',
          )}
          onClick={onUndo}
        >
          {t(unresolved ? 'agent.organization.undoConfirmed' : 'agent.undo')}
        </Button>
      )}
    </div>
  )
}
