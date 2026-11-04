import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import type { AgentFiling, AgentHistoryMessage, AgentMessage } from '@shared/types/agent'
import { agentOperationSchema } from '@shared/agentCapabilities'
import { AgentChanges } from './AgentChanges'
import { AgentFilingResult } from './AgentFilingResult'
import { AgentTranscript } from './AgentTranscript'
import { AgentReceipt } from './AgentReceipt'
import { AgentPermission } from './AgentPermission'
import { AgentActivity } from './AgentActivity'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', exists: () => false },
  }),
}))

it('keeps native activity and resolved permissions compact while retaining command details', () => {
  const command = 'pdftotext "Inbox/statement.pdf" - | head -60'
  const activity = renderToStaticMarkup(
    createElement(AgentActivity, {
      active: true,
      messages: [
        { id: 'read', role: 'tool', content: command, toolStatus: 'pending', createdAt: 1 },
      ],
    }),
  )
  expect(activity.slice(0, activity.indexOf('</summary>'))).toContain('agent.activityDetails')
  expect(activity.slice(0, activity.indexOf('</summary>'))).not.toContain('pdftotext')
  expect(activity).toContain('pdftotext')
  for (const status of ['pending', 'allowed', 'declined', 'expired'] as const) {
    const permission = {
      id: 'native',
      status,
      operation: {
        kind: 'native' as const,
        title: command,
        detail: JSON.stringify({
          command,
          description: 'Inspect the attachment',
          dangerouslyDisableSandbox: true,
        }),
      },
    }
    const html = renderToStaticMarkup(
      status === 'pending'
        ? createElement(AgentPermission, {
            permission,
            active: true,
            busy: false,
            workspaceName: 'notes',
            onRespond: () => {},
          })
        : createElement(AgentActivity, {
            active: false,
            messages: [
              { id: 'native', role: 'tool', content: '', createdAt: 1, approval: permission },
            ],
          }),
    )
    expect(html).toContain('pdftotext')
    expect(html).toContain('dangerouslyDisableSandbox')
    if (status === 'pending') {
      expect(html).toContain('data-pending')
      expect(html).toContain('Inspect the attachment')
      expect(html).not.toContain('class="agent-native-parameters" open')
    } else {
      expect(html).toContain('agent.activityDetails')
      expect(html).toContain(`agent.nativeApproval.${status}`)
      expect(html).not.toContain('class="agent-permission')
      expect(html).not.toContain('<details class="agent-activity" open')
      expect(html.slice(0, html.indexOf('</summary>'))).not.toContain('pdftotext')
    }
  }
})

it('keeps a failed attempt in details without presenting it as the task result', () => {
  const render = (active: boolean) =>
    renderToStaticMarkup(
      createElement(AgentActivity, {
        active,
        messages: [
          {
            id: 'attempt',
            role: 'tool',
            content: 'mdls Inbox/report.pdf',
            toolStatus: 'failed',
            toolActivity: { kind: 'execute' },
            createdAt: 1,
          },
          {
            id: 'read',
            role: 'tool',
            content: 'Read /notes/Inbox/report.pdf',
            toolStatus: 'completed',
            toolActivity: { kind: 'read', target: '/notes/Inbox/report.pdf' },
            createdAt: 2,
          },
          {
            id: 'pending',
            role: 'tool',
            content: 'Older unfinished call',
            toolStatus: 'pending',
            createdAt: 3,
          },
        ],
      }),
    )
  const html = render(true)
  const summary = html.slice(0, html.indexOf('</summary>'))
  expect(summary).toContain('agent.activityDetails')
  expect(summary).not.toContain('Failed')
  expect(summary).not.toContain('completed')
  expect(html).toContain('agent.activityAttemptFailed')
  expect(html).toContain('agent.activityKinds.read')
  expect(html).toContain('report.pdf')
  expect(html).toContain('agent.activityInProgress')
  expect(render(false)).not.toContain('agent.activityInProgress')
  expect(render(false)).toContain('agent.activityEnded')
})

const message = (id: string, selection?: string): AgentHistoryMessage => ({
  id,
  sequence: Number(id),
  conversationId: 'conversation',
  workspaceRoot: '/notes',
  role: 'user',
  content: 'Explain this',
  context: { filePath: 'Ideas.md', ...(selection ? { selection } : {}) },
  createdAt: Number(id),
})

