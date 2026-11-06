import { createElement } from 'react'
import { parseHTML } from 'linkedom'
import { afterEach, expect, it, vi } from 'vitest'
import { Favicon } from './Favicon'

afterEach(() => vi.unstubAllGlobals())

it('retries a failed favicon after switching away and back', async () => {
  const { window } = parseHTML('<html><body><div id="root"></div></body></html>')
  vi.stubGlobal('window', window)
  vi.stubGlobal('document', window.document)
  const { createRoot } = await import('react-dom/client')
  const { flushSync } = await import('react-dom')
  const container = window.document.getElementById('root')!
  const root = createRoot(container)
  const render = (path?: string) => flushSync(() => root.render(createElement(Favicon, { path })))

  try {
    const path = '.assets/favicon.svg'
    render(path)
    flushSync(() => container.querySelector('img')!.dispatchEvent(new window.Event('error')))
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('svg')).not.toBeNull()

    render(path)
    expect(container.querySelector('img')).toBeNull()

    render('.assets/other.svg')
    render(path)
    await vi.waitFor(() =>
      expect(container.querySelector('img')?.getAttribute('src')).toBe(
        `app://${encodeURIComponent(path)}`,
      ),
    )
  } finally {
    flushSync(() => root.unmount())
  }
})
