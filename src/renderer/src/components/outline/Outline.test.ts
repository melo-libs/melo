import { createElement } from 'react'
import { createStore, Provider } from 'jotai'
import { parseHTML } from 'linkedom'
import { expect, it, vi } from 'vitest'
import { tocAtom } from '../../store/toc'
import { Outline } from './Outline'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

it('reveals a current heading reported after opening without rebuilding the size observer', async () => {
  const { window } = parseHTML('<html><body><div id="root"></div></body></html>')
  vi.stubGlobal('window', window)
  vi.stubGlobal('document', window.document)
  const prototype = window.HTMLElement.prototype
  const originalScroll = Object.getOwnPropertyDescriptor(prototype, 'scrollIntoView')
  const originalFocus = Object.getOwnPropertyDescriptor(prototype, 'focus')
  prototype.focus = function () {
    Object.defineProperty(window.document, 'activeElement', { configurable: true, value: this })
  }
  const scrolled: string[] = []
  prototype.scrollIntoView = function () {
    scrolled.push(this.textContent ?? '')
  }
  const disconnect = vi.fn()
  const observer = vi.fn(function () {
    return { observe: vi.fn(), disconnect }
  })
  vi.stubGlobal('ResizeObserver', observer)
  const store = createStore()
  const headings = [
    { id: 'first', text: 'First', level: 1, active: true },
    { id: 'second', text: 'Second', level: 2, active: false },
    { id: 'third', text: 'Third', level: 2, active: false },
  ]
  store.set(tocAtom, headings)
  const { createRoot } = await import('react-dom/client')
  const { flushSync } = await import('react-dom')
  const root = createRoot(window.document.getElementById('root')!)
  try {
    flushSync(() => root.render(createElement(Provider, { store }, createElement(Outline))))
    const trigger = window.document.querySelector<HTMLButtonElement>('.doc-outline-trigger')!
    flushSync(() => trigger.click())
    expect(scrolled).toEqual(['First'])
    flushSync(() =>
      store.set(
        tocAtom,
        headings.map((item) => ({ ...item, active: item.id === 'second' })),
      ),
    )
    expect(scrolled).toEqual(['First', 'Second'])
    const down = Object.assign(new window.Event('keydown', { bubbles: true }), { key: 'ArrowDown' })
    flushSync(() => window.document.activeElement!.dispatchEvent(down))
    expect(window.document.activeElement!.textContent).toBe('Third')
    flushSync(() => store.set(tocAtom, headings))
    expect(window.document.activeElement!.textContent).toBe('Third')
    expect(scrolled).toEqual(['First', 'Second', 'Third'])
    expect(observer).toHaveBeenCalledTimes(1)
  } finally {
    flushSync(() => root.unmount())
    if (originalScroll) Object.defineProperty(prototype, 'scrollIntoView', originalScroll)
    else delete (prototype as Partial<HTMLElement>).scrollIntoView
    if (originalFocus) Object.defineProperty(prototype, 'focus', originalFocus)
    else delete (prototype as Partial<HTMLElement>).focus
    vi.unstubAllGlobals()
  }
  expect(disconnect).toHaveBeenCalledTimes(1)
})
