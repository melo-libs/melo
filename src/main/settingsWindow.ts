import { join } from 'path'
import { BrowserWindow, shell } from 'electron'
import { is } from '@electron-toolkit/utils'
import { nativeTheme } from 'electron'
import { getSettings } from './settings'

let settingsWindow: BrowserWindow | null = null

export const openSettingsWindow = (): void => {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    if (settingsWindow.isMinimized()) settingsWindow.restore()
    settingsWindow.focus()
    return
  }
  settingsWindow = new BrowserWindow({
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 14, y: 17 },
    width: 920,
    height: 640,
    minWidth: 760,
    minHeight: 520,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: (() => {
      const theme = getSettings().theme
      const dark = theme === 'dark' || (theme === 'system' && nativeTheme.shouldUseDarkColors)
      return dark ? '#191a1c' : '#fbfbfa'
    })(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  settingsWindow.webContents.setWindowOpenHandler(({ url }) => {
    setImmediate(() => shell.openExternal(url))
    return { action: 'deny' }
  })
  settingsWindow.once('ready-to-show', () => settingsWindow?.show())
  settingsWindow.on('closed', () => {
    settingsWindow = null
  })
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    settingsWindow.loadURL(process.env['ELECTRON_RENDERER_URL'] + '#settings')
  } else {
    settingsWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'settings' })
  }
}