it('groups resolved access requests with tool details and keeps the current approval actionable', () => {
  const messages: AgentHistoryMessage[] = [
    message('1'),
    { ...message('2'), role: 'tool', content: 'pdftotext report.pdf -', toolStatus: 'failed' },
    ...(['allowed', 'pending'] as const).map((status, index) => ({
      ...message(String(index + 3)),
      role: 'tool' as const,
      content: '',
      approval: {
        id: status,
        status,
        operation: {
          kind: 'native' as const,
          title: 'Extra operation',
          detail: JSON.stringify({
            command: 'read report.pdf',
            description: 'Read the file with another reader',
          }),
        },
      },
    })),
  ]
  const render = (activePermission?: string) =>
    renderToStaticMarkup(
      createElement(AgentTranscript, {
        messages,
        running: !!activePermission,
        busy: false,
        activeConversation: 'conversation',
        activeWorkspace: '/notes',
        activePermission,
        highlight: null,
        onOpenFile: () => {},
        onOpenMessage: () => {},
        onUndo: () => {},
        onUndoFiling: () => {},
        onDelete: () => {},
      }),
    )
  const active = render('pending')
  expect(active.match(/class="agent-activity"/g)).toHaveLength(1)
  expect(active.match(/data-pending="true"/g)).toHaveLength(1)
  expect(active).toContain('agent.nativeApproval.allowed')
  const ended = render()
  expect(ended.match(/class="agent-activity"/g)).toHaveLength(1)
  expect(ended).not.toContain('data-pending')
  expect(ended).not.toContain('class="agent-permission')
  expect(ended).toContain('agent.nativeApproval.expired')
})

it('renders historical organization proposals read-only even when marked pending', () => {
  const html = renderToStaticMarkup(
    createElement(AgentPermission, {
      permission: {
        id: 'legacy',
        status: 'pending',
        operation: agentOperationSchema.parse({
          kind: 'organize',
          files: [
            {
              id: '00000000-0000-4000-8000-000000000001',
              name: 'Original.pdf',
              size: 1,
              source: 'Inbox/Original.pdf',
              destination: 'Reference/Original.pdf',
              detail: 'Historical suggestion',
              readable: true,
            },
          ],
          folders: [],
          locations: [],
          includeNote: false,
        }),
      },
      active: true,
      busy: false,
      workspaceName: 'notes',
      onRespond: () => {},
    }),
  )
  expect(html).toContain('Reference/Original.pdf')
  expect(html).toContain('Historical suggestion')
  expect(html).not.toContain('data-pending')
  expect(html).not.toContain('<button')
  expect(html).not.toContain('<input')
})

it('does not reopen a superseded confirmation when the user asks to revise the plan', () => {
  const html = renderToStaticMarkup(
    createElement(AgentPermission, {
      permission: {
        id: 'old',
        status: 'pending',
        operation: { kind: 'create-folder', path: 'Travel' },
      },
      active: false,
      busy: false,
      workspaceName: 'notes',
      onRespond: () => {},
    }),
  )
  expect(html).toContain('agent.approvalLabel.expired')
  expect(html).not.toContain('agent-approval-record" open')
  expect(html).not.toContain('data-pending')
})

it('only marks a source change after sending, keeping repeated selections within the same file', () => {
  const html = renderToStaticMarkup(
    createElement(AgentTranscript, {
      messages: [
        { ...message('1'), context: { activeFilePath: 'Ideas.md' } },
        {
          ...message('2'),
          context: { activeFilePath: 'Ideas.md', filePath: 'Ideas.md', selection: 'First quote' },
        },
        {
          ...message('3'),
          context: {
            activeFilePath: 'Inbox/report.pdf',
            filePath: 'Ideas.md',
            selection: 'A different passage',
          },
        },
        { ...message('4'), context: { activeFilePath: 'Inbox/report.pdf' } },
      ],
      running: false,
      activeWorkspace: '/notes',
      busy: false,
      highlight: null,
      onOpenFile: () => {},
      onOpenMessage: () => {},
      onUndo: () => {},
      onUndoFiling: () => {},
      onDelete: () => {},
    }),
  )
  expect(html.match(/class="agent-source-divider"/g)).toHaveLength(2)
  const boundary = html.lastIndexOf('class="agent-source-divider"')
  expect(boundary).toBeLessThan(html.indexOf('A different passage'))
  expect(html.slice(boundary)).toContain('<strong>report.pdf</strong>')
})

it('shows Inbox receipt separately from changes and never offers import undo while reviewing a plan', () => {
  const html = renderToStaticMarkup(
    createElement(AgentReceipt, {
      receipt: {
        files: [{ id: 'file', name: 'booking.pdf', path: 'Inbox/booking.pdf', status: 'stored' }],
      },
      onOpen: () => {},
    }),
  )
  expect(html).toContain('agent-receipt')
  expect(html).toContain('booking.pdf')
  expect(html).not.toContain('agent.undo')
  expect(html).not.toContain('agent-changes')
  const imports = renderToStaticMarkup(
    createElement(AgentChanges, {
      messages: [
        {
          id: 'import',
          role: 'tool',
          content: '',
          createdAt: 1,
          change: { id: 'file', kind: 'import', path: 'Inbox/booking.pdf', undone: false },
        },
      ],
      disabled: false,
      onUndo: () => {},
      onOpenFile: () => {},
    }),
  )
  expect(imports).toBe('')
})

