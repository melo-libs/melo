import { ipcMain } from 'electron'
import { IpcChannels } from '../../shared/types/ipc'
import { getMainWindow } from '../windows'
import { writeEditorClipboard } from '../libs/editorClipboard'
import { LAST_DIRECTORY_KEY, preferences } from '../preferences'

export function setupClipboardIPC(): void {
  ipcMain.on(IpcChannels.CopyEditorClipboard, (event, content: unknown) => {
    if (event.sender !== getMainWindow()?.webContents) {
      event.returnValue = { success: false, error: 'Not the editor window' }
      return
    }
    try {
      const data = writeEditorClipboard(
        content,
        preferences.get<string>(LAST_DIRECTORY_KEY),
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
}
