import { useTranslation } from 'react-i18next'
import type { AgentContext } from '@shared/types/agent'
import { Icon } from '../Icon'

export function AgentQuote({
  context,
  onOpenFile,
  onRemove,
}: {
  context: AgentContext
  onOpenFile?(path: string): void
  onRemove?(): void
}) {
  const { t } = useTranslation()
  return (
    <div className="agent-quote">
      {onRemove && (
        <button
          className="agent-quiet agent-quote-remove"
          aria-label={t('agent.removeContext')}
          onClick={onRemove}
        >
          <Icon name="x" size={14} />
        </button>
      )}
      {context.selection && (
        <blockquote className="agent-selection">{context.selection}</blockquote>
      )}
      {context.filePath && (
        <button
          className="agent-quote-source"
          title={context.filePath}
          disabled={!onOpenFile}
          onClick={() => onOpenFile?.(context.filePath!)}
        >
          <span aria-hidden="true">{context.selection ? '—' : <Icon name="file" size={14} />}</span>
          <span>{context.filePath.split('/').pop()}</span>
        </button>
      )}
    </div>
  )
}
