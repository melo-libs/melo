import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { AgentPermission } from './AgentPermission'
import type { AgentApproval } from '@shared/types/agent'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
const approval: AgentApproval = {
  id: 'edit',
  operation: { kind: 'edit', path: 'Note.md', diff: '@@ -1 +1 @@\n-old <script>\n+new <img>' },
  status: 'pending',
}
const render = (active: boolean, status = approval.status) =>
  renderToStaticMarkup(
    createElement(AgentPermission, {
      permission: { ...approval, status },
      active,
      busy: false,
      workspaceName: 'notes',
      onRespond: () => {},
    }),
  )
it('shows a safe diff and actual actions only for an active confirmation', () => {
  const html = render(true)
  expect(html).toContain('data-kind="removed"')
  expect(html).toContain('data-kind="added"')
  expect(html).not.toContain('<script>')
  expect(html).not.toContain('<img>')
  expect(html).toContain('agent.approve.apply')
  expect(html).toContain('data-pending')
})
it('keeps an inactive confirmation visible as expired without stale approval actions', () => {
  const html = render(false)
  expect(html).toContain('agent.approvalStatus.expired')
  expect(html).toContain('agent-edit-diff')
  expect(html).not.toContain('agent.approve.apply')
  expect(html).not.toContain('data-pending')
})

it('keeps arrows and newlines in a target path instead of parsing it as presentation data', () => {
  const path = 'folder/a → b\nc.md'
  const html = renderToStaticMarkup(
    createElement(AgentPermission, {
      permission: {
        id: 'create',
        operation: { kind: 'create-note', path, content: 'First line\nSecond line' },
        status: 'pending',
      },
      active: true,
      busy: false,
      workspaceName: 'notes',
      onRespond: () => {},
    }),
  )
  expect(html).toContain(path)
  expect(html).toContain('First line\nSecond line')
  expect(html).toContain('agent.allowConversation')
})

it.each([
  { kind: 'native' as const, title: 'Create note', detail: 'note.md' },
  { kind: 'memory' as const, scope: 'user' as const, content: 'Keep it brief.' },
])('does not offer run approval for $kind operations regardless of display title', (operation) => {
  const html = renderToStaticMarkup(
    createElement(AgentPermission, {
      permission: { id: 'review', operation, status: 'pending' },
      active: true,
      busy: false,
      workspaceName: 'notes',
      onRespond: () => {},
    }),
  )
  expect(html).not.toContain('agent.allowConversation')
})
