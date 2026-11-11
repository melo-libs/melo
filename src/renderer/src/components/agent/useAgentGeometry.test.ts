import { createElement, useState } from 'react'
import { parseHTML } from 'linkedom'
import { expect, it, vi } from 'vitest'
import { useAgentGeometry } from './useAgentGeometry'
import type { AgentPanelMode } from '../../lib/agentPanelLayout'

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
    const geometry = useAgentGeometry(open, null, true, {
      docked: false,
      maxWidth: 600,
      onMode: vi.fn(),
      onWidth: vi.fn(),
    })
    return open ? createElement('div', { ref: geometry.panel, onPointerDown: geometry.drag }) : null
  }
  const root = createRoot(window.document.getElementById('root')!)
  const pointer = (type: string, x: number, y: number) =>
    Object.assign(new window.Event(type, { bubbles: true }), {
      button: 0,
      buttons: type === 'pointerup' ? 0 : 1,
      pointerId: 1,
      clientX: x,
      clientY: y,
    })
  try {
    flushSync(() => root.render(createElement(Panel)))
    const panel = window.document.getElementById('root')!.firstElementChild as HTMLElement
    Object.defineProperties(panel, {
      offsetWidth: { value: 48 },
      offsetHeight: { value: 48 },
      offsetLeft: { value: 932 },
      offsetTop: { value: 832 },
    })
    panel.getBoundingClientRect = () =>
      ({ left: panel.offsetLeft, top: panel.offsetTop }) as DOMRect
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
      const geometry = useAgentGeometry(true, null, true, {
        docked: false,
        maxWidth: 600,
        onMode: vi.fn(),
        onWidth: vi.fn(),
      })
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
      panel.getBoundingClientRect = () =>
        ({ left: panel.offsetLeft, top: panel.offsetTop }) as DOMRect
      const pointer = (type: string, y: number) =>
        Object.assign(new window.Event(type, { bubbles: true }), {
          button: 0,
          buttons: type === 'pointerup' ? 0 : 1,
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

async function panelFixture(initiallyDocked = false, maxWidth = 600) {
  const { window } = parseHTML('<html><body><div id="root" class="app"></div></body></html>')
  vi.stubGlobal('window', window)
  vi.stubGlobal('document', window.document)
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() })
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn()
      disconnect = vi.fn()
    },
  )
  const frames = new Map<number, FrameRequestCallback>()
  let nextFrame = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback)
    return nextFrame
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  window.innerWidth = 1200
  window.innerHeight = 900
  const { createRoot } = await import('react-dom/client')
  const { flushSync } = await import('react-dom')
  const onMode = vi.fn()
  const onWidth = vi.fn()
  function Panel() {
    const [mode, setMode] = useState<AgentPanelMode>(initiallyDocked ? 'docked' : 'floating')
    const geometry = useAgentGeometry(true, null, false, {
      docked: mode === 'docked',
      maxWidth,
      onMode: (mode) => {
        onMode(mode)
        setMode(mode)
      },
      onWidth,
    })
    return createElement(
      'div',
      {
        ref: geometry.panel,
        'data-docked': mode === 'docked' || undefined,
        'data-preview': geometry.dockPreview !== null || undefined,
      },
      createElement('header', { onPointerDown: geometry.drag }),
      createElement('button', { onPointerDown: geometry.resize }),
      createElement('textarea', { defaultValue: 'Unsent draft' }),
    )
  }
  const root = createRoot(window.document.getElementById('root')!)
  flushSync(() => root.render(createElement(Panel)))
  const panel = window.document.getElementById('root')!.firstElementChild as HTMLElement
  const inGrid = () =>
    panel.hasAttribute('data-docked') && !panel.hasAttribute('data-floating-drag')
  Object.defineProperties(panel, {
    offsetWidth: { get: () => (inGrid() ? 420 : parseFloat(panel.style.width) || 500) },
    offsetHeight: { get: () => (inGrid() ? 900 : parseFloat(panel.style.height) || 720) },
    offsetLeft: { get: () => (inGrid() ? 780 : parseFloat(panel.style.left) || 600) },
    offsetTop: { get: () => (inGrid() ? 0 : parseFloat(panel.style.top) || 92) },
    getBoundingClientRect: {
      value: () => ({ left: panel.offsetLeft, top: inGrid() ? 77 : panel.offsetTop }),
    },
  })
  panel.parentElement!.getBoundingClientRect = () => ({ top: 77 }) as DOMRect
  let lastX = 0,
    lastY = 0
  const pointer = (
    target: Element | Window,
    type: string,
    x: number,
    y: number,
    buttons = type === 'pointerup' ? 0 : 1,
  ) => {
    if ((type === 'pointerdown' || type === 'pointermove') && buttons === 1) {
      lastX = x
      lastY = y
    }
    flushSync(() =>
      target.dispatchEvent(
        Object.assign(new window.Event(type, { bubbles: true }), {
          button: 0,
          buttons,
          pointerId: 1,
          clientX: x,
          clientY: y,
        }),
      ),
    )
    flushSync(() => {
      for (const [id, callback] of frames) {
        frames.delete(id)
        callback(0)
      }
    })
  }
  return {
    panel,
    onMode,
    onWidth,
    drag: (x: number, y: number) => pointer(panel.querySelector('header')!, 'pointerdown', x, y),
    resize: (x: number) => pointer(panel.querySelector('button')!, 'pointerdown', x, 100),
    move: (x: number, y: number, buttons = 1) => pointer(window, 'pointermove', x, y, buttons),
    stop: (type = 'pointerup', x = lastX, y = lastY) => pointer(window, type, x, y),
    close: () => {
      flushSync(() => root.unmount())
      vi.unstubAllGlobals()
    },
  }
}

