import { useTranslation } from 'react-i18next'
import { stripMarkdownExtension } from '@shared/fileKinds'
import { Icon } from '../Icon'

export function AgentSource({ path, at, onOpen }: { path: string; at: number; onOpen(): void }) {
  const { i18n } = useTranslation()
  return (
    <div className="agent-source-divider">
      <button onClick={onOpen} title={path}>
        <Icon name="file" size={14} />
        <strong>{stripMarkdownExtension(path.split('/').pop()!)}</strong>
        <time dateTime={new Date(at).toISOString()}>
          {new Intl.DateTimeFormat(i18n.language, {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          }).format(at)}
        </time>
      </button>
    </div>
  )
}
