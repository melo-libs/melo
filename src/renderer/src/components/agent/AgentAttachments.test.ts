import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { AgentAttachments } from './AgentAttachments'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

it.each([false, true])(
  'shows full filenames for documents and images before and after sending (sent=%s)',
  (sent) => {
    const html = renderToStaticMarkup(
      createElement(AgentAttachments, {
        files: [
          { id: 'csv', name: '客户问题_03.24_v2.csv', size: 1024 },
          { id: 'image', name: 'reference.png', size: 2048 },
        ],
        onOpen: sent ? () => {} : undefined,
      }),
    )
    expect(html).toContain('<strong title="客户问题_03.24_v2.csv">客户问题_03.24_v2.csv</strong>')
    expect(html).toContain('<strong title="reference.png">reference.png</strong>')
    expect(html).toContain('1.0 KB')
    if (sent) expect(html).toContain('aria-label="客户问题_03.24_v2.csv"')
  },
)
