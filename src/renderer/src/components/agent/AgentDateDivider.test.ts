import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { parseHTML } from 'linkedom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AgentDateDivider } from './AgentDateDivider'

let language = 'en'
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language },
    t: (key: string) =>
      key === 'agent.historyToday'
        ? language === 'en'
          ? 'Today'
          : '今天'
        : language === 'en'
          ? 'Yesterday'
          : '昨天',
  }),
}))

beforeEach(() => {
  language = 'en'
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 10, 11, 12))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it.each(['en', 'zh-CN'])('labels local calendar days in %s', (locale) => {
  language = locale
  const render = (day: number) =>
    renderToStaticMarkup(
      createElement(AgentDateDivider, { at: new Date(2026, 10, day, 0, 1).getTime() }),
    )
  expect(render(11)).toContain(locale === 'en' ? 'Today' : '今天')
  expect(render(10)).toContain(locale === 'en' ? 'Yesterday' : '昨天')
  expect(render(9)).toContain(locale === 'en' ? 'Nov 9, 2026' : '2026年11月9日')
})

it('updates relative dates after local midnight while the window stays open', async () => {
  vi.setSystemTime(new Date(2026, 10, 11, 23, 59, 59))
  const { window } = parseHTML('<html><body><div id="root"></div></body></html>')
  vi.stubGlobal('window', window)
  vi.stubGlobal('document', window.document)
  const { createRoot } = await import('react-dom/client')
  const { flushSync } = await import('react-dom')
  const container = window.document.getElementById('root')!
  const root = createRoot(container)
  try {
    flushSync(() =>
      root.render(createElement(AgentDateDivider, { at: new Date(2026, 10, 11, 10).getTime() })),
    )
    expect(container.textContent).toBe('Today')
    flushSync(() => vi.advanceTimersByTime(1000))
    expect(container.textContent).toBe('Yesterday')
  } finally {
    flushSync(() => root.unmount())
  }
})
