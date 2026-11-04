import { useTranslation } from 'react-i18next'
import type { AgentAttachment } from '@shared/types/agent'
import { Button } from '../ui/Button'
import { Icon } from '../Icon'
import { formatSize } from '../../lib/format'
import { kindOfPath } from '@shared/fileKinds'
import { AgentAttachmentVisual } from './AgentAttachmentVisual'

export function AgentAttachments({
  files,
  disabled,
  onRemove,
  onOpen,
  workspaceRoot,
}: {
  files: AgentAttachment[]
  disabled?: boolean
  onRemove?(id: string): void
  onOpen?(id: string): void
  workspaceRoot?: string
}) {
  const { t } = useTranslation()
  if (!files.length) return null
  return (
    <div
      className="agent-attachments"
      data-sent={!!onOpen || undefined}
      aria-label={t('agent.attachments')}
    >
      {files.map((file) => {
        const label = (
          <>
            <AgentAttachmentVisual file={file} workspaceRoot={workspaceRoot} />
            {kindOfPath(file.name) !== 'image' && !onOpen && (
              <span className="agent-attachment-meta">
                <strong>{file.name.replace(/\.[^.]+$/, '')}</strong>
                <small>
                  {file.name.split('.').pop()?.toUpperCase()} · {formatSize(file.size)}
                </small>
              </span>
            )}
          </>
        )
        return (
          <div key={file.id} className="agent-attachment" title={file.path ?? file.name}>
            {onOpen ? (
              <Button size="small" aria-label={file.name} onClick={() => onOpen(file.id)}>
                {label}
              </Button>
            ) : (
              <span className="agent-attachment-label">{label}</span>
            )}
            {onRemove && (
              <Button
                size="small"
                disabled={disabled}
                aria-label={t('agent.removeAttachment', { name: file.name })}
                onClick={() => onRemove(file.id)}
              >
                <Icon name="x" size={14} />
              </Button>
            )}
          </div>
        )
      })}
    </div>
  )
}
