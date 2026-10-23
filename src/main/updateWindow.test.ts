import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  windows: [] as Array<
    EventEmitter & {
      show: ReturnType<typeof vi.fn>
      showInactive: ReturnType<typeof vi.fn>
      focus: ReturnType<typeof vi.fn>
      close: ReturnType<typeof vi.fn>
      getSize: ReturnType<typeof vi.fn>
      setSize: ReturnType<typeof vi.fn>
      setMinimumSize: ReturnType<typeof vi.fn>
      options: { width: number; height: number; minHeight: number }
    }
  >,
}))
vi.mock('electron', () => ({
  nativeTheme: { shouldUseDarkColors: false },
  BrowserWindow: class extends EventEmitter {
    webContents = { setWindowOpenHandler: vi.fn(), on: vi.fn() }
    show = vi.fn()
    showInactive = vi.fn()
    focus = vi.fn()
    restore = vi.fn()
    close = vi.fn(() => this.emit('closed'))
    isDestroyed = () => false
    isMinimized = () => false
    loadFile = vi.fn()
    getSize = vi.fn(() => [this.options.width, this.options.height])
    setSize = vi.fn()
    setMinimumSize = vi.fn()
    constructor(public options: { width: number; height: number; minHeight: number }) {
      super()
      mocks.windows.push(this)
    }
  },
}))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ theme: 'light' }) }))

beforeEach(() => {
  vi.resetModules()
  mocks.windows.length = 0
})

describe('single-instance update window', () => {
  it('does not create or focus another window on repeated automatic requests', async () => {
    const { openUpdateWindow } = await import('./updateWindow')
    openUpdateWindow(false)
    const window = mocks.windows[0]
    window.emit('ready-to-show')
    openUpdateWindow(false)
    expect(mocks.windows).toHaveLength(1)
    expect(window.showInactive).toHaveBeenCalledOnce()
    expect(window.focus).not.toHaveBeenCalled()
    openUpdateWindow(true)
    expect(mocks.windows).toHaveLength(1)
    expect(window.focus).toHaveBeenCalledOnce()
  })
  it('remembers a manual focus request while the first window is still loading', async () => {
    const { openUpdateWindow, closeUpdateWindow } = await import('./updateWindow')
    openUpdateWindow(false)
    openUpdateWindow(true)
    const window = mocks.windows[0]
    expect(window.show).not.toHaveBeenCalled()
    window.emit('ready-to-show')
    expect(window.show).toHaveBeenCalledOnce()
    expect(window.showInactive).not.toHaveBeenCalled()
    closeUpdateWindow()
    openUpdateWindow(true)
    expect(mocks.windows).toHaveLength(2)
  })
  it('starts compact and expands the same window when a release appears', async () => {
    const { openUpdateWindow, resizeUpdateWindow } = await import('./updateWindow')
    openUpdateWindow(true, false)
    const window = mocks.windows[0]
    expect(window.options).toMatchObject({ height: 260, minHeight: 260 })
    resizeUpdateWindow(true)
    expect(mocks.windows).toHaveLength(1)
    expect(window.setMinimumSize).toHaveBeenLastCalledWith(520, 460)
    expect(window.setSize).toHaveBeenLastCalledWith(560, 520)
    expect(window.show).not.toHaveBeenCalled()
    window.emit('ready-to-show')
    expect(window.show).toHaveBeenCalledOnce()
  })
  it('preserves the user size through progress and repeated focus requests', async () => {
    const { openUpdateWindow, resizeUpdateWindow } = await import('./updateWindow')
    openUpdateWindow(false, true)
    const window = mocks.windows[0]
    expect(window.options).toMatchObject({ height: 520, minHeight: 460 })
    window.getSize.mockReturnValue([640, 610])
    resizeUpdateWindow(true)
    openUpdateWindow(true, true)
    expect(window.setSize).not.toHaveBeenCalled()
    resizeUpdateWindow(false)
    expect(window.setMinimumSize).toHaveBeenLastCalledWith(520, 260)
    expect(window.setSize).toHaveBeenLastCalledWith(640, 260)
    resizeUpdateWindow(false)
    expect(window.setSize).toHaveBeenCalledOnce()
  })
  it('does not create a window merely to synchronize its size', async () => {
    const { resizeUpdateWindow } = await import('./updateWindow')
    resizeUpdateWindow(true)
    expect(mocks.windows).toHaveLength(0)
  })
})
