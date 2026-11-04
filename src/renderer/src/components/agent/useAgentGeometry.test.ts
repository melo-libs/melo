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
