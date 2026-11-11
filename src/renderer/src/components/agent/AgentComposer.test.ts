import { createElement, type ComponentProps } from 'react'
import { parseHTML } from 'linkedom'
import { expect, it, vi } from 'vitest'
import { AgentComposer } from './AgentComposer'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('./AgentModelMenu', () => ({ AgentModelMenu: () => null }))
vi.mock('../ui/Select', () => ({ Select: () => null }))

it('keeps one size observer while typing and refits only for content or width changes', async () => {
  const { window } = parseHTML('<html><body><div id="root"></div></body></html>')
  vi.stubGlobal('window', window)
  vi.stubGlobal('document', window.document)
  let width = 400
  let height = 60
  const readHeight = vi.fn(() => height)
  const observe = vi.fn()
  const disconnect = vi.fn()
  let resized!: () => void
  const observer = vi.fn(function (callback: () => void) {
    resized = callback
    return { observe, disconnect }
  })
  vi.stubGlobal('ResizeObserver', observer)
  const props: ComponentProps<typeof AgentComposer> = {
    draft: '',
    context: {},
    setup: null,
    provider: 'claude',
    running: false,
    interrupting: false,
    busy: false,
    loading: false,
    modelLoad: { status: 'idle' },
    canSend: false,
    connected: false,
    focusKey: null,
    attachments: [],
    receivingFiles: false,
    draggingFiles: false,
    onDraft: vi.fn(),
    onSend: vi.fn(),
    onStop: vi.fn(),
    onProvider: vi.fn(),
    onSettings: vi.fn(),
    onLoadModels: vi.fn(),
    onModelChange: vi.fn(),
    onRemoveContext: vi.fn(),
    onOpenFile: vi.fn(),
    onPasteAttachments: vi.fn(async () => false),
    onRemoveAttachment: vi.fn(),
  }
  const { createRoot } = await import('react-dom/client')
  const { flushSync } = await import('react-dom')
  const root = createRoot(window.document.getElementById('root')!)
  const update = (draft: string) =>
    flushSync(() => root.render(createElement(AgentComposer, { ...props, draft })))
  try {
    update('')
    const input = window.document.querySelector('textarea')!
    Object.defineProperties(input, {
      clientWidth: { get: () => width },
      scrollHeight: { get: readHeight },
    })
    update('Hello')
    expect(input.style.height).toBe('60px')
    expect(observe).toHaveBeenCalledWith(input)
    height = 200
    update('Hello\nWorld')
    expect(input.style.height).toBe('132px')
    height = 20
    update('H')
    expect(input.style.height).toBe('38px')
    expect(observer).toHaveBeenCalledTimes(1)
    expect(disconnect).not.toHaveBeenCalled()

    resized()
    readHeight.mockClear()
    resized()
    expect(readHeight).not.toHaveBeenCalled()
    width = 300
    height = 100
    resized()
    expect(input.style.height).toBe('100px')
    expect(observer).toHaveBeenCalledTimes(1)
  } finally {
    flushSync(() => root.unmount())
    expect(disconnect).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  }
})
