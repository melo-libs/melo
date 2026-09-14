import type { BrowserWindow } from 'electron'

/* Main-window registry — menu items and IPC handlers that must target the
   editor window (not whichever window sent the request) resolve it here. */

let mainWindow: BrowserWindow | null = null

export function setMainWindow(win: BrowserWindow | null): void {
  mainWindow = win
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
}
