import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setupClipboardIPC } from './clipboard'
import { IpcChannels } from '../../shared/types/ipc'

const mocks = vi.hoisted(() => ({
  on: vi.fn(),
  write: vi.fn(),
  getRoot: vi.fn(),
  sender: { send: vi.fn(), isDestroyed: vi.fn() },
}))
vi.mock('electron', () => ({ ipcMain: { on: mocks.on } }))
vi.mock('../windows', () => ({ getMainWindow: () => ({ webContents: mocks.sender }) }))
vi.mock('../libs/editorClipboard', () => ({ writeEditorClipboard: mocks.write }))
vi.mock('../preferences', () => ({
  LAST_DIRECTORY_KEY: 'lastDirectory',
  preferences: { get: mocks.getRoot },
}))

beforeEach(() => {
  vi.resetAllMocks()
  mocks.getRoot.mockReturnValue('/notes')
  setupClipboardIPC()
})
const receive = (event: { sender: object; returnValue?: unknown }, content: unknown = {}) =>
  mocks.on.mock.calls[0][1](event, content)

describe('clipboard IPC boundary', () => {
  it('registers the synchronous editor-only channel', () => {
    expect(mocks.on).toHaveBeenCalledWith(IpcChannels.CopyEditorClipboard, expect.any(Function))
    const event = { sender: {}, returnValue: undefined }
    receive(event)
    expect(event.returnValue).toEqual({ success: false, error: 'Not the editor window' })
    expect(mocks.write).not.toHaveBeenCalled()
  })

  it('acknowledges the initial write synchronously and uses the shared workspace key', () => {
    const data = { fallbackImages: 0, bitmap: 'pending' }
    mocks.write.mockReturnValue(data)
    const event = { sender: mocks.sender, returnValue: undefined }
    const content = { html: '<img>' }
    receive(event, content)
    expect(mocks.getRoot).toHaveBeenCalledWith('lastDirectory')
    expect(mocks.write).toHaveBeenCalledWith(content, '/notes', expect.any(Function))
    expect(event.returnValue).toEqual({ success: true, data })
  })

  it('returns a failed initial write without a success acknowledgement', () => {
    mocks.write.mockImplementation(() => {
      throw new Error('Clipboard unavailable')
    })
    const event = { sender: mocks.sender, returnValue: undefined }
    receive(event)
    expect(event.returnValue).toEqual({ success: false, error: 'Clipboard unavailable' })
  })

  it('does not send background notifications to a destroyed renderer', () => {
    receive({ sender: mocks.sender })
    mocks.sender.isDestroyed.mockReturnValue(true)
    mocks.write.mock.calls[0][2]('copied')
    expect(mocks.sender.send).not.toHaveBeenCalled()
  })
})
