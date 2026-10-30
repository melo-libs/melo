import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { AgentMessage } from './AgentMessage'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
const render = (content: string) =>
  renderToStaticMarkup(createElement(AgentMessage, { content, role: 'assistant', complete: true }))

describe('Agent reply rendering', () => {
  it('renders headings, lists, code, and tables without mounting an editor', () => {
    const html = render(
      '## A plan\n\n**Start here**\n\n- First\n- Second\n\n```js\nconst n = 1\n```\n\n| Day | Plan |\n| --- | --- |\n| Sat | Walk |',
    )
    expect(html).toContain('<h4>A plan</h4>')
    expect(html).toContain('<strong>Start here</strong>')
    expect(html).toContain('<li><p>First</p></li>')
    expect(html).toContain('<pre><code>const n = 1</code></pre>')
    expect(html).toContain('<table>')
  })
  it('does not activate model-provided HTML, images or executable links', () => {
    const html = render(
      '[unsafe](javascript:alert(1))\n\n![remote](https://example.com/tracker.png)\n\n<img src="https://example.com/raw.png" onerror="alert(1)">\n\n<script>alert(1)</script>',
    )
    expect(html).not.toContain('href="javascript:')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<script')
    expect(html).toContain('unsafe')
  })
})

it('keeps a quote and its source with the question', () => {
  const html = renderToStaticMarkup(
    createElement(AgentMessage, {
      content: 'What does this mean?',
      role: 'user',
      complete: true,
      context: { filePath: 'notes/Ideas.md', selection: 'Two ways to view the same files.' },
      onOpenFile: () => {},
    }),
  )
  expect(html).toContain(
    '<blockquote class="agent-selection">Two ways to view the same files.</blockquote>',
  )
  expect(html).toContain('Ideas.md')
  expect(html.indexOf('Two ways')).toBeLessThan(html.indexOf('What does this mean?'))
})
it('renders cited workspace documents as file actions instead of external URLs', () => {
  const html = renderToStaticMarkup(
    createElement(AgentMessage, {
      content: 'See [Packing](Travel/packing.md).',
      role: 'assistant',
      complete: true,
      onOpenFile: () => {},
    }),
  )
  expect(html).toContain('agent-inline-file')
  expect(html).not.toContain('agent-files')
  expect(html).not.toContain('href="https://Travel')
})

it('does not turn the conversation’s current document into a repeated message attachment', () => {
  const html = renderToStaticMarkup(
    createElement(AgentMessage, {
      content: 'Which model are you?',
      role: 'user',
      complete: true,
      context: { filePath: 'notes/Ideas.md' },
      onOpenFile: () => {},
    }),
  )
  expect(html).toContain('Which model are you?')
  expect(html).not.toContain('agent-quote')
  expect(html).not.toContain('Ideas.md')
})