it('keeps a single trash result collapsed with one restore action, then records restoration', () => {
  const messages: AgentMessage[] = [
    {
      id: 'trash-result',
      role: 'tool',
      content: '',
      createdAt: 1,
      change: { id: 'trash', kind: 'trash', path: 'Inbox/report.pdf', undone: false },
    },
  ]
  const render = (disabled = false) =>
    renderToStaticMarkup(
      createElement(AgentChanges, {
        messages,
        disabled,
        onUndo: () => {},
        onOpenFile: () => {},
      }),
    )
  const html = render()
  expect(html).toContain('<details class="agent-change-details">')
  expect(html).not.toContain(' open')
  expect(html).not.toContain('agent-card-heading')
  expect(html).toContain('agent.trashedCount')
  expect(html).toContain('report.pdf')
  expect(html.match(/<button/g)).toHaveLength(1)
  expect(html).toContain('agent.restore')
  expect(render(true)).toContain('disabled=""')
  messages[0].change!.undone = true
  const restored = render()
  expect(restored).toContain('agent.restored')
  expect(restored).not.toContain('<button')
})

it('keeps change ownership across a deleted question and disables undo in other workspaces', () => {
  const onUndo = vi.fn(),
    onOpenFile = vi.fn()
  const change = (
    id: string,
    conversationId: string,
    workspaceRoot: string,
  ): AgentHistoryMessage => ({
    ...message(id),
    role: 'tool',
    conversationId,
    workspaceRoot,
    change: { id, kind: 'create-note', path: `${id}.md`, undone: false },
  })
  const output = AgentTranscript({
    messages: [message('1'), change('2', 'conversation', '/notes'), change('3', 'other', '/other')],
    running: false,
    busy: false,
    highlight: null,
    activeWorkspace: '/notes',
    onOpenFile,
    onOpenMessage: () => {},
    onUndo,
    onUndoFiling: () => {},
    onDelete: () => {},
  })
  const groups = output.props.children as ReactElement<{ children: ReactElement[] }>[]
  const cards = groups.flatMap((group) =>
    group.props.children.filter((child) => child?.type === AgentChanges),
  ) as ReactElement<Parameters<typeof AgentChanges>[0]>[]
  expect(cards).toHaveLength(2)
  expect(cards[0].props.disabled).toBe(false)
  expect(cards[1].props.disabled).toBe(true)
  cards[1].props.onUndo(['3'])
  expect(onUndo).toHaveBeenCalledWith('other', ['3'])
  cards[1].props.onOpenFile('3.md')
  expect(onOpenFile).toHaveBeenCalledWith('3.md', '/other')
})

it('keeps filing completion to one collapsed receipt and undoes the remaining filing together', () => {
  const changes: AgentMessage[] = [
    {
      id: 'import',
      role: 'tool',
      content: '',
      createdAt: 1,
      change: { id: 'import', kind: 'import', path: 'Inbox/report.pdf', undone: false },
    },
    {
      id: 'folder',
      role: 'tool',
      content: '',
      createdAt: 2,
      change: { id: 'folder', kind: 'create-folder', path: 'Reports', undone: false },
    },
    {
      id: 'move',
      role: 'tool',
      content: '',
      createdAt: 3,
      change: {
        id: 'move',
        kind: 'move',
        source: 'Inbox/report.pdf',
        path: 'Reports/report.pdf',
        undone: false,
      },
    },
    {
      id: 'note',
      role: 'tool',
      content: '',
      createdAt: 4,
      change: { id: 'note', kind: 'edit', path: 'index.md', undone: true },
    },
  ]
  const onUndo = vi.fn()
  const props = {
    filing: {
      id: 'batch',
      version: 1,
      state: 'completed' as const,
      unresolved: [],
      fileCount: 1,
      createdAt: 1,
      changes: changes.flatMap((item) =>
        item.change && item.change.kind !== 'import' ? [item.change] : [],
      ),
    },
    disabled: false,
    onUndo,
    onOpenFile: () => {},
  }
  const html = renderToStaticMarkup(createElement(AgentFilingResult, props))
  expect(html).toContain('agent-filing-result')
  expect(html).toContain('agent.organization.partiallyUndone')
  expect(html).not.toContain('class="agent-changes"')
  expect(html).not.toContain('agent-card-heading')
  expect(html).not.toContain('<time>')
  expect(html).not.toContain('<details class="agent-filing-details" open')
  expect(html).not.toContain('class="agent-quiet"')
  expect(html.match(/class="[^"]*agent-filing-undo/g)).toHaveLength(1)
  const output = AgentFilingResult(props)
  const undo = output.props.children[1] as ReactElement<{ onClick(): void }>
  undo.props.onClick()
  expect(onUndo).toHaveBeenCalledOnce()
  expect(
    renderToStaticMarkup(createElement(AgentFilingResult, { ...props, disabled: true })),
  ).toContain('disabled=""')
  const undone = renderToStaticMarkup(
    createElement(AgentFilingResult, {
      ...props,
      filing: {
        ...props.filing,
        changes: props.filing.changes.map((change) => ({ ...change, undone: true })),
      },
    }),
  )
  expect(undone).toContain('agent.organization.undone')
  expect(undone).not.toContain('agent-filing-undo')
})

