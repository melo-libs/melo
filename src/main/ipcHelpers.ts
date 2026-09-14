import { ipcMain, IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import { IpcChannels, IpcChannelDefinitions, IpcResponseType } from '../shared/types/ipc'

// Typed listener for `on` events
export function on<K extends IpcChannels>(
  channel: K,
  listener: (event: IpcMainEvent, args: IpcChannelDefinitions[K]['args']) => void,
): void {
  ipcMain.on(channel, listener)
}

// Typed handler for `handle` (supports return type)
export function handle<K extends IpcChannels>(
  channel: K,
  listener: (
    event: IpcMainInvokeEvent,
    args: IpcChannelDefinitions[K]['args'],
  ) => Promise<IpcResponseType<K>>,
): void {
  ipcMain.handle(channel, listener)
}
