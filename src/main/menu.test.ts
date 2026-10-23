import type { BrowserWindow, MenuItemConstructorOptions } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import createMenu from './menu'

const mocks = vi.hoisted(() => ({
  app: {
    name: 'melo-lite',
    setName: vi.fn(),
    setPath: vi.fn(),
    setAboutPanelOptions: vi.fn(),
  },
  buildFromTemplate: vi.fn((template: MenuItemConstructorOptions[]) => ({ items: template })),
  setApplicationMenu: vi.fn(),
}))

vi.mock('electron', () => ({
  app: mocks.app,
  Menu: {
    buildFromTemplate: mocks.buildFromTemplate,
    setApplicationMenu: mocks.setApplicationMenu,
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

beforeEach(() => vi.clearAllMocks())

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
