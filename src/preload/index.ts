import { contextBridge, ipcRenderer, IpcRendererEvent, webUtils } from 'electron'
// import { electronAPI } from '@electron-toolkit/preload'
import { IpcChannels, IpcRequestType, IpcResponseType, IpcApi } from '../shared/types/ipc'

const validChannels = Object.values(IpcChannels)

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    // contextBridge.exposeInMainWorld('electron', electronAPI)
    const api: IpcApi = {
      // Native cut needs a write acknowledgement before deleting its source.
      // Only bounded local work runs synchronously; downloads/codecs run in background.
      copyEditorClipboard: (content) =>
        ipcRenderer.sendSync(IpcChannels.CopyEditorClipboard, content),
      getPathForFile: (file) => webUtils.getPathForFile(file),
      channels: IpcChannels,
      send: <K extends IpcChannels>(channel: K, args: IpcRequestType<K>['args']): void => {
        if (validChannels.includes(channel)) {
          ipcRenderer.send(channel, args)
        }
      },

      on: <K extends IpcChannels>(
        channel: K,
        callback: (args: IpcRequestType<K>['args']) => void,
      ): (() => void) => {
        if (validChannels.includes(channel)) {
          const subscription = (_event: IpcRendererEvent, args: IpcRequestType<K>['args']) =>
            callback(args)
          ipcRenderer.on(channel, subscription)
          return () => {
            ipcRenderer.removeListener(channel, subscription)
          }
        }
        return () => {}
      },

      invoke: async <K extends IpcChannels>(
        channel: K,
        args: IpcRequestType<K>['args'],
      ): Promise<IpcResponseType<K>> => {
        if (validChannels.includes(channel)) {
          return await ipcRenderer.invoke(channel, args)
        }
        throw new Error(`Invalid channel: ${channel}`)
      },
    }

    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error('Failed to expose API:', error)
  }
} else {
  // @ts-ignore (define in dts)
  // window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
