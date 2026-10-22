import { join } from 'node:path'
import { BrowserWindow, nativeTheme } from 'electron'
import { is } from '@electron-toolkit/utils'
import { getSettings } from './settings'

let updateWindow: BrowserWindow | null = null
let ready = false
let focusRequested = false
let releaseVisible = false

const COMPACT_HEIGHT = 260
const RELEASE_HEIGHT = 520
const RELEASE_MIN_HEIGHT = 460

export function resizeUpdateWindow(expanded: boolean): void {
  if (!updateWindow || updateWindow.isDestroyed() || releaseVisible === expanded) return
  releaseVisible = expanded
  const [width] = updateWindow.getSize()
  // Only a content-mode change resizes the window; progress must preserve the user's size.
  updateWindow.setMinimumSize(520, expanded ? RELEASE_MIN_HEIGHT : COMPACT_HEIGHT)
  updateWindow.setSize(width, expanded ? RELEASE_HEIGHT : COMPACT_HEIGHT)
}

export function openUpdateWindow(focus = true, expanded = false): void {
  if (updateWindow && !updateWindow.isDestroyed()) {
    resizeUpdateWindow(expanded)
    if (focus) {
      focusRequested = true
      if (ready) {
        if (updateWindow.isMinimized()) updateWindow.restore()
        updateWindow.show()
        updateWindow.focus()
      }
    }
    return
  }
  ready = false
  focusRequested = focus
  releaseVisible = expanded
  const theme = getSettings().theme
  const dark = theme === 'dark' || (theme === 'system' && nativeTheme.shouldUseDarkColors)
  const window = new BrowserWindow({
    title: 'Melo',
    width: 560,
    height: expanded ? RELEASE_HEIGHT : COMPACT_HEIGHT,
    minWidth: 520,
    minHeight: expanded ? RELEASE_MIN_HEIGHT : COMPACT_HEIGHT,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 16, y: 17 },
    show: false,
    autoHideMenuBar: true,
    backgroundColor: dark ? '#191a1c' : '#ffffff',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  updateWindow = window
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.once('ready-to-show', () => {
    ready = true
    if (focusRequested) window.show()
    else window.showInactive()
  })
  window.on('closed', () => {
    updateWindow = null
    ready = false
  })
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(process.env['ELECTRON_RENDERER_URL'] + '#updates')
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'updates' })
  }
}

export function closeUpdateWindow(): void {
  updateWindow?.close()
}
