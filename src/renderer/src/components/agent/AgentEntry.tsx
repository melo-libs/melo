import { useEffect, useState } from 'react'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import * as Tooltip from '@radix-ui/react-tooltip'
import { AGENT_OPERATIONS, operationLocation } from '@shared/agentCapabilities'
import { agentPresenceAtom, agentEntrySeenAtom, agentViewAtom } from '../../store/agent'
import { MeloLogo } from '../MeloLogo'
import { Button } from '../ui/Button'

export function AgentEntry({ onOpen }: { onOpen(): void }) {
  const { t } = useTranslation()
  const { state, label } = useAtomValue(agentPresenceAtom)
  const seen = useAtomValue(agentEntrySeenAtom)
  const view = useAtomValue(agentViewAtom)
  const [detailed, setDetailed] = useState(false)
  const [announcement, setAnnouncement] = useState<string | null>(null)
  useEffect(() => {
    if (state === 'waiting' || state === 'offline' || (state === 'idle' && seen)) {
      setAnnouncement(null)
      return
    }
    setAnnouncement(state)
    const timer = setTimeout(() => setAnnouncement(null), 3000)
    return () => clearTimeout(timer)
  }, [state, seen])

  let detail = t(label)
  let short = state === 'idle' ? t('agent.title') : t(`agent.mascot.${state}`)
  if (state === 'working') {
    const lastUser = view?.messages.findLastIndex((message) => message.role === 'user') ?? -1
    const reading = view?.messages
      .slice(lastUser + 1)
      .findLast(
        (message) => message.toolStatus === 'pending' && message.toolActivity?.kind === 'read',
      )?.toolActivity
    if (reading?.target) {
      short = t('agent.mascot.reading')
      detail = t('agent.mascot.readDetail', { name: reading.target.split(/[\\/]/).pop() })
    }
  }
  if (state === 'waiting' && view?.permission) {
    const operation = view.permission.operation
    // Native titles and parameters can contain raw commands; keep those inside the conversation.
    if (operation.kind !== 'native') {
      const action = t(`agent.actions.${AGENT_OPERATIONS[operation.kind].label}`)
      detail += ` · ${action} ${operationLocation(operation).split(/[\\/]/).pop()}`
    }
  }
  const open = detailed || state === 'waiting' || announcement === state
  return (
    <Tooltip.Provider disableHoverableContent>
      <Tooltip.Root open={open}>
        <Tooltip.Trigger asChild>
          <Button
            className="agent-entry agent-dock"
            data-mode={state}
            data-intro={!seen || undefined}
            size="small"
            onClick={onOpen}
            onPointerEnter={() => setDetailed(true)}
            onPointerLeave={() => setDetailed(false)}
            onFocus={(event) => setDetailed(event.currentTarget.matches(':focus-visible'))}
            onBlur={() => setDetailed(false)}
            aria-label={state === 'idle' ? t('agent.title') : `${t('agent.title')} · ${detail}`}
          >
            <MeloLogo size={48} mood={state} aria-hidden="true" />
          </Button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            className="agent-dock-bubble"
            data-mode={state}
            side="top"
            sideOffset={0}
            collisionPadding={12}
            updatePositionStrategy="always"
          >
            {detailed ? detail : short}
            <Tooltip.Arrow asChild width={12} height={7}>
              <svg className="agent-dock-bubble-arrow" viewBox="0 0 12 7" aria-hidden="true">
                <path d="M0 0 6 6 12 0" />
              </svg>
            </Tooltip.Arrow>
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  )
}
