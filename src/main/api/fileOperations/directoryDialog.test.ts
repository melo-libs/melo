import { beforeEach, describe, expect, it, vi } from 'vitest'
import { openDirectoryDialog } from './fileOperations'

const mocks = vi.hoisted(() => ({
  window: {},
  showOpenDialog: vi.fn<() => Promise<{ canceled: boolean; filePaths: string[] }>>(),
}))

vi.mock('electron', () => ({
  app: {},
  BrowserWindow: { getFocusedWindow: () => mocks.window },
  dialog: { showOpenDialog: mocks.showOpenDialog },
  shell: {},
}))

beforeEach(() => vi.clearAllMocks())

describe('the workspace folder picker', () => {
  it('allows choosing an existing folder or creating one in the same native dialog', async () => {
    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/notes'] })

    await expect(openDirectoryDialog()).resolves.toBe('/notes')
    expect(mocks.showOpenDialog).toHaveBeenCalledOnce()
    expect(mocks.showOpenDialog).toHaveBeenCalledWith(mocks.window, {
      properties: ['openDirectory', 'createDirectory'],
    })
  })

  it('returns no workspace when the native picker is cancelled', async () => {
    mocks.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })

    await expect(openDirectoryDialog()).resolves.toBeNull()
    expect(mocks.showOpenDialog).toHaveBeenCalledOnce()
  })
})
