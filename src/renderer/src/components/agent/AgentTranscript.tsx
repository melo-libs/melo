import { agentTool } from '@shared/agentCapabilities'
import { Fragment, type ReactElement } from 'react'
import * as ContextMenu from '@radix-ui/react-context-menu'
import { useTranslation } from 'react-i18next'
import type { AgentHistoryMessage } from '@shared/types/agent'
import { AgentMessage } from './AgentMessage'
import { AgentActivity } from './AgentActivity'
import { AgentChanges, AgentPlan } from './AgentChanges'
import { AgentDateDivider } from './AgentDateDivider'
import { AgentPermission } from './AgentPermission'
import { AgentReceipt } from './AgentReceipt'
import { AgentFilingResult } from './AgentFilingResult'

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
  onUndoFiling,
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
  onUndoFiling(conversationId: string, batchId: string): void
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
  let lastDay = ''
  const dated = (id: string, at: number, content: ReactElement) => {
    const day = new Date(at).toDateString()
    const showDate = day !== lastDay
    lastDay = day
    return [showDate && <AgentDateDivider key={`date:${id}`} at={at} />, content]
  }
  return (
    <>
      {groups.map((group) => {
        const first = group[0]
        const imported = group.filter((message) => message.change?.kind === 'import')
        const changes = group.filter(
          (message) =>
            message.change &&
            message.change.kind !== 'import' &&
            !message.change.batchId &&
            !(
              imported.length &&
              message.change.kind === 'create-folder' &&
              message.change.path === 'Inbox'
            ),
        )
        const filings = [
          ...new Map(
            group.flatMap((message) =>
              message.filing ? [[message.filing.id, message.filing] as const] : [],
            ),
          ).values(),
        ]
        const activity = group.filter(
          (message) =>
            message.role === 'tool' &&
            !message.plan &&
            !message.change &&
            !message.receipt &&
            !message.filing &&
            (!message.approval ||
              (message.approval.operation.kind === 'native' &&
                (message.approval.status !== 'pending' ||
                  message.approval.id !== activePermission ||
                  message.conversationId !== activeConversation))) &&
            !(
              message.toolStatus !== 'failed' &&
              group.some((item) => item.approval || item.change) &&
              agentTool(message.content)?.readOnly === false
            ),
        )
        return (
          <Fragment key={first.id}>
            {imported.length > 0 &&
              !group.some((message) => message.receipt) &&
              dated(
                `receipt:${first.id}`,
                first.createdAt,
                <AgentReceipt
                  key={`receipt:${first.id}`}
                  receipt={{
                    files: imported.map((message) => ({
                      id: message.change!.id,
                      name: message.change!.path.split('/').pop()!,
                      path: message.change!.path,
                      status: 'stored',
                    })),
                  }}
                  onOpen={(id) => onOpenFile(`melo-attachment:${id}`, first.workspaceRoot)}
                />,
              )}
            {group
              .map((message) => {
                if (message.id === activity[0]?.id)
                  return (
                    <AgentActivity
                      key={message.id}
                      messages={activity}
                      active={
                        running &&
                        group === groups.at(-1) &&
                        first.conversationId === activeConversation
                      }
                    />
                  )
                if (activity.includes(message)) return null
                if (message.change || message.filing) return null
                if (message.receipt)
                  return (
                    <AgentReceipt
                      key={message.id}
                      receipt={message.receipt}
                      onOpen={(id) => onOpenFile(`melo-attachment:${id}`, message.workspaceRoot)}
                    />
                  )
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
                if (message.role === 'tool') return null
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
              })
              .map(
                (content, index) =>
                  content && dated(group[index].id, group[index].createdAt, content),
              )}
            {filings.map((filing) =>
              dated(
                filing.id,
                group.at(-1)!.createdAt,
                <AgentFilingResult
                  key={filing.id}
                  filing={filing}
                  disabled={running || busy || first.workspaceRoot !== activeWorkspace}
                  onOpenFile={(path) => onOpenFile(path, first.workspaceRoot)}
                  onUndo={() => onUndoFiling(first.conversationId, filing.id)}
                />,
              ),
            )}
            {changes.length > 0 &&
              dated(
                `changes:${first.id}`,
                group.at(-1)!.createdAt,
                <AgentChanges
                  key={`changes:${first.id}`}
                  messages={changes}
                  disabled={running || busy || first.workspaceRoot !== activeWorkspace}
                  onOpenFile={(path) => onOpenFile(path, first.workspaceRoot)}
                  onUndo={(ids) => onUndo(first.conversationId, ids)}
                />,
              )}
          </Fragment>
        )
      })}
    </>
  )
}
