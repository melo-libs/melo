import { ipcMain } from 'electron'
import { IpcChannels } from '../../shared/types/ipc'
import { getHandler } from './handlers'
import { setupAgentIPC } from './agent'
import { setCopyMarkdownAvailable } from '../menu'
import { getMainWindow } from '../windows'
import { setupClipboardIPC } from './clipboard'

export function setupIPC(): void {
  setupAgentIPC()
  setupClipboardIPC()
  ipcMain.on(IpcChannels.CopyMarkdownAvailable, (event, args: { available: boolean }) => {
    if (event.sender === getMainWindow()?.webContents && typeof args?.available === 'boolean') {
      setCopyMarkdownAvailable(args.available)
    }
  })
  // Register invoke handlers
  Object.values(IpcChannels).forEach((channel) => {
    const handler = getHandler(channel)
    if (handler) {
      ipcMain.handle(channel, handler)
    }
  })

  // Handle FileNew event from renderer
  ipcMain.on(IpcChannels.FileNew, (event) => {
    // Send the event back to the renderer
    event.sender.send(IpcChannels.FileNew)
  })

  // Clean up handlers when app is about to quit
  process.on('exit', () => {
    Object.values(IpcChannels).forEach((channel) => {
      ipcMain.removeHandler(channel)
    })
  })
}
