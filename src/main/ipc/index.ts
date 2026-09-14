import { ipcMain } from 'electron'
import { IpcChannels } from '../../shared/types/ipc'
import { getHandler } from './handlers'

export function setupIPC(): void {
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
