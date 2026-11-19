import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { AgentMessage } from './AgentMessage'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
const render = (content: string) =>
  renderToStaticMarkup(createElement(AgentMessage, { content, role: 'assistant', complete: true }))

describe('Agent reply rendering', () => {
  it('highlights the recommendation without highlighting its explanation or ordinary emphasis', () => {
    const html = render(
      '==建议放进参考资料下的“字节跳动”，文件名不改。==\n\n这里已有相关资料。**确认后再移动。**',
    )
    expect(html).toContain('<mark>建议放进参考资料下的“字节跳动”，文件名不改。</mark>')
    expect(html).toContain('<p>这里已有相关资料。<strong>确认后再移动。</strong></p>')
  })
  it('keeps code, escaped delimiters and incomplete streamed highlights literal', () => {
    const html = render(
      '`==literal==`\n\n```txt\n==code==\n```\n\n\\=\\=escaped\\=\\=\n\n==still streaming',
    )
    expect(html).not.toContain('<mark>')
    expect(html).toContain('<code>==literal==</code>')
    expect(html).toContain('<pre><code>==code==</code></pre>')
    expect(html).toContain('==escaped==')
    expect(html).toContain('==still streaming')
  })
  it('renders highlight contents through the same safe inline renderer', () => {
    const html = render('==**Keep this** [unsafe](javascript:alert) <script>alert(1)</script>==')
    expect(html).toContain('<mark>')
    expect(html).toContain('<strong>')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('href="javascript:')
  })
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
  it('renders Markdown images without activating raw HTML or executable links', () => {
    const html = render(
      '[unsafe](javascript:alert(1))\n\n![remote](https://example.com/tracker.png)\n\n<img src="https://example.com/raw.png" onerror="alert(1)">\n\n<script>alert(1)</script>',
    )
    expect(html).not.toContain('href="javascript:')
    expect(html).toContain('<img src="https://example.com/tracker.png"')
    expect(html).not.toContain('<img src="https://example.com/raw.png"')
    expect(html).not.toContain('<script')
    expect(html).toContain('unsafe')
  })

  it.each([
    ['**太阳纹，指的是车漆最外层清漆上的极细划痕。 **在阳光下可见。', '极细划痕。 '],
    ['**太阳纹。**在阳光下可见。', '太阳纹。'],
    ['**带“引号”**的内容', '带“引号”'],
  ])('renders model emphasis at punctuation and whitespace boundaries: %s', (source, text) => {
    const html = render(source)
    expect(html).toContain(text + '</strong>')
    expect(html).not.toContain('**')
  })

  it('preserves literal markers, code and unfinished streamed bold', () => {
    const html = render(
      '`**literal**`\n\n```md\n**code。 **\n```\n\n\\*\\*escaped\\*\\*\n\n**still streaming',
    )
    expect(html).not.toContain('<strong>')
    expect(html).toContain('<code>**literal**</code>')
    expect(html).toContain('**code。 **')
    expect(html).toContain('**escaped**')
    expect(html).toContain('**still streaming')
    expect(render('**before `a**b` after。 **next')).toContain(
      '<strong>before </strong><strong><code>a**b</code></strong><strong> after。 </strong>',
    )
  })

  it.each(['assistant', 'user'] as const)('renders safe images in %s messages', (role) => {
    const html = renderToStaticMarkup(
      createElement(AgentMessage, {
        content: '![Reference](https://example.com/reference.jpg)\n\n![unsafe](javascript:alert)',
        role,
        complete: true,
      }),
    )
    expect(html).toContain('<img src="https://example.com/reference.jpg"')
    expect(html).toContain('referrerPolicy="no-referrer"')
    expect(html).toContain('agent.imageUnavailable')
    expect(html).not.toContain('src="javascript:')
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
