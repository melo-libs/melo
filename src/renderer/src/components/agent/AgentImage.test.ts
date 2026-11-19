import { createElement } from 'react'
import { parseHTML } from 'linkedom'
import { expect, it, vi } from 'vitest'
import { AgentImage } from './AgentImage'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

it('does not reuse an image from a previous workspace and opens the resolved image in the viewer', async () => {
  const { window } = parseHTML('<html><body><div id="root"></div></body></html>')
  vi.stubGlobal('window', window)
  vi.stubGlobal('document', window.document)
  vi.stubGlobal('CustomEvent', window.CustomEvent)
  let first!: (value: { success: boolean; data: { imagePreview: string } }) => void
  const invoke = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          first = resolve
        }),
    )
    .mockResolvedValueOnce({ success: true, data: { imagePreview: 'data:image/png;base64,bmV3' } })
  Object.assign(window, { api: { invoke } })
  const { createRoot } = await import('react-dom/client')
  const { flushSync } = await import('react-dom')
  const root = createRoot(window.document.getElementById('root')!)
  const render = (workspaceRoot: string) =>
    flushSync(() =>
      root.render(
        createElement(AgentImage, { source: 'Inbox/a.png', alt: 'Reference', workspaceRoot }),
      ),
    )
  try {
    render('/old')
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1))
    render('/new')
    await vi.waitFor(() =>
      expect(window.document.querySelector('img')?.getAttribute('src')).toBe(
        'data:image/png;base64,bmV3',
      ),
    )
    first({ success: true, data: { imagePreview: 'data:image/png;base64,b2xk' } })
    await Promise.resolve()
    expect(window.document.querySelector('img')?.getAttribute('src')).toBe(
      'data:image/png;base64,bmV3',
    )
    const viewed = vi.fn()
    window.addEventListener('melo:image-view', viewed)
    window.document.querySelector('button')!.click()
    expect(viewed.mock.calls[0][0].detail.src).toBe('data:image/png;base64,bmV3')
  } finally {
    flushSync(() => root.unmount())
    vi.unstubAllGlobals()
  }
})

it('keeps a failed remote image visible with an explicit open action', async () => {
  const { window } = parseHTML('<html><body><div id="root"></div></body></html>')
  vi.stubGlobal('window', window)
  vi.stubGlobal('document', window.document)
  const invoke = vi.fn().mockResolvedValue({ success: true })
  Object.assign(window, { api: { invoke } })
  const { createRoot } = await import('react-dom/client')
  const { flushSync } = await import('react-dom')
  const root = createRoot(window.document.getElementById('root')!)
  try {
    flushSync(() =>
      root.render(
        createElement(AgentImage, {
          source: 'https://example.com/missing.png',
          alt: 'Reference',
        }),
      ),
    )
    window.document.querySelector('img')!.dispatchEvent(new window.Event('error'))
    await vi.waitFor(() =>
      expect(window.document.querySelector('[role="status"]')?.textContent).toContain(
        'Reference · agent.imageUnavailable',
      ),
    )
    expect(window.document.querySelector('img')).toBeNull()
    const link = window.document.querySelector('a')!
    expect(link.href).toBe('https://example.com/missing.png')
    link.click()
    expect(invoke).toHaveBeenCalledWith('invoke-open-external', { url: link.href })
  } finally {
    flushSync(() => root.unmount())
    vi.unstubAllGlobals()
  }
})
