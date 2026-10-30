import { operationLocation } from '@shared/agentCapabilities'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentView } from '@shared/types/agent'
import { MeloLogo } from '../MeloLogo'
import { Button } from '../ui/Button'

/** Only mounted while minimized, so opening the answer acknowledges its notice. */
export function AgentDock({ view, onExpand }: { view: AgentView | null; onExpand(): void }) {
  const { t, i18n } = useTranslation()
  const previous = useRef(view)
  const [replyReady, setReplyReady] = useState(false)
  const running = !!view && view.status !== 'idle' && view.status !== 'error'
  const turn = useMemo(() => {
    const start = view?.messages.map((message) => message.role).lastIndexOf('user') ?? -1
    return view?.messages.slice(start + 1) ?? []
  }, [view])
  const pending = turn.filter((message) => message.toolStatus === 'pending').at(-1)
  const currentStep = turn
    .filter((message) => message.plan)
    .at(-1)
    ?.plan?.find((entry) => entry.status === 'in_progress')
  useEffect(() => {
    const last = previous.current
    if (last?.conversation.id !== view?.conversation.id) setReplyReady(false)
    else if (
      last &&
      last.status !== 'idle' &&
      last.status !== 'error' &&
      view?.status === 'idle' &&
      turn.some((message) => message.role === 'assistant' && message.content.trim())
    )
      setReplyReady(true)
    if (running) setReplyReady(false)
    previous.current = view
  }, [view, running, turn])
  const waiting = !!view?.permission
  const mode = waiting
    ? 'waiting'
    : running
      ? 'working'
      : view?.error
        ? 'error'
        : replyReady
          ? 'ready'
          : 'idle'
  const activity = pending
    ? i18n.exists(`agent.tools.${pending.content}`)
      ? t(`agent.tools.${pending.content}`)
      : pending.content
    : currentStep?.content
  const target = view?.permission
    ? operationLocation(view.permission.operation).split('/').pop()
    : undefined
  const label = waiting
    ? [t('agent.waitingForYou'), target].filter(Boolean).join(' · ')
    : running
      ? activity || t('agent.working')
      : view?.error
        ? t('agent.failed')
        : replyReady
          ? t('agent.replyReady')
          : ''
  return (
    <Button
      className="agent-dock"
      data-mode={mode}
      onClick={onExpand}
      aria-label={label ? `${label} · ${t('agent.expand')}` : t('agent.expand')}
      title={label || t('agent.expand')}
    >
      <MeloLogo size={26} />
      {mode === 'working' && <span className="agent-dock-spinner" aria-hidden="true" />}
      {mode === 'waiting' && <span className="agent-dock-dot" aria-hidden="true" />}
      {label && <span className="agent-dock-label">{label}</span>}
      {mode === 'ready' && <span className="agent-dock-hint">· {t('agent.openReply')}</span>}
    </Button>
  )
}
