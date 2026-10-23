import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createStore, Provider } from 'jotai'
import { parseHTML } from 'linkedom'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  INITIAL_UPDATE_STATE,
  IpcChannels,
  type IpcResponse,
  type UpdateState,
} from '@shared/types/ipc'
import { en } from '@shared/locales/en'
import { zhCN } from '@shared/locales/zh-CN'
import { AboutPane } from './panes'
import { UpdatesRoot } from '../updates/UpdatesRoot'

const mocks = vi.hoisted(() => ({ toast: vi.fn() }))
vi.mock('../Toaster', () => ({ toast: mocks.toast }))
vi.mock('../../lib/workspace', () => ({ loadTree: vi.fn() }))
const release = { version: '2.0.2', date: '2026-10-22', notes: 'Faster search\nBetter editing' }
const ready = { release, install: 'manual' as const }
const state = (patch: Partial<UpdateState> = {}): UpdateState => ({
  ...INITIAL_UPDATE_STATE,
  revision: 1,
  ...patch,
})

describe('the update window and Settings → About', () => {
  let root: Root
  let doc: Document
  let initial: Promise<IpcResponse<UpdateState>>
  let notify: (state: UpdateState) => void
  const unsubscribe = vi.fn()
  const invoke = vi.fn(async (channel: IpcChannels) => {
    if (channel === IpcChannels.InvokeGetUpdateState) return initial
    if (channel === IpcChannels.InvokeGetAppVersion)
      return { success: true, data: { version: '2.0.1' } }
    return { success: true }
  })
  beforeEach(() => {
    const { window, document } = parseHTML('<html><body><div id="root"></div></body></html>')
    doc = document
    vi.stubGlobal('window', window)
    vi.stubGlobal('document', document)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        invoke,
        on: (_channel: IpcChannels, callback: typeof notify) => {
          notify = callback
          return unsubscribe
        },
      },
    })
    initial = Promise.resolve({ success: true, data: state() })
    root = createRoot(document.getElementById('root')!)
    vi.clearAllMocks()
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    vi.unstubAllGlobals()
  })
  const mount = async (language = 'en', component = AboutPane) => {
    const translation = createInstance()
    await translation.init({
      lng: language,
      resources: { en: { translation: en }, 'zh-CN': { translation: zhCN } },
      interpolation: { escapeValue: false },
    })
    await act(async () =>
      root.render(
        createElement(
          Provider,
          { store: createStore() },
          createElement(I18nextProvider, { i18n: translation }, createElement(component)),
        ),
      ),
    )
  }
  const emit = (next: UpdateState) => act(async () => notify(next))
  const primary = () => doc.querySelector<HTMLButtonElement>('.ui-button-primary')!
  const aboutButton = () => doc.querySelector<HTMLButtonElement>('.s-btn')!

  it.each(['en', 'zh-CN'])(
    'keeps the downloaded update accessible from About in %s',
    async (language) => {
      initial = Promise.resolve({ success: true, data: state({ ready }) })
      await mount(language)
      expect(aboutButton().textContent).toBe(language === 'en' ? 'View update' : '查看更新')
      expect(doc.body.textContent).toContain('2.0.2')
      await act(async () => aboutButton().click())
      expect(invoke).toHaveBeenCalledWith(IpcChannels.InvokeShowUpdateWindow, undefined)
      expect(invoke).not.toHaveBeenCalledWith(
        IpcChannels.InvokeOpenUpdateInstaller,
        expect.anything(),
      )
    },
  )
  it('manual checking from About opens the common update flow', async () => {
    await mount()
    await act(async () => aboutButton().click())
    expect(invoke).toHaveBeenCalledWith(IpcChannels.InvokeCheckForUpdates, undefined)
  })
  it.each(['en', 'zh-CN'])(
    'puts the up-to-date result in the heading with only a Done action in %s',
    async (language) => {
      initial = Promise.resolve({ success: true, data: state({ check: 'up-to-date' }) })
      await mount(language, UpdatesRoot)
      expect(doc.querySelector('.updates-window-compact')).not.toBeNull()
      expect(doc.querySelector('h1')?.textContent).toBe(
        language === 'en' ? en.updates.upToDate : zhCN.updates.upToDate,
      )
      expect(doc.body.textContent).toContain('2.0.1')
      expect(doc.querySelectorAll('button')).toHaveLength(1)
      expect(primary().textContent).toBe(language === 'en' ? 'Done' : '好')
      expect(doc.querySelector('.updates-result-detail')).toBeNull()
      await act(async () => primary().click())
      expect(invoke).toHaveBeenCalledWith(IpcChannels.InvokeCloseUpdateWindow, undefined)
      expect(invoke).not.toHaveBeenCalledWith(IpcChannels.InvokeCheckForUpdates, undefined)
    },
  )
  it('shows checking while waiting for the first snapshot, without claiming it is up to date', async () => {
    let complete!: (value: IpcResponse<UpdateState>) => void
    initial = new Promise((resolve) => {
      complete = resolve
    })
    await mount('en', UpdatesRoot)
    expect(doc.querySelector('h1')?.textContent).toBe(en.updates.checking)
    expect(doc.querySelectorAll('button')).toHaveLength(1)
    await act(async () => complete({ success: true, data: state({ check: 'up-to-date' }) }))
    expect(doc.querySelector('h1')?.textContent).toBe(en.updates.upToDate)
  })
  it.each(['en', 'zh-CN'])(
    'explains a failed check and retries in the same surface in %s',
    async (language) => {
      initial = Promise.resolve({ success: true, data: state({ check: 'error' }) })
      await mount(language, UpdatesRoot)
      const copy = language === 'en' ? en.updates : zhCN.updates
      expect(doc.querySelector('h1[role="alert"]')?.textContent).toBe(copy.checkFailedTitle)
      expect(doc.querySelector('.updates-result-detail')?.textContent).toBe(copy.checkFailedDetail)
      expect(primary().textContent).toBe(copy.checkAgain)
      await act(async () => primary().click())
      expect(invoke).toHaveBeenCalledWith(IpcChannels.InvokeCheckForUpdates, undefined)
      await emit(state({ revision: 2, check: 'checking' }))
      expect(doc.querySelector('h1')?.textContent).toBe(copy.checking)
      expect(doc.querySelector('.updates-window-compact')).not.toBeNull()
      expect(doc.querySelectorAll('button')).toHaveLength(1)
      await emit(state({ revision: 3, release }))
      expect(doc.querySelector('.updates-window-compact')).toBeNull()
      expect(doc.querySelector('h1')?.textContent).toBe(copy.available)
      expect(doc.querySelector('.updates-notes-text')?.textContent).toBe(release.notes)
    },
  )
  it('does not present disabled checks as an up-to-date result', async () => {
    initial = Promise.resolve({ success: true, data: state({ check: 'disabled' }) })
    await mount('en', UpdatesRoot)
    expect(doc.querySelector('h1')?.textContent).toBe('Melo')
    expect(doc.querySelector('.updates-result-detail')?.textContent).toBe(en.updates.disabled)
    expect(doc.body.textContent).not.toContain(en.updates.upToDate)
  })
  it.each(['en', 'zh-CN'])(
    'keeps a missing cached installer distinct from an offline check in %s',
    async (language) => {
      initial = Promise.resolve({ success: true, data: state({ ready, check: 'error' }) })
      await mount(language, UpdatesRoot)
      invoke.mockImplementationOnce(async () => {
        notify(
          state({
            revision: 2,
            check: 'error',
            installation: 'error',
            download: { status: 'error', version: release.version },
          }),
        )
        return { success: false }
      })
      await act(async () => primary().click())
      const copy = language === 'en' ? en.updates : zhCN.updates
      expect(doc.querySelector('.updates-window-compact')).not.toBeNull()
      expect(doc.querySelector('h1[role="alert"]')?.textContent).toBe(copy.installFailedTitle)
      expect(doc.querySelector('.updates-result-detail')?.textContent).toBe(copy.invalidInstaller)
      expect(doc.body.textContent).not.toContain(copy.checkFailedDetail)
      expect(primary().textContent).toBe(copy.checkAgain)
      invoke.mockImplementationOnce(async () => {
        notify(state({ revision: 3, check: 'checking' }))
        notify(state({ revision: 4, check: 'error' }))
        return { success: true }
      })
      await act(async () => primary().click())
      expect(doc.querySelector('h1[role="alert"]')?.textContent).toBe(copy.checkFailedTitle)
      expect(doc.querySelector('.updates-result-detail')?.textContent).toBe(copy.checkFailedDetail)
      expect(doc.body.textContent).not.toContain(copy.invalidInstaller)
    },
  )
  it('does not overwrite a newer event with an old initial snapshot', async () => {
    let complete!: (value: IpcResponse<UpdateState>) => void
    initial = new Promise((resolve) => {
      complete = resolve
    })
    await mount()
    await emit(
      state({ revision: 2, download: { status: 'downloading', version: '2.0.2', percent: 57 } }),
    )
    await act(async () => complete({ success: true, data: state({ revision: 0 }) }))
    expect(doc.body.textContent).toContain('57%')
  })
  it.each(['en', 'zh-CN'])(
    'shows release notes and honest manual installation steps in %s',
    async (language) => {
      initial = Promise.resolve({ success: true, data: state({ release, ready }) })
      await mount(language, UpdatesRoot)
      expect(doc.body.textContent).toContain('Faster search')
      expect(doc.body.textContent).toContain('Applications')
      expect(primary().textContent).toBe(language === 'en' ? 'Open installer' : '打开安装包')
      await act(async () => primary().click())
      expect(invoke).toHaveBeenCalledWith(IpcChannels.InvokeOpenUpdateInstaller, {
        version: '2.0.2',
      })
      expect(invoke).not.toHaveBeenCalledWith(IpcChannels.InvokeOpenExternal, expect.anything())
    },
  )
  it('updates progress and then the install action without another window or dialog', async () => {
    initial = Promise.resolve({
      success: true,
      data: state({ release, download: { status: 'downloading', version: '2.0.2', percent: 42 } }),
    })
    await mount('en', UpdatesRoot)
    expect(doc.body.textContent).toContain('42%')
    expect(primary().hasAttribute('disabled')).toBe(true)
    await emit(state({ revision: 2, release, ready }))
    expect(primary().hasAttribute('disabled')).toBe(false)
    expect(primary().textContent).toBe('Open installer')
  })
  it.each(['en', 'zh-CN'])(
    'offers native installation without manual steps or competing check action in %s',
    async (language) => {
      initial = Promise.resolve({
        success: true,
        data: state({ release, ready: { release, install: 'in-app' } }),
      })
      await mount(language, UpdatesRoot)
      expect(primary().textContent).toBe(language === 'en' ? 'Restart and update' : '重启并更新')
      expect(primary().classList.contains('updates-confirm')).toBe(true)
      expect(doc.querySelector('.updates-guide')).toBeNull()
      expect([...doc.querySelectorAll('button')].map((button) => button.textContent)).toEqual([
        language === 'en' ? 'Skip this version' : '忽略此版本',
        language === 'en' ? 'Later' : '稍后',
        language === 'en' ? 'Restart and update' : '重启并更新',
      ])
    },
  )
  it('keeps installation available when a later check fails offline', async () => {
    initial = Promise.resolve({ success: true, data: state({ ready, check: 'error' }) })
    await mount('en', UpdatesRoot)
    expect(doc.querySelector('[role="alert"]')?.textContent).toContain('Could not check')
    expect(primary().hasAttribute('disabled')).toBe(false)
    await act(async () => primary().click())
    expect(invoke).toHaveBeenCalledWith(IpcChannels.InvokeOpenUpdateInstaller, { version: '2.0.2' })
  })
  it('retains an older installer action if downloading a newer release fails', async () => {
    initial = Promise.resolve({
      success: true,
      data: state({
        release: { ...release, version: '2.0.3' },
        ready,
        download: { status: 'error', version: '2.0.3' },
      }),
    })
    await mount('en', UpdatesRoot)
    expect(primary().textContent).toBe('Retry download')
    const cached = doc.querySelector<HTMLButtonElement>(
      '.updates-text-action:not(.updates-ignore)',
    )!
    expect(cached.textContent).toContain('2.0.2')
    await act(async () => cached.click())
    expect(invoke).toHaveBeenCalledWith(IpcChannels.InvokeOpenUpdateInstaller, { version: '2.0.2' })
  })
  it.each(['en', 'zh-CN'])(
    'offers a download retry instead of restarting after native installation fails in %s',
    async (language) => {
      initial = Promise.resolve({
        success: true,
        data: state({
          release,
          installation: 'error',
          download: { status: 'error', version: release.version },
        }),
      })
      await mount(language, UpdatesRoot)
      expect(primary().textContent).toBe(language === 'en' ? 'Retry download' : '重新下载')
      expect(primary().disabled).toBe(false)
      expect(doc.querySelector('[role="alert"]')?.textContent).toBe(
        language === 'en' ? en.updates.installFailed : zhCN.updates.installFailed,
      )
      await act(async () => primary().click())
      expect(invoke).toHaveBeenCalledWith(IpcChannels.InvokeDownloadUpdate, undefined)
      expect(invoke).not.toHaveBeenCalledWith(
        IpcChannels.InvokeOpenUpdateInstaller,
        expect.anything(),
      )
    },
  )
  it('omits a missing release date and explains empty release notes', async () => {
    initial = Promise.resolve({
      success: true,
      data: state({ release: { ...release, date: null, notes: '' } }),
    })
    await mount('en', UpdatesRoot)
    expect(doc.querySelector('.updates-release-meta time')).toBeNull()
    expect(doc.querySelector('.updates-notes-text')?.textContent).toBe(en.updates.noReleaseNotes)
  })
  it('renders remote notes as text, without making HTML or images active', async () => {
    initial = Promise.resolve({
      success: true,
      data: state({ release: { ...release, notes: '<img src="https://tracking.invalid">' } }),
    })
    await mount('en', UpdatesRoot)
    expect(doc.querySelector('.updates-notes img')).toBeNull()
    expect(doc.querySelector('.updates-notes-text')?.textContent).toContain('<img')
  })
  it('closes with Later while leaving the download in the main process', async () => {
    initial = Promise.resolve({ success: true, data: state({ release }) })
    await mount('en', UpdatesRoot)
    const later = [...doc.querySelectorAll<HTMLButtonElement>('button')].find(
      (item) => item.textContent === 'Later',
    )!
    await act(async () => later.click())
    expect(invoke).toHaveBeenCalledWith(IpcChannels.InvokeCloseUpdateWindow, undefined)
  })
  it.each(['en', 'zh-CN'])(
    'skips the displayed release and closes only after persisting it in %s',
    async (language) => {
      initial = Promise.resolve({ success: true, data: state({ release, ready }) })
      await mount(language, UpdatesRoot)
      const skip = doc.querySelector<HTMLButtonElement>('.updates-ignore')!
      expect(skip.textContent).toBe(language === 'en' ? 'Skip this version' : '忽略此版本')
      await act(async () => skip.click())
      expect(invoke).toHaveBeenCalledWith(IpcChannels.InvokeIgnoreUpdate, {
        version: release.version,
      })
      expect(invoke).toHaveBeenCalledWith(IpcChannels.InvokeCloseUpdateWindow, undefined)
      const channels = invoke.mock.calls.map(([channel]) => channel)
      expect(channels.indexOf(IpcChannels.InvokeIgnoreUpdate)).toBeLessThan(
        channels.indexOf(IpcChannels.InvokeCloseUpdateWindow),
      )
    },
  )
  it('keeps the window open if persisting the skipped version fails', async () => {
    initial = Promise.resolve({ success: true, data: state({ release, ready }) })
    await mount('en', UpdatesRoot)
    invoke.mockResolvedValueOnce({ success: false })
    await act(async () => doc.querySelector<HTMLButtonElement>('.updates-ignore')!.click())
    expect(doc.querySelector('[role="alert"]')?.textContent).toContain('Could not skip')
    expect(invoke).not.toHaveBeenCalledWith(IpcChannels.InvokeCloseUpdateWindow, undefined)
  })
  it.each(['en', 'zh-CN'])(
    'discards a failed download action when an external retry recovers in %s',
    async (language) => {
      initial = Promise.resolve({
        success: true,
        data: state({ release, download: { status: 'error', version: release.version } }),
      })
      await mount(language, UpdatesRoot)
      invoke.mockImplementationOnce(async () => {
        notify(
          state({ revision: 2, release, download: { status: 'error', version: release.version } }),
        )
        return { success: false }
      })
      await act(async () => primary().click())
      const copy = language === 'en' ? en.updates : zhCN.updates
      expect(doc.querySelector('[role="alert"]')?.textContent).toBe(copy.downloadFailed)
      await emit(
        state({
          revision: 3,
          release,
          download: { status: 'downloading', version: release.version, percent: 42 },
        }),
      )
      expect(doc.querySelector('[role="alert"]')).toBeNull()
      await emit(state({ revision: 4, release, ready }))
      expect(primary().textContent).toBe(copy.openInstaller)
      expect(doc.querySelector('[role="alert"]')).toBeNull()
    },
  )
  it('does not let a late failed IPC response overwrite a newer successful state', async () => {
    initial = Promise.resolve({ success: true, data: state({ release }) })
    await mount('en', UpdatesRoot)
    let finish!: (result: { success: false }) => void
    invoke.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    await act(async () => primary().click())
    await emit(state({ revision: 2, release, ready }))
    await act(async () => finish({ success: false }))
    expect(primary().textContent).toBe(en.updates.openInstaller)
    expect(doc.querySelector('[role="alert"]')).toBeNull()
  })
  it('retains an IPC failure until main state advances, not merely when a snapshot is repeated', async () => {
    initial = Promise.resolve({ success: true, data: state({ release }) })
    await mount('en', UpdatesRoot)
    invoke.mockRejectedValueOnce(new Error('IPC unavailable'))
    await act(async () => primary().click())
    expect(doc.querySelector('[role="alert"]')?.textContent).toBe(en.updates.downloadFailed)
    await emit(state({ release }))
    expect(doc.querySelector('[role="alert"]')?.textContent).toBe(en.updates.downloadFailed)
    await emit(state({ revision: 2, release, ready }))
    expect(doc.querySelector('[role="alert"]')).toBeNull()
  })
  it('unsubscribes when the pane closes', async () => {
    await mount()
    await act(async () => root.render(null))
    expect(unsubscribe).toHaveBeenCalledOnce()
  })
})
