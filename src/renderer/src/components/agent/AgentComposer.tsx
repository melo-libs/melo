import { useLayoutEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  AgentContext,
  AgentAttachment,
  AgentModelControl,
  AgentProvider,
  AgentSetup,
} from '@shared/types/agent'
import { Icon } from '../Icon'
import { Button } from '../ui/Button'
import { AgentModelMenu } from './AgentModelMenu'
import { Select } from '../ui/Select'
import type { AgentModelLoadState } from '../../store/agent'
import { AgentAttachments } from './AgentAttachments'

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
  connected,
  connectionChecking = false,
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
  attachments,
  receivingFiles,
  onPasteAttachments,
  onRemoveAttachment,
  draggingFiles,
}: {
  attachments: AgentAttachment[]
  draggingFiles: boolean
  onPasteAttachments(): Promise<boolean>
  receivingFiles: boolean
  onRemoveAttachment(id: string): void
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
  connected: boolean
  connectionChecking?: boolean
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
  }, [focusKey, connected])
  useLayoutEffect(() => {
    const el = input.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(132, Math.max(38, el.scrollHeight))}px`
  }, [draft])
  return (
    <div
      className="agent-compose"
      data-disconnected={!connected || undefined}
      data-dragging-files={draggingFiles || undefined}
    >
      <AgentAttachments
        files={attachments}
        disabled={busy || running}
        onRemove={onRemoveAttachment}
      />
      {receivingFiles && (
        <small role="status" className="agent-attachment-hint">
          {t('agent.receivingAttachments')}
        </small>
      )}
      {context.selection && (
        <div className="agent-context-strip">
          <Icon name="arrowRight" size={14} />
          <button
            className="agent-context-text"
            onClick={() => context.filePath && onOpenFile(context.filePath)}
            title={context.selection || context.filePath}
          >
            {context.selection}
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
        disabled={!connected}
        maxLength={32000}
        placeholder={
          connectionChecking || !setup
            ? ''
            : t(
                !connected
                  ? 'agent.connectToChat'
                  : context.selection
                    ? 'agent.selectionPlaceholder'
                    : draft || attachments.length
                      ? 'agent.followUpPlaceholder'
                      : 'agent.attachmentPlaceholder',
              )
        }
        aria-label={t('agent.placeholder')}
        onChange={(event) => onDraft(event.target.value)}
        onPaste={(event) => {
          event.preventDefault()
          const text = event.clipboardData.getData('text/plain')
          const { selectionStart, selectionEnd } = event.currentTarget
          void onPasteAttachments().then((handled) => {
            const el = input.current
            if (!handled && el && text) {
              el.setRangeText(text, selectionStart, selectionEnd, 'end')
              onDraft(el.value.slice(0, 32000))
            }
          })
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            onSend()
          }
        }}
      />
      <div className="agent-compose-actions">
        {connected && (
          <>
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
          </>
        )}
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