it('previews and commits docking only on release, without replacing the draft', async () => {
  const fixture = await panelFixture()
  try {
    const draft = fixture.panel.querySelector('textarea')!
    fixture.drag(700, 110)
    fixture.move(1180, 200)
    expect(fixture.panel.hasAttribute('data-preview')).toBe(true)
    expect(fixture.onMode).not.toHaveBeenCalled()
    fixture.stop()
    expect(fixture.onMode).toHaveBeenCalledWith('docked')
    expect(fixture.panel.querySelector('textarea')).toBe(draft)
    expect(fixture.panel.hasAttribute('data-preview')).toBe(false)
    expect(fixture.panel.style.getPropertyValue('left') || '').toBe('')
  } finally {
    fixture.close()
  }
})

it.each(['blur', 'pointercancel'])(
  'restores a docked panel when drag is cancelled by %s',
  async (event) => {
    const fixture = await panelFixture(true)
    try {
      const style = fixture.panel.getAttribute('style')
      fixture.drag(880, 97)
      fixture.move(700, 200)
      expect(fixture.panel.hasAttribute('data-floating-drag')).toBe(true)
      fixture.stop(event)
      expect(fixture.onMode).not.toHaveBeenCalled()
      expect(fixture.panel.getAttribute('style')).toBe(style)
      expect(fixture.panel.hasAttribute('data-floating-drag')).toBe(false)
    } finally {
      fixture.close()
    }
  },
)

it('detaches a sidebar and keeps its existing mounted content', async () => {
  const fixture = await panelFixture(true)
  try {
    const draft = fixture.panel.querySelector('textarea')!
    fixture.drag(880, 97)
    fixture.move(700, 200)
    fixture.stop()
    expect(fixture.onMode).toHaveBeenCalledWith('floating')
    expect(fixture.panel.hasAttribute('data-docked')).toBe(false)
    expect(fixture.panel.querySelector('textarea')).toBe(draft)
    expect(fixture.panel.style.left).toBe('600px')
    expect(fixture.panel.style.top).toBe('168px')
  } finally {
    fixture.close()
  }
})

it('does not offer docking when the viewport cannot fit it', async () => {
  const fixture = await panelFixture(false, 350)
  try {
    fixture.drag(700, 110)
    fixture.move(1180, 200)
    expect(fixture.panel.hasAttribute('data-preview')).toBe(false)
    fixture.stop()
    expect(fixture.onMode).toHaveBeenCalledWith('floating')
  } finally {
    fixture.close()
  }
})

it('resizes a sidebar from its left edge and bounds its width', async () => {
  const fixture = await panelFixture(true, 500)
  try {
    fixture.resize(780)
    fixture.move(500, 100)
    expect(fixture.onWidth).not.toHaveBeenCalled()
    expect(fixture.panel.parentElement!.style.getPropertyValue('--agent-layout-w')).toBe('500px')
    fixture.move(490, 100)
    expect(fixture.onWidth).not.toHaveBeenCalled()
    fixture.stop()
    expect(fixture.onWidth).toHaveBeenCalledTimes(1)
    expect(fixture.onWidth).toHaveBeenLastCalledWith(500)
    expect(fixture.onMode).not.toHaveBeenCalled()
  } finally {
    fixture.close()
  }
})

it('ignores moves without the pressed button and commits the release position', async () => {
  const fixture = await panelFixture(true)
  try {
    fixture.resize(780)
    fixture.move(760, 100)
    fixture.move(0, 0, 0)
    expect(fixture.panel.parentElement!.style.getPropertyValue('--agent-layout-w')).toBe('440px')
    fixture.stop('pointerup', 740, 100)
    expect(fixture.onWidth).toHaveBeenCalledTimes(1)
    expect(fixture.onWidth).toHaveBeenLastCalledWith(460)
    expect(fixture.panel.parentElement!.style.getPropertyValue('--agent-layout-w')).toBe('460px')
  } finally {
    fixture.close()
  }
})

it.each(['pointerup', 'pointercancel', 'blur'])(
  'restores the cursor and selection style when a sidebar resize ends with %s',
  async (event) => {
    const fixture = await panelFixture(true)
    try {
      document.body.style.cursor = 'crosshair'
      document.body.style.userSelect = 'text'
      fixture.resize(780)
      expect(document.body.style.cursor).toBe('col-resize')
      expect(document.body.style.userSelect).toBe('none')
      fixture.move(700, 100)
      fixture.stop(event)
      expect(document.body.style.cursor).toBe('crosshair')
      expect(document.body.style.userSelect).toBe('text')
    } finally {
      fixture.close()
    }
  },
)
