import { createElement, useState } from 'react'
import { parseHTML } from 'linkedom'
import { expect, it, vi } from 'vitest'
import { useAgentGeometry } from './useAgentGeometry'

it('cancels a queued drag frame when the panel closes before pointer release', async () => {
  const { window } = parseHTML('<html><body><div id="root"></div></body></html>')
  const frames = new Map<number, FrameRequestCallback>()
  let frameId = 0
  vi.stubGlobal('window', window)
  vi.stubGlobal('document', window.document)
  vi.stubGlobal('Element', window.Element)
  vi.stubGlobal('MutationObserver', window.MutationObserver)
  const savePosition = vi.fn()
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: savePosition })
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn()
      disconnect = vi.fn()
    },
  )
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback)
    return frameId
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  window.innerWidth = 1000
  window.innerHeight = 900
  const { createRoot } = await import('react-dom/client')
  const { flushSync } = await import('react-dom')
  let setOpen!: (open: boolean) => void
  function Panel() {
    const [open, updateOpen] = useState(true)
    setOpen = updateOpen
    const geometry = useAgentGeometry(open, null, true)
    return open ? createElement('div', { ref: geometry.panel, onPointerDown: geometry.drag }) : null
  }
  const root = createRoot(window.document.getElementById('root')!)
  const pointer = (type: string, x: number, y: number) =>
    Object.assign(new window.Event(type, { bubbles: true }), {
      button: 0,
      pointerId: 1,
      clientX: x,
      clientY: y,
    })
  try {
    flushSync(() => root.render(createElement(Panel)))
    const panel = window.document.getElementById('root')!.firstElementChild!
    Object.defineProperties(panel, {
      offsetWidth: { value: 48 },
      offsetHeight: { value: 48 },
      offsetLeft: { value: 932 },
      offsetTop: { value: 832 },
    })
    panel.dispatchEvent(pointer('pointerdown', 950, 850))
    window.dispatchEvent(pointer('pointermove', 850, 750))
    window.dispatchEvent(pointer('pointerup', 850, 750))
    expect(savePosition).toHaveBeenCalledWith('melo.agent.dock-position', '832,732')
    expect(frames.size).toBe(0)
    panel.dispatchEvent(pointer('pointerdown', 950, 850))
    window.dispatchEvent(pointer('pointermove', 850, 750))
    expect(frames.size).toBe(1)
    expect(() => flushSync(() => setOpen(false))).not.toThrow()
    expect(frames.size).toBe(0)
    expect(savePosition).toHaveBeenCalledTimes(1)
    window.dispatchEvent(pointer('pointermove', 800, 700))
    expect(frames.size).toBe(0)
  } finally {
    flushSync(() => root.unmount())
    vi.unstubAllGlobals()
  }
})

it.each(['blur', 'pointercancel'])(
  'preserves the preference through layout changes and cancelled drags (%s)',
  async (cancelEvent) => {
    const { window } = parseHTML(
      '<html><body><div id="root"></div><div id="footer" data-floating-obstacle></div><div id="zoom" data-floating-obstacle></div></body></html>',
    )
    vi.stubGlobal('window', window)
    vi.stubGlobal('document', window.document)
    vi.stubGlobal('Element', window.Element)
    vi.stubGlobal('MutationObserver', window.MutationObserver)
    vi.stubGlobal('getComputedStyle', () => ({ visibility: 'visible' }))
    let dragFrame!: FrameRequestCallback
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      dragFrame = callback
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const savePosition = vi.fn()
    vi.stubGlobal('localStorage', { getItem: () => '920,820', setItem: savePosition })
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = vi.fn()
        unobserve = vi.fn()
        disconnect = vi.fn()
      },
    )
    window.innerWidth = 1000
    window.innerHeight = 900
    const footer = window.document.getElementById('footer')!
    const zoom = window.document.getElementById('zoom')!
    Object.assign(footer, {
      getBoundingClientRect: () => ({ x: 0, y: 872, width: 1000, height: 28 }),
    })
    Object.assign(zoom, {
      getBoundingClientRect: () => ({ x: 800, y: 800, width: 180, height: 40 }),
    })
    const { createRoot } = await import('react-dom/client')
    const { flushSync } = await import('react-dom')
    function Panel() {
      const geometry = useAgentGeometry(true, null, true)
      return createElement('div', { ref: geometry.panel, onPointerDown: geometry.drag })
    }
    const root = createRoot(window.document.getElementById('root')!)
    try {
      flushSync(() => root.render(createElement(Panel)))
      const panel = window.document.getElementById('root')!.firstElementChild as HTMLElement
      Object.defineProperties(panel, { offsetWidth: { value: 48 }, offsetHeight: { value: 48 } })
      window.dispatchEvent(new window.Event('resize'))
      expect([panel.style.left, panel.style.top]).toEqual(['920px', '740px'])
      zoom.remove()
      await vi.waitFor(() => expect(panel.style.top).toBe('812px'))
      footer.remove()
      await vi.waitFor(() => expect(panel.style.top).toBe('820px'))
      window.innerWidth = 800
      window.innerHeight = 700
      window.dispatchEvent(new window.Event('resize'))
      expect([panel.style.left, panel.style.top]).toEqual(['720px', '620px'])
      window.innerWidth = 1000
      window.innerHeight = 900
      window.dispatchEvent(new window.Event('resize'))
      expect([panel.style.left, panel.style.top]).toEqual(['920px', '820px'])
      const pointer = (type: string, y: number) =>
        Object.assign(new window.Event(type, { bubbles: true }), {
          button: 0,
          pointerId: 1,
          clientX: 940,
          clientY: y,
        })
      Object.defineProperties(panel, {
        offsetLeft: { get: () => parseFloat(panel.style.left) },
        offsetTop: { get: () => parseFloat(panel.style.top) },
      })
      panel.dispatchEvent(pointer('pointerdown', 840))
      window.dispatchEvent(pointer('pointermove', 720))
      dragFrame(0)
      expect(panel.style.top).toBe('700px')
      window.dispatchEvent(new window.Event(cancelEvent))
      expect([panel.style.left, panel.style.top]).toEqual(['920px', '820px'])
      expect(savePosition).not.toHaveBeenCalled()
    } finally {
      flushSync(() => root.unmount())
      vi.unstubAllGlobals()
    }
  },
)
