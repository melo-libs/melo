import { useTranslation } from 'react-i18next'
import type { AgentComponent } from '@shared/types/agent'
import { agentErrorText } from './agentError'

export const runtimeWorking = (component?: AgentComponent) =>
  component?.status === 'downloading' || component?.status === 'preparing'
export const runtimeMegabytes = (bytes: number) => Math.ceil(bytes / 1024 / 1024)

export function AgentRuntimeStatus({ component }: { component: AgentComponent }) {
  const { t } = useTranslation()
  return (
    <>
      {component.status === 'error'
        ? agentErrorText(component.error ?? '')
        : t(
            component.status === 'preparing'
              ? 'agent.componentPreparing'
              : component.status === 'paused'
                ? 'agent.componentPaused'
                : 'agent.componentProgress',
            {
              downloaded: runtimeMegabytes(component.transferred),
              total: runtimeMegabytes(component.total),
            },
          )}
    </>
  )
}

export function AgentRuntimeProgress({
  component,
  showLabel = true,
}: {
  component: AgentComponent
  showLabel?: boolean
}) {
  const { t } = useTranslation()
  return (
    <div className="agent-runtime-progress" role="status">
      {showLabel && (
        <span>
          <AgentRuntimeStatus component={component} />
        </span>
      )}
      <progress
        aria-label={t('agent.componentDownloading')}
        max={component.total || 1}
        value={component.transferred}
        data-paused={!runtimeWorking(component) || undefined}
      />
    </div>
  )
}
