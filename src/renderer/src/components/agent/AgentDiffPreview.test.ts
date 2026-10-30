import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createTwoFilesPatch } from 'diff'
import { expect, it, vi } from 'vitest'
import { AgentDiffPreview } from './AgentDiffPreview'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
const render = (before: string, after: string) =>
  renderToStaticMarkup(
    createElement(AgentDiffPreview, {
      source: createTwoFilesPatch('目录/中文.md', '目录/中文.md', before, after),
    }),
  )

it('shows full changed paragraphs with precise Chinese highlights and no raw patch headers', () => {
  const html = render(
    '# 标题\n\n将读到的、想到的，变成自己的东西。\n\n未改动的内容\n',
    '# 标题\n\n把读到的、想到的，变成自己的东西。\n\n未改动的内容\n',
  )
  expect(html).toContain('<mark>将</mark>')
  expect(html).toContain('<mark>把</mark>')
  expect(html).toContain('读到的、想到的，变成自己的东西。')
  expect(html).toContain('agent.diffBefore')
  expect(html).toContain('agent.diffAfter')
  expect(html).not.toContain('+++')
  expect(html).not.toContain('@@')
  expect(html).toContain('<details class="agent-diff-context">')
})
it('keeps inserted and deleted text safe and complete', () => {
  const html = render('Keep\nRemove <script>\n', 'Keep\n<img src="tracker">\n')
  expect(html).not.toContain('<script>')
  expect(html).not.toContain('<img')
  expect(html).toContain('&lt;')
  expect(html).toContain('data-kind="removed"')
  expect(html).toContain('data-kind="added"')
})
it('retains blank-line, whitespace and final-newline changes', () => {
  expect(render('One\nTwo\n', 'One\n\nTwo\n')).toContain('agent.diffWhitespaceLegend')
  expect(render('One two\n', 'One  two\n')).toContain('agent.diffWhitespace')
  const html = render('One', 'One\n')
  expect(html).toContain('agent.diffNoNewline')
  expect(html).toContain('agent.diffNewline')
})
it('falls back visibly rather than silently dropping an unreadable preview', () => {
  const html = renderToStaticMarkup(
    createElement(AgentDiffPreview, { source: 'unreadable <patch>' }),
  )
  expect(html).toContain('agent.diffRaw')
  expect(html).toContain('unreadable &lt;patch&gt;')
})

it('keeps malformed patch changes visible instead of reporting zero changes', () => {
  const html = renderToStaticMarkup(
    createElement(AgentDiffPreview, { source: '--- n.md\n+++ n.md\n-old\n+new\n' }),
  )
  expect(html).toContain('agent.diffRaw')
  expect(html).toContain('-old')
  expect(html).toContain('+new')
  expect(html).not.toContain('agent.diffUnchanged')
})
it('distinguishes spaces from tabs when a whole line is whitespace', () => {
  const html = render('    \n', '\t\n')
  expect(html).toContain('····↵')
  expect(html).toContain('⇥↵')
  expect(html).toContain('agent.diffWhitespaceLegend')
})
