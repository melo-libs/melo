import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import type { AgentHistoryMessage } from '@shared/types/agent'
import { AgentChanges } from './AgentChanges'
import { AgentTranscript } from './AgentTranscript'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}))

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

it('keeps a source boundary for a new selection in the same note, but not for plain follow-ups', () => {
  const html = renderToStaticMarkup(
    createElement(AgentTranscript, {
      messages: [message('1'), message('2'), message('3', 'A different passage'), message('4')],
      running: false,
      activeWorkspace: '/notes',
      busy: false,
      highlight: null,
      onOpenFile: () => {},
      onOpenMessage: () => {},
      onUndo: () => {},
      onDelete: () => {},
    }),
  )
  expect(html.match(/class="agent-source-divider"/g)).toHaveLength(2)
  const boundary = html.lastIndexOf('class="agent-source-divider"')
  expect(boundary).toBeLessThan(html.indexOf('A different passage'))
  expect(html.slice(boundary)).toContain('<strong>Ideas</strong>')
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
