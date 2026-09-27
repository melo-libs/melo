import { afterEach, describe, expect, it, vi } from 'vitest'
import { IpcChannels, type FileNode as DiskNode } from '@shared/types/ipc'
import { adoptWorkspace } from './workspace'

vi.mock('./codeGuide', () => ({
  openCodeGuide: vi.fn(async () => ({ opened: false, created: false })),
}))
vi.mock('../store/tabSession', () => ({
  restoreTabSession: vi.fn(async () => {}),
}))

const inbox: DiskNode = {
  name: 'Inbox',
  path: '/notes/Inbox',
  type: 'directory',
  isDirectory: true,
  children: [],
  size: 0,
  modifiedTime: 1,
  createdTime: 1,
}

afterEach(() => vi.unstubAllGlobals())

describe('adoptWorkspace startup scan', () => {
  it('scans once when Inbox already exists', async () => {
    const invoke = vi.fn(async (channel: IpcChannels) => {
      if (channel === IpcChannels.InvokeRegisterWorkspace)
        return { success: true, data: { path: '/notes' } }
      if (channel === IpcChannels.InvokeListDirectory)
        return { success: true, data: { files: [inbox] } }
      if (channel === IpcChannels.InvokeGetClipSources)
        return { success: true, data: { sources: {} } }
      return { success: true }
    })
    vi.stubGlobal('window', { api: { invoke } })

    await adoptWorkspace('/notes')

    expect(
      invoke.mock.calls.filter(([channel]) => channel === IpcChannels.InvokeListDirectory),
    ).toHaveLength(1)
    expect(
      invoke.mock.calls.some(([channel]) => channel === IpcChannels.InvokeCreateDirectory),
    ).toBe(false)
  })

  it('creates Inbox and refreshes the tree on first open', async () => {
    let created = false
    const invoke = vi.fn(async (channel: IpcChannels) => {
      if (channel === IpcChannels.InvokeRegisterWorkspace)
        return { success: true, data: { path: '/notes' } }
      if (channel === IpcChannels.InvokeListDirectory)
        return { success: true, data: { files: created ? [inbox] : [] } }
      if (channel === IpcChannels.InvokeGetClipSources)
        return { success: true, data: { sources: {} } }
      if (channel === IpcChannels.InvokeCreateDirectory) created = true
      return { success: true }
    })
    vi.stubGlobal('window', { api: { invoke } })

    await adoptWorkspace('/notes')

    expect(
      invoke.mock.calls.filter(([channel]) => channel === IpcChannels.InvokeListDirectory),
    ).toHaveLength(2)
    expect(
      invoke.mock.calls.filter(([channel]) => channel === IpcChannels.InvokeCreateDirectory),
    ).toHaveLength(1)
  })
})
