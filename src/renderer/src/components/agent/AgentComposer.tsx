import { useLayoutEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  AgentContext,
  AgentModelControl,
  AgentProvider,
  AgentSetup,
} from '@shared/types/agent'
import { Icon } from '../Icon'
import { Button } from '../ui/Button'
import { AgentModelMenu } from './AgentModelMenu'
import { Select } from '../ui/Select'
import type { AgentModelLoadState } from '../../store/agent'

export function AgentComposer({
  draft,
  context,
  setup,
  provider,
  running,
  interrupting,
  busy,
  loading,
  modelLoad,
  canSend,
  focusKey,
  onDraft,
  onSend,
  onStop,
  onProvider,
  onSettings,
  onLoadModels,
  onModelChange,
  onRemoveContext,
  onOpenFile,
}: {
  draft: string
  context: AgentContext
  setup: AgentSetup | null
  provider: AgentProvider
  running: boolean
  interrupting: boolean
  busy: boolean
  loading: boolean
  modelLoad: AgentModelLoadState
  canSend: boolean
  focusKey: unknown
  onDraft(value: string): void
  onSend(): void
  onStop(): void
  onProvider(provider: AgentProvider): void
  onLoadModels(): void
  onModelChange(category: AgentModelControl['category'], value: string): void
  onSettings(): void
  onRemoveContext(): void
  onOpenFile(path: string): void
}) {
  const { t } = useTranslation()
  const input = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    input.current?.focus()
  }, [focusKey])
  useLayoutEffect(() => {
    const el = input.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(132, Math.max(38, el.scrollHeight))}px`
  }, [draft])
  return (
    <div className="agent-compose">
      {(context.selection || context.filePath) && (
        <div className="agent-context-strip">
          <Icon name="arrowRight" size={14} />
          <button
            className="agent-context-text"
            onClick={() => context.filePath && onOpenFile(context.filePath)}
            title={context.selection || context.filePath}
          >
            {context.selection || context.filePath?.split('/').pop()}
          </button>
          <button
            className="agent-quiet"
            aria-label={t('agent.removeContext')}
            onClick={onRemoveContext}
          >
            <Icon name="x" size={12} />
          </button>
        </div>
      )}
      <textarea
        ref={input}
        value={draft}
        maxLength={32000}
        placeholder={t(
          context.selection ? 'agent.selectionPlaceholder' : 'agent.followUpPlaceholder',
        )}
        aria-label={t('agent.placeholder')}
        onChange={(event) => onDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            onSend()
          }
        }}
      />
      <div className="agent-compose-actions">
        <div className="agent-runtime-select">
          <Select
            className="agent-picker"
            contentClassName="agent-picker-menu"
            side="top"
            align="start"
            icon={<Icon name="terminal" size={14} />}
            label="Harness"
            value={provider}
            options={[
              { value: 'claude', label: 'Claude Code' },
              { value: 'codex', label: 'Codex' },
            ]}
            disabled={running || busy || loading}
            onChange={onProvider}
            action={{ label: t('agent.connectionSettings'), onSelect: onSettings }}
          />
        </div>
        <AgentModelMenu
          setup={setup?.configuration.provider === provider ? setup : null}
          modelLoad={modelLoad}
          disabled={running || busy || loading}
          onLoad={onLoadModels}
          onChange={onModelChange}
        />
        <span className="agent-spacer" />
        {running && !interrupting ? (
          <Button
            className="agent-send agent-stop"
            size="small"
            disabled={busy}
            aria-label={t('agent.stop')}
            onClick={onStop}
          >
            <span className="agent-stop-icon" />
          </Button>
        ) : (
          <Button
            className="agent-send"
            size="small"
            variant="primary"
            disabled={!canSend}
            aria-label={t('agent.send')}
            onClick={onSend}
          >
            <Icon name="arrowUp" size={16} />
          </Button>
        )}
      </div>
    </div>
  )
}
