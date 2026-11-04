import { useTranslation } from 'react-i18next'
import type { AttachmentReceipt } from '@shared/agentAttachments'
import { Icon } from '../Icon'
import { Button } from '../ui/Button'

export function AgentReceipt({
  receipt,
  onOpen,
}: {
  receipt: AttachmentReceipt
  onOpen(id: string): void
}) {
  const { t } = useTranslation()
  const stored = receipt.files.filter((file) => file.status === 'stored').length
  const pending = receipt.files.some((file) => file.status === 'pending')
  const incomplete = receipt.files.length - stored
  return (
    <details className="agent-receipt">
      <summary>
        <Icon name={pending ? 'history' : 'folder'} size={14} />
        <span role="status">
          {t(pending ? 'agent.receipt.receiving' : 'agent.receipt.stored', {
            count: stored,
            total: receipt.files.length,
          })}
          {!pending &&
            incomplete > 0 &&
            ` · ${t('agent.receipt.incomplete', { count: incomplete })}`}
        </span>
      </summary>
      <ul>
        {receipt.files.map((file) => (
          <li key={file.id}>
            {file.status === 'stored' ? (
              <Button size="small" onClick={() => onOpen(file.id)} title={file.path}>
                {file.name}
              </Button>
            ) : (
              <span>{file.name}</span>
            )}
            <small>{t(`agent.receipt.status.${file.status}`)}</small>
          </li>
        ))}
      </ul>
    </details>
  )
}
