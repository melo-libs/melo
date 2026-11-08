import type { BrowserWindow, MenuItemConstructorOptions } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import createMenu, { setCopyMarkdownAvailable } from './menu'
import { IpcChannels } from '../shared/types/ipc'

const mocks = vi.hoisted(() => ({
  app: {
    name: 'melo-lite',
    setName: vi.fn(),
    setPath: vi.fn(),
    setAboutPanelOptions: vi.fn(),
  },
  buildFromTemplate: vi.fn((template: MenuItemConstructorOptions[]) => ({ items: template })),
  setApplicationMenu: vi.fn(),
  focusedWindow: vi.fn(),
  getApplicationMenu: vi.fn(),
}))

vi.mock('electron', () => ({
  app: mocks.app,
  BrowserWindow: { getFocusedWindow: mocks.focusedWindow },
  Menu: {
    buildFromTemplate: mocks.buildFromTemplate,
    setApplicationMenu: mocks.setApplicationMenu,
    getApplicationMenu: mocks.getApplicationMenu,
  },
}))
vi.mock('./api/fileOperations/fileOperations', () => ({
  openFileDialog: vi.fn(),
  sendFileToRenderer: vi.fn(),
}))
vi.mock('./updater', () => ({
  updateManager: { getState: () => ({ ready: null }) },
}))
vi.mock('./settingsWindow', () => ({ openSettingsWindow: vi.fn() }))

beforeEach(() => {
  setCopyMarkdownAvailable(false)
  vi.clearAllMocks()
})

describe('Copy as Markdown menu command', () => {
  it('uses one native accelerator and targets only the focused main window', () => {
    const window = { webContents: { send: vi.fn() } } as unknown as BrowserWindow
    createMenu(window)
    const template = mocks.buildFromTemplate.mock.calls[0][0]
    const edit = template.find((item) => item.label === 'Edit')!
    const command = (edit.submenu as MenuItemConstructorOptions[]).find(
      (item) => item.id === 'copy-as-markdown',
    )!
    expect(command.accelerator).toBe('CmdOrCtrl+Shift+C')
    expect(command.enabled).toBe(false)
    mocks.focusedWindow.mockReturnValue({})
    command.click?.({} as never, window, {} as never)
    expect(window.webContents.send).not.toHaveBeenCalled()
    mocks.focusedWindow.mockReturnValue(window)
    command.click?.({} as never, window, {} as never)
    expect(window.webContents.send).toHaveBeenCalledWith(IpcChannels.OnCopyAsMarkdown)
  })

  it('retains selection availability when rebuilding the menu for a locale change', () => {
    setCopyMarkdownAvailable(true)
    createMenu({} as BrowserWindow, 'zh-CN')
    const template = mocks.buildFromTemplate.mock.calls[0][0]
    const command = template
      .flatMap((item) => (Array.isArray(item.submenu) ? item.submenu : []))
      .find((item) => item.id === 'copy-as-markdown')!
    expect(command.enabled).toBe(true)
  })

  it('updates availability on the current menu item', () => {
    const item = { enabled: false }
    mocks.getApplicationMenu.mockReturnValue({ getMenuItemById: () => item })
    setCopyMarkdownAvailable(true)
    expect(item.enabled).toBe(true)
    setCopyMarkdownAvailable(false)
    expect(item.enabled).toBe(false)
  })
})

describe.runIf(process.platform === 'darwin')('macOS application menu branding', () => {
  it.each([
    {
      locale: 'en' as const,
      copy: { about: 'About Melo', hide: 'Hide Melo', quit: 'Quit Melo' },
    },
    {
      locale: 'zh-CN' as const,
      copy: { about: '关于 Melo', hide: '隐藏 Melo', quit: '退出 Melo' },
    },
  ])(
    'uses Melo in the $locale native menu without changing the profile identity',
    ({ locale, copy }) => {
      createMenu({} as BrowserWindow, locale)

      const template = mocks.buildFromTemplate.mock.calls[0][0]
      expect(template[0].label).toBe('Melo')
      const submenu = template[0].submenu as MenuItemConstructorOptions[]
      expect(submenu[0]).toEqual({ label: copy.about, role: 'about' })
      expect(submenu.find((item) => item.role === 'hide')).toEqual({
        label: copy.hide,
        role: 'hide',
      })
      expect(submenu.find((item) => item.role === 'quit')).toEqual({
        label: copy.quit,
        role: 'quit',
      })
      expect(mocks.app.setAboutPanelOptions).toHaveBeenCalledWith({ applicationName: 'Melo' })
      expect(mocks.app.name).toBe('melo-lite')
      expect(mocks.app.setName).not.toHaveBeenCalled()
      expect(mocks.app.setPath).not.toHaveBeenCalled()
      expect(mocks.setApplicationMenu).toHaveBeenCalledWith({ items: template })
    },
  )
})
