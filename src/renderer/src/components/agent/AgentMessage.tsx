import { agentTool } from '@shared/agentCapabilities'
import { Fragment, memo, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { MarkdownManager } from '@tiptap/markdown'
import { StarterKit } from '@tiptap/starter-kit'
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table'
import { TaskList, TaskItem } from '@tiptap/extension-list'
import type { JSONContent } from '@tiptap/core'
import type { AgentMessage as Message } from '@shared/types/agent'
import { IpcChannels } from '@shared/types/ipc'
import { safeExternalUrl } from '../../lib/url'
import { Icon } from '../Icon'
import type { AgentContext } from '@shared/types/agent'
import { AgentQuote } from './AgentQuote'
import { agentFilePath } from './agentFiles'

// Render model output as React nodes: no raw HTML, remote images or executable
// links. Replies share the editor's Markdown parser without mounting an editor.
const markdown = new MarkdownManager({
  extensions: [StarterKit, Table, TableRow, TableCell, TableHeader, TaskList, TaskItem],
})

function renderNode(
  node: JSONContent,
  key: number,
  onOpenFile?: (path: string) => void,
  onOpenMessage?: (id: string) => void,
): ReactNode {
  const children = node.content?.map((child, index) =>
    renderNode(child, index, onOpenFile, onOpenMessage),
  )
  if (node.type === 'text') {
    let text: ReactNode = node.text
    for (const mark of node.marks ?? []) {
      switch (mark.type) {
        case 'bold':
          text = <strong>{text}</strong>
          break
        case 'italic':
          text = <em>{text}</em>
          break
        case 'strike':
          text = <s>{text}</s>
          break
        case 'code':
          text = <code>{text}</code>
          break
        case 'link': {
          const href = typeof mark.attrs?.href === 'string' ? mark.attrs.href : ''
          if (href.startsWith('melo-message:') && /^[\w:-]{1,256}$/.test(href.slice(13))) {
            if (onOpenMessage)
              text = (
                <button className="agent-inline-file" onClick={() => onOpenMessage(href.slice(13))}>
                  {text}
                </button>
              )
            break
          }
          const filePath = agentFilePath(href)
          if (filePath) {
            if (onOpenFile)
              text = (
                <button className="agent-inline-file" onClick={() => onOpenFile(filePath)}>
                  {text}
                </button>
              )
            break
          }
          const url = /^(https?:|mailto:)/i.test(href) ? safeExternalUrl(href) : null
          if (url)
            text = (
              <a
                href={url}
                onClick={(event) => {
                  event.preventDefault()
                  void window.api.invoke(IpcChannels.InvokeOpenExternal, { url })
                }}
              >
                {text}
              </a>
            )
          break
        }
      }
    }
    return <Fragment key={key}>{text}</Fragment>
  }
  switch (node.type) {
    case 'paragraph':
      return <p key={key}>{children}</p>
    case 'heading':
      return <h4 key={key}>{children}</h4>
    case 'hardBreak':
      return <br key={key} />
    case 'horizontalRule':
      return <hr key={key} />
    case 'bulletList':
      return <ul key={key}>{children}</ul>
    case 'orderedList':
      return (
        <ol key={key} start={node.attrs?.start}>
          {children}
        </ol>
      )
    case 'listItem':
      return <li key={key}>{children}</li>
    case 'taskList':
      return (
        <ul className="agent-task-list" key={key}>
          {children}
        </ul>
      )
    case 'taskItem':
      return (
        <li key={key}>
          <input type="checkbox" checked={!!node.attrs?.checked} readOnly tabIndex={-1} />
          {children}
        </li>
      )
    case 'blockquote':
      return <blockquote key={key}>{children}</blockquote>
    case 'codeBlock':
      return (
        <pre key={key}>
          <code>{children}</code>
        </pre>
      )
    case 'table':
      return (
        <div className="agent-table" key={key}>
          <table>
            <tbody>{children}</tbody>
          </table>
        </div>
      )
    case 'tableRow':
      return <tr key={key}>{children}</tr>
    case 'tableHeader':
      return <th key={key}>{children}</th>
    case 'tableCell':
      return <td key={key}>{children}</td>
    default:
      return <Fragment key={key}>{children}</Fragment>
  }
}

export const AgentMessage = memo(function AgentMessage({
  content,
  role,
  complete,
  context,
  onOpenFile,
  onOpenMessage,
}: {
  content: string
  role: 'assistant' | 'user'
  complete: boolean
  context?: AgentContext
  onOpenFile?(path: string): void
  onOpenMessage?(id: string): void
}) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const document = useMemo(
    () => (role === 'assistant' ? markdown.parse(content) : null),
    [content, role],
  )
  const body = useMemo(
    () =>
      document
        ? document.content?.map((node, index) => renderNode(node, index, onOpenFile, onOpenMessage))
        : content,
    [document, content, onOpenFile, onOpenMessage],
  )
  return (
    <div className={`agent-message agent-${role}`}>
      {role === 'user' && context?.selection && (
        <AgentQuote context={context} onOpenFile={onOpenFile} />
      )}
      <div className={role === 'assistant' ? 'agent-markdown' : 'agent-user-text'}>{body}</div>
      {role === 'assistant' && complete && (
        <button
          className="agent-quiet agent-copy"
          aria-label={t(copied ? 'agent.copied' : 'agent.copyReply')}
          onClick={() => {
            void navigator.clipboard.writeText(content).then(() => setCopied(true))
          }}
        >
          <Icon name={copied ? 'tick' : 'copy'} size={14} />
          {copied && t('agent.copied')}
        </button>
      )}
    </div>
  )
})

export function AgentActivity({ messages }: { messages: Message[] }) {
  const { t, i18n } = useTranslation()
  const pending = messages.find((message) => message.toolStatus === 'pending')
  const failed = messages.filter((message) => message.toolStatus === 'failed').length
  const names = [...new Set(messages.map((message) => message.content))]
  const label = (name: string) =>
    i18n.exists(`agent.tools.${name}`) ? t(`agent.tools.${name}`) : name
  return (
    <details className="agent-activity">
      <summary>
        <Icon name="chev" size={14} />
        <span>
          {pending
            ? label(pending.content)
            : failed
              ? t('agent.activityFailed', { count: failed })
              : names.every((name) => agentTool(name)?.readOnly === true)
                ? t('agent.activityReviewed', {
                    sources: names
                      .map((name) => t(`agent.activitySources.${name}`))
                      .join(i18n.language.startsWith('zh') ? '、' : ', '),
                  })
                : t('agent.activityDone', { count: messages.length })}
        </span>
      </summary>
      {messages.map((message) => (
        <div className="agent-tool" key={message.id} data-status={message.toolStatus}>
          <span>
            {message.toolStatus === 'pending' ? '…' : message.toolStatus === 'failed' ? '×' : '✓'}
          </span>
          {label(message.content)}
        </div>
      ))}
    </details>
  )
}
