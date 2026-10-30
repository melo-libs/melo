import { agentTool } from '@shared/agentCapabilities'
import { Fragment } from 'react'
import * as ContextMenu from '@radix-ui/react-context-menu'
import { useTranslation } from 'react-i18next'
import type { AgentHistoryMessage } from '@shared/types/agent'
import { AgentMessage, AgentActivity } from './AgentMessage'
import { AgentChanges, AgentPlan } from './AgentChanges'
import { AgentSource } from './AgentSource'
import { AgentPermission } from './AgentPermission'

export function AgentTranscript({
  messages,
  running,
  busy,
  activeConversation,
  activeWorkspace,
  activePlan,
  activePermission,
  onRespond,
  highlight,
  onOpenFile,
  onOpenMessage,
  onUndo,
  onDelete,
}: {
  messages: AgentHistoryMessage[]
  running: boolean
  busy: boolean
  activeConversation?: string
  activeWorkspace: string
  activePlan?: string
  activePermission?: string
  onRespond?(conversationId: string, permissionId: string, allow: boolean, run?: boolean): void
  highlight: string | null
  onOpenFile(path: string, workspace: string): void
  onOpenMessage(id: string): void
  onUndo(conversationId: string, ids: string[]): void
  onDelete(id: string): void
}) {
  const { t } = useTranslation()
  const groups: AgentHistoryMessage[][] = []
  for (const message of messages) {
    const previous = groups.at(-1)?.at(-1)
    if (message.role === 'user' || message.conversationId !== previous?.conversationId)
      groups.push([])
    groups.at(-1)!.push(message)
  }
  let lastSource = ''
  return (
    <>
      {groups.map((group) => {
        const first = group[0],
          source = first.context?.filePath
        const sourceKey = source ? `${first.workspaceRoot}/${source}` : ''
        // A new selection starts a visible reference boundary even within the same note.
        const showSource = sourceKey && (sourceKey !== lastSource || !!first.context?.selection)
        if (sourceKey) lastSource = sourceKey
        const changes = group.filter((message) => message.change)
        const activity = group.filter(
          (message) =>
            message.role === 'tool' &&
            !message.plan &&
            !message.change &&
            !message.approval &&
            !(
              message.toolStatus !== 'failed' &&
              group.some((item) => item.approval || item.change) &&
              agentTool(message.content)?.readOnly === false
            ),
        )
        return (
          <Fragment key={first.id}>
            {showSource && (
              <AgentSource
                path={source!}
                at={first.createdAt}
                onOpen={() => onOpenFile(source!, first.workspaceRoot)}
              />
            )}
            {group.map((message) => {
              if (message.change) return null
              if (message.approval)
                return (
                  <AgentPermission
                    key={message.id}
                    permission={message.approval}
                    active={
                      message.approval.id === activePermission &&
                      message.conversationId === activeConversation
                    }
                    workspaceName={message.workspaceRoot.split('/').pop()!}
                    busy={busy}
                    onRespond={(allow, run) =>
                      onRespond?.(message.conversationId, message.approval!.id, allow, run)
                    }
                  />
                )
              if (message.plan) {
                const complete =
                  message.plan.length > 0 &&
                  message.plan.every((entry) => entry.status === 'completed')
                return complete ? (
                  <p key={message.id} className="agent-plan-complete">
                    <span>✓</span>
                    {t('agent.stepsDone', { count: message.plan.length })}
                  </p>
                ) : (
                  <AgentPlan
                    key={message.id}
                    entries={message.plan}
                    active={running && !busy && message.id === activePlan}
                  />
                )
              }
              if (message.role === 'tool') {
                return message.id === activity[0]?.id ? (
                  <AgentActivity key={message.id} messages={activity} />
                ) : null
              }
              return (
                <ContextMenu.Root key={message.id}>
                  <ContextMenu.Trigger asChild>
                    <div
                      className="agent-message-anchor"
                      data-message-id={message.id}
                      data-highlight={highlight === message.id || undefined}
                    >
                      <AgentMessage
                        content={message.content}
                        role={message.role}
                        context={message.context}
                        complete={
                          !running ||
                          message.conversationId !== activeConversation ||
                          message.id !== messages.at(-1)?.id
                        }
                        onOpenFile={(path) => onOpenFile(path, message.workspaceRoot)}
                        onOpenMessage={onOpenMessage}
                      />
                    </div>
                  </ContextMenu.Trigger>
                  <ContextMenu.Portal>
                    <ContextMenu.Content className="top-menu agent-message-menu">
                      <ContextMenu.Item
                        className="tm-item"
                        disabled={running || busy}
                        onSelect={() => onDelete(message.id)}
                      >
                        {t('agent.deleteMessage')}
                      </ContextMenu.Item>
                    </ContextMenu.Content>
                  </ContextMenu.Portal>
                </ContextMenu.Root>
              )
            })}
            {changes.length > 0 && (
              <AgentChanges
                messages={changes}
                disabled={running || busy || first.workspaceRoot !== activeWorkspace}
                onOpenFile={(path) => onOpenFile(path, first.workspaceRoot)}
                onUndo={(ids) => onUndo(first.conversationId, ids)}
              />
            )}
          </Fragment>
        )
      })}
    </>
  )
}
