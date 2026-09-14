import './userData' // must run before anything that reads app.getPath('userData')
import {
  app,
  shell,
  BrowserWindow,
  BrowserWindowConstructorOptions,
  ipcMain,
  type IpcMainEvent,
} from 'electron'
import { closeIndex } from './api/indexer'
import { join } from 'path'
import { optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import createMenu from './menu'
import { sendFileToRenderer } from './api/fileOperations/fileOperations'
import { IpcChannels } from '../shared/types/ipc'
import { setupIPC } from './ipc'
import { updateManager } from './updater'
import { setMainWindow } from './windows'
import { registerProtocols, stripAppReferer } from './protocols'
import { resolveLanguage } from './language'
import { launchFilePaths } from './launchFiles'
import { isTextDocumentPath } from '../shared/fileKinds'

// stdout/stderr are pipes to whatever launched us (terminal, test driver).
// If that end dies first, console.* raises EPIPE — without handlers this
// becomes an uncaught exception dialog (seen via electron-updater's logs).
process.stdout.on('error', () => {})
process.stderr.on('error', () => {})

// 状态管理
type AppState = {
  mainWindow: BrowserWindow | null
  pendingFiles: string[]
  isWindowReady: boolean
}

const appState: AppState = {
  mainWindow: null,
  pendingFiles: [],
  isWindowReady: false,
}

const enqueueFileOpen = (filePath: string): boolean => {
  if (!isTextDocumentPath(filePath)) return false
  if (!appState.pendingFiles.includes(filePath)) appState.pendingFiles.push(filePath)
  return true
}

const flushPendingFiles = (window: BrowserWindow): void => {
  if (!appState.isWindowReady) return
  while (appState.isWindowReady && !window.isDestroyed() && appState.pendingFiles.length > 0) {
    sendFileToRenderer(appState.pendingFiles.shift()!, window)
  }
}

const getWindowConfig = (): BrowserWindowConstructorOptions => ({
  titleBarStyle: 'hidden',
  trafficLightPosition: { x: 14, y: 17 },
  width: 1120,
  height: 860,
  minWidth: 800,
  minHeight: 600,
  show: false, // 初始不显示
  autoHideMenuBar: true,
  backgroundColor: '#ffffff',
  ...(process.platform === 'linux' ? { icon } : {}),
  webPreferences: {
    preload: join(__dirname, '../preload/index.js'),
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    backgroundThrottling: true,
    v8CacheOptions: 'code',
  },
})

const initializeWindow = (window: BrowserWindow) => {
  // load content
  const loadContent = () => {
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      window.loadURL(process.env['ELECTRON_RENDERER_URL'])
    } else {
      window.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'main' })
    }
  }

  // External link
  window.webContents.setWindowOpenHandler(({ url }) => {
    setImmediate(() => shell.openExternal(url))
    return { action: 'deny' }
  })

  window.once('ready-to-show', () => {
    window.show()
  })

  // `did-finish-load` fires before the renderer's async settings/language
  // bootstrap has necessarily mounted React listeners. Wait for an explicit
  // renderer handshake so a cold-start `open-file` event cannot be dropped.
  const onRendererReady = (event: IpcMainEvent) => {
    if (event.sender !== window.webContents) return
    appState.isWindowReady = true
    flushPendingFiles(window)
  }
  ipcMain.on(IpcChannels.RendererReady, onRendererReady)
  window.webContents.on('did-start-loading', () => {
    appState.isWindowReady = false
  })
  window.once('closed', () => {
    ipcMain.removeListener(IpcChannels.RendererReady, onRendererReady)
  })

  let closing = false
  window.on('close', (event) => {
    if (closing) return
    event.preventDefault()
    closing = true
    const destroy = () => {
      appState.mainWindow = null
      setMainWindow(null)
      window.destroy()
    }
    const cleanup = () => {
      clearTimeout(timeout)
      ipcMain.removeListener(IpcChannels.ReadyToClose, onReady)
      ipcMain.removeListener(IpcChannels.CancelClose, onCancel)
    }
    const onReady = () => {
      cleanup()
      destroy()
    }
    // The renderer aborts the close when the user cancels a save dialog —
    // reset the whole protocol so a later close starts fresh (previously
    // the 30s fallback timer kept running and force-destroyed the window).
    const onCancel = () => {
      cleanup()
      closing = false
    }
    const timeout = setTimeout(() => {
      cleanup()
      destroy()
    }, 30000)
    ipcMain.once(IpcChannels.ReadyToClose, onReady)
    ipcMain.once(IpcChannels.CancelClose, onCancel)
    window.webContents.send(IpcChannels.FlushBeforeClose)
  })

  loadContent()
}

// create main window
const ensureMainWindow = (): BrowserWindow => {
  if (!appState.mainWindow) {
    const window = new BrowserWindow(getWindowConfig())
    appState.mainWindow = window
    setMainWindow(window)
    appState.isWindowReady = false
    window.once('ready-to-show', () => {
      updateManager.setMainWindow(window)
      createMenu(window, resolveLanguage())
    })

    initializeWindow(window)
  }

  return appState.mainWindow
}

const handleFileOpen = (filePath: string) => {
  if (!enqueueFileOpen(filePath) || !app.isReady()) return

  const mainWindow = ensureMainWindow()
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
  flushPendingFiles(mainWindow)
}

const focusMainWindow = () => {
  if (!app.isReady()) return
  const mainWindow = ensureMainWindow()
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
}

// app initialization
const initializeApp = () => {
  app.enableSandbox()
  app.on('open-file', (event, filePath) => {
    event.preventDefault()
    handleFileOpen(filePath)
  })
  app.on('second-instance', (_event, argv, workingDirectory) => {
    const filePaths = launchFilePaths(argv, workingDirectory)
    if (filePaths.length === 0) {
      focusMainWindow()
      return
    }
    filePaths.forEach(handleFileOpen)
  })

  launchFilePaths(process.argv, process.cwd()).forEach(enqueueFileOpen)

  app.whenReady().then(() => {
    registerProtocols()
    stripAppReferer()
    setupIPC()
    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    const mainWindow = ensureMainWindow()
    flushPendingFiles(mainWindow)
  })

  // Flush the index cleanly on exit (WAL would recover anyway, but tidy).
  app.on('will-quit', () => {
    closeIndex()
  })

  app.on('window-all-closed', () => {
    appState.mainWindow = null
    if (process.platform !== 'darwin') app.quit()
  })
  app.on('activate', () => {
    if (!appState.mainWindow) ensureMainWindow()
  })
}

if (app.requestSingleInstanceLock()) initializeApp()
else app.quit()