it('keeps two filing batches separate from unrelated edits after their question is deleted', () => {
  const filing = (id: string): AgentFiling => ({
    id,
    version: 1,
    state: 'completed',
    unresolved: [],
    createdAt: 2,
    fileCount: 1,
    changes: [
      {
        id: `${id}-move`,
        batchId: id,
        kind: 'move',
        source: 'Inbox/report.pdf',
        path: `${id}/report.pdf`,
        undone: false,
      },
    ],
  })
  const first = filing('first'),
    second = filing('second')
  const onUndoFiling = vi.fn()
  const props = {
    messages: [
      message('1'),
      {
        ...message('2'),
        role: 'tool' as const,
        change: { id: 'unrelated', kind: 'edit' as const, path: 'note.md', undone: false },
      },
      { ...message('3'), role: 'tool' as const, filing: first, change: first.changes[0] },
      { ...message('4'), role: 'tool' as const, filing: second, change: second.changes[0] },
    ],
    running: false,
    busy: false,
    activeWorkspace: '/notes',
    highlight: null,
    onOpenFile: () => {},
    onOpenMessage: () => {},
    onDelete: () => {},
    onUndo: () => {},
    onUndoFiling,
  }
  const output = AgentTranscript(props)
  const groups = output.props.children as ReactElement<{ children: ReactElement[] }>[]
  const children = groups.flatMap((group) => group.props.children.flat())
  const batches = children.filter((child) => child?.type === AgentFilingResult) as ReactElement<
    Parameters<typeof AgentFilingResult>[0]
  >[]
  expect(batches).toHaveLength(2)
  batches[0].props.onUndo()
  batches[1].props.onUndo()
  expect(onUndoFiling.mock.calls).toEqual([
    ['conversation', 'first'],
    ['conversation', 'second'],
  ])
  const [ordinary] = children.filter((child) => child?.type === AgentChanges) as ReactElement<
    Parameters<typeof AgentChanges>[0]
  >[]
  expect(ordinary.props.messages.map((item) => item.change?.id)).toEqual(['unrelated'])
  const clipped = renderToStaticMarkup(
    createElement(AgentTranscript, { ...props, messages: [props.messages[2]] }),
  )
  expect(clipped).toContain('agent-filing-result')
  expect(clipped).not.toContain('class="agent-changes"')
  expect(clipped).not.toContain('class="agent-quiet"')
})

it('keeps unresolved operations visible after all confirmed changes have been undone', () => {
  const filing: AgentFiling = {
    id: 'batch',
    version: 1,
    state: 'failed',
    createdAt: 1,
    fileCount: 2,
    changes: [{ id: 'a', kind: 'move', source: 'Inbox/a.pdf', path: 'Filed/a.pdf', undone: true }],
    unresolved: [
      { id: 'b', kind: 'move', source: 'Inbox/b.pdf', path: 'Filed/b.pdf', undone: false },
    ],
  }
  const props = { filing, disabled: false, onUndo: () => {}, onOpenFile: () => {} }
  const html = renderToStaticMarkup(createElement(AgentFilingResult, props))
  expect(html).toContain('agent.organization.unresolved')
  expect(html).toContain('agent.organization.unresolvedHelp')
  expect(html).toContain('Inbox/b.pdf → Filed/b.pdf')
  expect(html).not.toContain('agent.organization.undone')
  expect(html).not.toContain('data-undone="true"><details')
  expect(html).not.toContain('agent-filing-undo')
  const partial = renderToStaticMarkup(
    createElement(AgentFilingResult, {
      ...props,
      filing: {
        ...filing,
        changes: filing.changes.map((change) => ({ ...change, undone: false })),
      },
    }),
  )
  expect(partial).toContain('agent.organization.undoConfirmed')
  expect(partial.match(/class="[^"]*agent-filing-undo/g)).toHaveLength(1)
  expect(partial).not.toContain('class="agent-quiet"')
})
