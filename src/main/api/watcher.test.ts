import { EventEmitter } from 'node:events'
import fs from 'fs-extra'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IpcChannels, type FileNode } from '../../shared/types/ipc'

const mocks = vi.hoisted(() => ({
  subscribe: vi.fn(),
  send: vi.fn(),
  indexFile: vi.fn(),
  removeFromIndex: vi.fn(),
  getClipSourcesForPaths: vi.fn(() => ({})),
  senderSend: vi.fn(),
  listDirectoryContents: vi.fn<() => Promise<FileNode[]>>(async () => []),
}))

vi.mock('@parcel/watcher', () => ({
  default: { subscribe: mocks.subscribe },
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [
      {
        webContents: {
          isDestroyed: () => false,
          send: mocks.send,
        },
      },
    ],
  },
}))

vi.mock('./indexer', () => ({
  indexFile: mocks.indexFile,
  removeFromIndex: mocks.removeFromIndex,
  getClipSourcesForPaths: mocks.getClipSourcesForPaths,
}))

vi.mock('./fileOperations/fileOperations', () => ({
  getMimeType: () => 'application/octet-stream',
  listDirectoryContents: mocks.listDirectoryContents,
}))

import { unwatchWorkspace, watchWorkspace } from './watcher'

type WatchCallback = (error: Error | null, events: { path: string; type: string }[]) => void

let root: string
let callbacks: WatchCallback[]
let unsubscribe: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  mocks.listDirectoryContents.mockResolvedValue([])
  callbacks = []
  unsubscribe = vi.fn().mockResolvedValue(undefined)
  mocks.subscribe.mockImplementation(async (_root, callback: WatchCallback) => {
    callbacks.push(callback)
    return { unsubscribe }
  })
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'melo-watcher-'))
})

afterEach(async () => {
  await unwatchWorkspace()
  vi.useRealTimers()
  fs.removeSync(root)
})

function sender(): EventEmitter & { isDestroyed: () => boolean; send: typeof mocks.senderSend } {
  const value = new EventEmitter() as EventEmitter & {
    isDestroyed: () => boolean
    send: typeof mocks.senderSend
  }
  value.isDestroyed = () => false
  value.send = mocks.senderSend
  return value
}

describe('workspace watcher', () => {
  it('coalesces a native batch, indexes files only, and notifies once', async () => {
    const file = path.join(root, 'note.md')
    const folder = path.join(root, 'Folder')
    const hidden = path.join(root, '.melo', 'index.db')
    const deleted = path.join(root, 'gone.md')
    fs.writeFileSync(file, '# Note')
    fs.ensureDirSync(folder)
    fs.ensureFileSync(hidden)

    await watchWorkspace(root, sender() as never)
    callbacks[0](null, [
      { path: file, type: 'create' },
      { path: file, type: 'update' },
      { path: folder, type: 'create' },
      { path: hidden, type: 'update' },
      { path: deleted, type: 'delete' },
    ])

    await vi.advanceTimersByTimeAsync(300)

    expect(mocks.indexFile).toHaveBeenCalledTimes(1)
    expect(mocks.indexFile).toHaveBeenCalledWith(file)
    expect(mocks.removeFromIndex).toHaveBeenCalledWith(deleted)
    expect(mocks.getClipSourcesForPaths).toHaveBeenCalledWith([file])
    expect(mocks.send).toHaveBeenCalledTimes(1)
    expect(mocks.send).toHaveBeenCalledWith(
      IpcChannels.OnWorkspaceChanged,
      expect.objectContaining({
        kind: 'filesystem',
        workspaceRoot: root,
        sources: {},
        changes: expect.arrayContaining([
          expect.objectContaining({
            type: 'upsert',
            node: expect.objectContaining({ path: file }),
          }),
          expect.objectContaining({
            type: 'upsert',
            node: expect.objectContaining({ path: folder }),
          }),
          { type: 'remove', path: deleted },
        ]),
      }),
    )
  })

  it('unsubscribes the old workspace and ignores its late events', async () => {
    const firstRoot = root
    const secondRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'melo-watcher-next-'))
    const firstUnsubscribe = unsubscribe

    try {
      await watchWorkspace(firstRoot, sender() as never)
      unsubscribe = vi.fn().mockResolvedValue(undefined)
      await watchWorkspace(secondRoot, sender() as never)

      callbacks[0](null, [{ path: path.join(firstRoot, 'late.md'), type: 'create' }])
      await vi.advanceTimersByTimeAsync(500)

      expect(firstUnsubscribe).toHaveBeenCalledTimes(1)
      expect(mocks.indexFile).not.toHaveBeenCalled()
      expect(mocks.send).not.toHaveBeenCalled()
    } finally {
      fs.removeSync(secondRoot)
    }
  })

  it('scans a newly created directory once and suppresses duplicate child events', async () => {
    const folder = path.join(root, 'Imported')
    const child = path.join(folder, 'inside.md')
    fs.ensureDirSync(folder)
    fs.writeFileSync(child, '# Imported')
    mocks.listDirectoryContents.mockResolvedValue([
      {
        name: 'inside.md',
        path: child,
        type: 'text/markdown',
        isDirectory: false,
        size: 10,
        modifiedTime: 1,
        createdTime: 1,
      },
    ])

    await watchWorkspace(root, sender() as never)
    callbacks[0](null, [
      // Deliberately child-first: the flush sorts parents before descendants.
      { path: child, type: 'create' },
      { path: folder, type: 'create' },
    ])
    await vi.advanceTimersByTimeAsync(300)

    expect(mocks.listDirectoryContents).toHaveBeenCalledOnce()
    expect(mocks.indexFile).toHaveBeenCalledTimes(1)
    expect(mocks.indexFile).toHaveBeenCalledWith(child)
    const payload = mocks.send.mock.calls[0][1]
    expect(payload.changes).toHaveLength(1)
    expect(payload.changes[0]).toMatchObject({ type: 'upsert', node: { path: folder } })
  })

  it('recovers the serialized lifecycle after a subscription failure', async () => {
    mocks.subscribe.mockRejectedValueOnce(new Error('native backend unavailable'))
    await expect(watchWorkspace(root, sender() as never)).rejects.toThrow(
      'native backend unavailable',
    )

    await expect(watchWorkspace(root, sender() as never)).resolves.toBeUndefined()
    expect(mocks.subscribe).toHaveBeenCalledTimes(2)
  })

  it('reconnects once after a runtime backend error, then surfaces a terminal failure', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const webContents = sender()
    await watchWorkspace(root, webContents as never)

    callbacks[0](new Error('backend interrupted'), [])
    expect(mocks.senderSend).toHaveBeenCalledWith(IpcChannels.OnWorkspaceChanged, {
      kind: 'watcher-error',
      workspaceRoot: root,
      retrying: true,
    })

    await vi.advanceTimersByTimeAsync(1000)
    expect(mocks.subscribe).toHaveBeenCalledTimes(2)
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(mocks.senderSend).toHaveBeenLastCalledWith(IpcChannels.OnWorkspaceChanged, {
      kind: 'watcher-recovered',
      workspaceRoot: root,
    })

    callbacks[1](new Error('backend still unavailable'), [])
    expect(mocks.senderSend).toHaveBeenLastCalledWith(IpcChannels.OnWorkspaceChanged, {
      kind: 'watcher-error',
      workspaceRoot: root,
      retrying: false,
    })
    await vi.advanceTimersByTimeAsync(2000)
    expect(mocks.subscribe).toHaveBeenCalledTimes(2)
    errorLog.mockRestore()
  })
})
