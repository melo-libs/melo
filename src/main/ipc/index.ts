import { ipcMain } from 'electron'
import { IpcChannels } from '../../shared/types/ipc'
import { getHandler } from './handlers'
import { setupAgentIPC } from './agent'
import { setCopyMarkdownAvailable } from '../menu'
import { getMainWindow } from '../windows'
import { writeEditorClipboard } from '../libs/editorClipboard'
import { preferences } from '../preferences'

export function setupIPC(): void {
  setupAgentIPC()
  ipcMain.on(IpcChannels.CopyEditorClipboard, async (event, content: unknown) => {
    if (event.sender !== getMainWindow()?.webContents) {
      event.returnValue = { success: false, error: 'Not the editor window' }
      return
    }
    try {
      const data = await writeEditorClipboard(
        content,
        preferences.get('lastDirectory') as string | null,
        (status) => {
          if (!event.sender.isDestroyed())
            event.sender.send(IpcChannels.OnClipboardImageCopy, status)
        },
      )
      event.returnValue = { success: true, data }
    } catch (error) {
      event.returnValue = {
        success: false,
        error: error instanceof Error ? error.message : 'Could not copy',
      }
    }
  })
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
