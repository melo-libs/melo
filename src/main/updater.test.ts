import { EventEmitter } from 'node:events'
import { autoUpdater as nativeUpdater } from 'electron'
import type { AppUpdater, UpdateInfo } from 'electron-updater'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UpdateManager } from './updater'
import { updateRelease } from './updateRelease'

const mocks = vi.hoisted(() => ({
  download: vi.fn<typeof import('./macUpdate').downloadMacUpdate>(),
  verify: vi.fn<typeof import('./macUpdate').verifyMacUpdate>(),
  load: vi.fn<typeof import('./macUpdate').loadPendingMacUpdate>(),
  save: vi.fn<typeof import('./macUpdate').savePendingMacUpdate>(),
  openPath: vi.fn<() => Promise<string>>(),
  reveal: vi.fn(),
  window: vi.fn(),
  resize: vi.fn(),
  send: vi.fn(),
  preferences: new Map<string, string>(),
  autoUpdate: true,
  menu: { visible: false },
}))
vi.mock('electron', async () => ({
  autoUpdater: Object.assign(new (await import('node:events')).EventEmitter(), {
    checkForUpdates: vi.fn(),
    quitAndInstall: vi.fn(),
  }),
  app: {
    isPackaged: false,
    whenReady: () => Promise.resolve(),
    getPath: () => '/profile',
    getVersion: () => '2.0.1',
  },
  BrowserWindow: { getAllWindows: () => [{ webContents: { send: mocks.send } }] },
  Menu: { getApplicationMenu: () => ({ getMenuItemById: () => mocks.menu }) },
  shell: { openPath: mocks.openPath, showItemInFolder: mocks.reveal },
  net: { fetch: vi.fn() },
}))
vi.mock('./updateWindow', () => ({
  openUpdateWindow: mocks.window,
  resizeUpdateWindow: mocks.resize,
}))
vi.mock('./preferences', () => ({
  preferences: {
    get: (key: string) => mocks.preferences.get(key),
    set: (key: string, value: string) => mocks.preferences.set(key, value),
  },
}))
vi.mock('./settings', () => ({ getSettings: () => ({ autoUpdate: mocks.autoUpdate }) }))
vi.mock('./language', () => ({ resolveLanguage: () => 'en' }))
vi.mock('./macUpdate', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./macUpdate')>()),
  downloadMacUpdate: mocks.download,
  verifyMacUpdate: mocks.verify,
  loadPendingMacUpdate: mocks.load,
  savePendingMacUpdate: mocks.save,
}))

const info: UpdateInfo = {
  version: '2.0.2',
  releaseDate: '2026-10-22',
  releaseNotes: '<h2>Improvements</h2><ul><li>Better search</li><li>Faster startup</li></ul>',
  path: 'unused.zip',
  sha512: 'a'.repeat(86) + '==',
  files: ['arm64', 'x64'].map((arch) => ({
    url: 'melo-lite-2.0.2-' + arch + '.dmg',
    size: 10,
    sha512: 'a'.repeat(86) + '==',
  })),
}
const installer = {
  filePath: '/profile/updates/2.0.2/installer.dmg',
  artifact: {
    version: '2.0.2',
    fileName: 'installer.dmg',
    url: 'https://github.com/fixture',
    size: 10,
    sha512: info.sha512,
  },
}
function makeManager(updateInfo = info, manualInstall = true) {
  const updater = new EventEmitter() as AppUpdater
  updater.checkForUpdates = vi.fn(async () => {
    updater.emit('update-available', updateInfo)
    return { updateInfo, versionInfo: updateInfo }
  })
  updater.downloadUpdate = vi.fn(async () => [])
  updater.quitAndInstall = vi.fn()
  if (!manualInstall) {
    let prepared = false
    nativeUpdater.on('error', (error) => updater.emit('error', error))
    nativeUpdater.on('update-downloaded', () => {
      prepared = true
    })
    // Match MacUpdater's deferred native installation without launching or installing anything.
    vi.mocked(updater.quitAndInstall).mockImplementation(() => {
      if (prepared) nativeUpdater.quitAndInstall()
      else {
        nativeUpdater.on('update-downloaded', () => nativeUpdater.quitAndInstall())
        nativeUpdater.checkForUpdates()
      }
    })
  }
  return { manager: new UpdateManager(updater, manualInstall), updater }
}
beforeEach(() => {
  vi.resetAllMocks()
  nativeUpdater.removeAllListeners()
  mocks.preferences.clear()
  mocks.autoUpdate = true
  mocks.menu.visible = false
  mocks.download.mockResolvedValue(installer)
  mocks.verify.mockResolvedValue(true)
  mocks.load.mockResolvedValue(null)
  mocks.save.mockResolvedValue()
  mocks.openPath.mockResolvedValue('')
})
describe.runIf(process.platform === 'darwin')('the macOS update flow', () => {
  it('opens the update window once, downloads in-app, and exposes notes and progress in the same state', async () => {
    const { manager, updater } = makeManager()
    await manager.checkForUpdates()
    await manager.downloadAvailableUpdate()
    expect(manager.getState().ready).toEqual({ release: updateRelease(info), install: 'manual' })
    expect(manager.getState().release?.notes).toContain('Better search')
    expect(mocks.window).toHaveBeenCalledOnce()
    expect(mocks.window).toHaveBeenCalledWith(false, true)
    expect(mocks.save).toHaveBeenCalledWith(installer, updateRelease(info), '/profile/updates')
    expect(mocks.menu.visible).toBe(true)
    expect(updater.downloadUpdate).not.toHaveBeenCalled()
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
    expect(updater.autoInstallOnAppQuit).toBe(false)
  })
  it('does not repeatedly prompt on timed checks, even across restarts', async () => {
    const { manager } = makeManager()
    await manager.checkForUpdates()
    await manager.downloadAvailableUpdate()
    await manager.checkForUpdates()
    const next = makeManager().manager
    await next.checkForUpdates()
    await next.downloadAvailableUpdate()
    expect(mocks.window).toHaveBeenCalledOnce()
  })
  it('manual checks focus the window and still check the server with an older installer cached', async () => {
    const { manager, updater } = makeManager()
    await manager.checkForUpdates()
    await manager.downloadAvailableUpdate()
    mocks.autoUpdate = false
    const newer = {
      ...info,
      version: '2.0.3',
      files: info.files.map((file) => ({ ...file, url: file.url.replace('2.0.2', '2.0.3') })),
    }
    vi.mocked(updater.checkForUpdates).mockImplementationOnce(async () => {
      updater.emit('update-available', newer)
      return { updateInfo: newer, versionInfo: newer }
    })
    await manager.checkForUpdates(true)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
    expect(manager.getState().release?.version).toBe('2.0.3')
    expect(manager.getState().ready?.release.version).toBe('2.0.2')
    expect(mocks.window).toHaveBeenLastCalledWith(true, true)
  })
  it('coalesces concurrent checks, including a manual request during an automatic check', async () => {
    const { manager, updater } = makeManager()
    let complete!: (value: Awaited<ReturnType<AppUpdater['checkForUpdates']>>) => void
    vi.mocked(updater.checkForUpdates).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve
        }),
    )
    const first = manager.checkForUpdates()
    await vi.waitFor(() => expect(updater.checkForUpdates).toHaveBeenCalledOnce())
    const second = manager.checkForUpdates(true)
    expect(mocks.window).toHaveBeenCalledWith(true, false)
    updater.emit('update-available', info)
    complete({ updateInfo: info, versionInfo: info })
    await Promise.all([first, second])
    await manager.downloadAvailableUpdate()
    expect(updater.checkForUpdates).toHaveBeenCalledOnce()
    expect(mocks.download).toHaveBeenCalledOnce()
  })
  it('coalesces downloads and shows progress while manual checks keep the same job', async () => {
    let complete!: (value: typeof installer) => void
    mocks.download.mockImplementationOnce(async (_artifact, _cache, _fetch, progress) => {
      progress(42)
      return new Promise((resolve) => {
        complete = resolve
      })
    })
    const { manager, updater } = makeManager()
    await manager.checkForUpdates()
    await vi.waitFor(() =>
      expect(manager.getState().download).toEqual({
        status: 'downloading',
        version: '2.0.2',
        percent: 42,
      }),
    )
    const second = manager.downloadAvailableUpdate()
    await manager.checkForUpdates(true)
    expect(updater.checkForUpdates).toHaveBeenCalledOnce()
    expect(mocks.download).toHaveBeenCalledOnce()
    complete(installer)
    await second
    expect(manager.getState().ready?.release.version).toBe('2.0.2')
  })
  it('restores a verified installer before a check, even offline, without automatically reopening the prompt', async () => {
    mocks.load.mockResolvedValueOnce({ installer, release: updateRelease(info) })
    const { manager, updater } = makeManager()
    vi.mocked(updater.checkForUpdates).mockRejectedValueOnce(new Error('Offline'))
    const log = vi.spyOn(console, 'error').mockImplementation(vi.fn())
    try {
      await manager.initialize()
      await manager.checkForUpdates()
      expect(manager.getState().check).toBe('error')
      expect(manager.getState().ready?.release.version).toBe('2.0.2')
      await manager.openInstaller('2.0.2')
      expect(mocks.openPath).toHaveBeenCalledWith(installer.filePath)
      expect(mocks.window).not.toHaveBeenCalled()
    } finally {
      log.mockRestore()
    }
  })
  it('respects disabled background downloads but permits an explicit download', async () => {
    mocks.autoUpdate = false
    const { manager } = makeManager()
    await manager.checkForUpdates(true)
    expect(mocks.download).not.toHaveBeenCalled()
    await manager.downloadAvailableUpdate()
    expect(mocks.download).toHaveBeenCalledOnce()
  })
  it('honors previously ignored versions only for automatic checks', async () => {
    mocks.preferences.set('ignoredVersion', '2.0.2')
    const { manager } = makeManager()
    await manager.checkForUpdates()
    expect(mocks.window).not.toHaveBeenCalled()
    expect(mocks.download).not.toHaveBeenCalled()
    await manager.checkForUpdates(true)
    await manager.downloadAvailableUpdate()
    expect(mocks.download).toHaveBeenCalledOnce()
  })
  it('does not lose the old installer if downloading a newer release fails', async () => {
    mocks.load.mockResolvedValueOnce({ installer, release: updateRelease(info) })
    const newer = {
      ...info,
      version: '2.0.3',
      files: info.files.map((file) => ({ ...file, url: file.url.replace('2.0.2', '2.0.3') })),
    }
    const { manager } = makeManager(newer)
    mocks.autoUpdate = false
    await manager.checkForUpdates(true)
    mocks.download.mockRejectedValueOnce(new Error('Offline'))
    await expect(manager.downloadAvailableUpdate()).rejects.toThrow()
    expect(manager.getState().ready?.release.version).toBe('2.0.2')
    expect(mocks.download).toHaveBeenCalledOnce()
    expect(mocks.save).not.toHaveBeenCalled()
    await manager.openInstaller('2.0.2')
    expect(mocks.openPath).toHaveBeenCalledWith(installer.filePath)
  })
  it('allows retry after synchronous metadata errors and download errors', async () => {
    mocks.autoUpdate = false
    const { manager, updater } = makeManager({ ...info, files: [] })
    await manager.checkForUpdates(true)
    await expect(manager.downloadAvailableUpdate()).rejects.toThrow()
    await expect(manager.downloadAvailableUpdate()).rejects.toThrow()
    vi.mocked(updater.checkForUpdates).mockImplementationOnce(async () => {
      updater.emit('update-available', info)
      return { updateInfo: info, versionInfo: info }
    })
    await manager.checkForUpdates(true)
    mocks.download.mockRejectedValueOnce(new Error('Offline'))
    await expect(manager.downloadAvailableUpdate()).rejects.toThrow()
    await manager.downloadAvailableUpdate()
    expect(manager.getState().ready?.release.version).toBe('2.0.2')
  })
  it('opens the verified package directly, without stacking another confirmation dialog', async () => {
    const { manager, updater } = makeManager()
    await manager.checkForUpdates()
    await manager.downloadAvailableUpdate()
    await manager.openInstaller('2.0.2')
    expect(mocks.openPath).toHaveBeenCalledOnce()
    expect(mocks.openPath).toHaveBeenCalledWith(installer.filePath)
    expect(manager.getState().installation).toBe('opened')
    await manager.openInstaller('2.0.2', true)
    expect(mocks.reveal).toHaveBeenCalledWith(installer.filePath)
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
  })
  it('rejects stale install actions and missing or tampered packages', async () => {
    const { manager } = makeManager()
    await manager.checkForUpdates()
    await manager.downloadAvailableUpdate()
    await expect(manager.openInstaller('2.0.1')).rejects.toThrow()
    mocks.verify.mockResolvedValueOnce(false)
    await expect(manager.openInstaller('2.0.2')).rejects.toThrow()
    expect(mocks.openPath).not.toHaveBeenCalled()
    expect(manager.getState().ready).toBeNull()
    expect(manager.getState().download.status).toBe('error')
  })
  it('reports a failed installer action in-place without clearing the verified package', async () => {
    const { manager } = makeManager()
    await manager.checkForUpdates()
    await manager.downloadAvailableUpdate()
    mocks.openPath.mockResolvedValueOnce('Cannot mount')
    await expect(manager.openInstaller('2.0.2')).rejects.toThrow('Cannot mount')
    expect(manager.getState().installation).toBe('error')
    expect(manager.getState().ready?.release.version).toBe('2.0.2')
  })
  it('clears a missing installer error when a fresh check confirms no update is available', async () => {
    mocks.autoUpdate = false
    mocks.load.mockResolvedValueOnce({ installer, release: updateRelease(info) })
    const { manager, updater } = makeManager()
    await manager.initialize()
    mocks.verify.mockResolvedValueOnce(false)
    await expect(manager.openInstaller(info.version)).rejects.toThrow()
    expect(manager.getState().installation).toBe('error')
    vi.mocked(updater.checkForUpdates).mockImplementationOnce(async () => {
      updater.emit('update-not-available', info)
      return { updateInfo: info, versionInfo: info }
    })
    await manager.checkForUpdates(true)
    expect(manager.getState()).toMatchObject({
      check: 'up-to-date',
      release: null,
      ready: null,
      installation: 'idle',
      download: { status: 'idle' },
    })
  })
  it('clears a missing installer failure before a fresh check, including an offline retry', async () => {
    mocks.autoUpdate = false
    mocks.load.mockResolvedValueOnce({ installer, release: updateRelease(info) })
    const { manager, updater } = makeManager()
    await manager.initialize()
    mocks.verify.mockResolvedValueOnce(false)
    await expect(manager.openInstaller(info.version)).rejects.toThrow()
    expect(manager.getState().installation).toBe('error')
    let fail!: (error: Error) => void
    vi.mocked(updater.checkForUpdates).mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject
        }),
    )
    const log = vi.spyOn(console, 'error').mockImplementation(vi.fn())
    try {
      const checking = manager.checkForUpdates(true)
      await vi.waitFor(() => expect(updater.checkForUpdates).toHaveBeenCalledOnce())
      const pendingState = { ...manager.getState() }
      fail(new Error('Offline'))
      await checking
      expect(pendingState).toMatchObject({
        check: 'checking',
        ready: null,
        installation: 'idle',
        download: { status: 'idle' },
      })
      expect(manager.getState()).toMatchObject({
        check: 'error',
        ready: null,
        installation: 'idle',
        download: { status: 'idle' },
      })
    } finally {
      log.mockRestore()
    }
  })
  it('supersedes an earlier open failure without discarding the verified installer', async () => {
    mocks.autoUpdate = false
    mocks.load.mockResolvedValueOnce({ installer, release: updateRelease(info) })
    const { manager, updater } = makeManager()
    await manager.initialize()
    mocks.openPath.mockResolvedValueOnce('Cannot mount')
    await expect(manager.openInstaller(info.version)).rejects.toThrow('Cannot mount')
    vi.mocked(updater.checkForUpdates).mockRejectedValueOnce(new Error('Offline'))
    const log = vi.spyOn(console, 'error').mockImplementation(vi.fn())
    try {
      await manager.checkForUpdates(true)
      expect(manager.getState()).toMatchObject({
        check: 'error',
        installation: 'idle',
        ready: { release: updateRelease(info), install: 'manual' },
      })
      await manager.openInstaller(info.version)
      expect(manager.getState().installation).toBe('opened')
    } finally {
      log.mockRestore()
    }
  })
  it('does not offer a newer release rejected by the upstream eligibility checks', async () => {
    const { manager, updater } = makeManager()
    vi.mocked(updater.checkForUpdates).mockImplementationOnce(async () => {
      updater.emit('update-not-available', info)
      return { updateInfo: info, versionInfo: info }
    })
    await manager.checkForUpdates()
    expect(manager.getState().check).toBe('up-to-date')
    expect(mocks.window).not.toHaveBeenCalled()
    expect(mocks.download).not.toHaveBeenCalled()
  })
  it('synchronizes compact and expanded content without creating windows for state changes', async () => {
    mocks.autoUpdate = false
    const { manager, updater } = makeManager()
    await manager.checkForUpdates(true)
    expect(mocks.window).toHaveBeenCalledWith(true, false)
    expect(mocks.resize).toHaveBeenLastCalledWith(true)
    vi.mocked(updater.checkForUpdates).mockImplementationOnce(async () => {
      updater.emit('update-not-available', info)
      return { updateInfo: info, versionInfo: info }
    })
    await manager.checkForUpdates(true)
    expect(mocks.window).toHaveBeenLastCalledWith(true, true)
    expect(manager.getState().check).toBe('up-to-date')
    expect(mocks.resize).toHaveBeenLastCalledWith(false)
    expect(mocks.window).toHaveBeenCalledTimes(2)
  })
  it('uses the upstream downloader and installer for a native signed build', async () => {
    const { manager, updater } = makeManager(info, false)
    await manager.checkForUpdates(true)
    await manager.downloadAvailableUpdate()
    expect(manager.getState().ready?.install).toBe('in-app')
    expect(updater.downloadUpdate).toHaveBeenCalledOnce()
    expect(mocks.download).not.toHaveBeenCalled()
    const installing = manager.openInstaller(info.version)
    await vi.waitFor(() => expect(nativeUpdater.checkForUpdates).toHaveBeenCalledOnce())
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
    nativeUpdater.emit('update-downloaded')
    await installing
    expect(updater.quitAndInstall).toHaveBeenCalledOnce()
    expect(nativeUpdater.quitAndInstall).toHaveBeenCalledOnce()
  })
  it('keeps native installation single-flight until Squirrel is ready', async () => {
    const { manager, updater } = makeManager(info, false)
    await manager.checkForUpdates(true)
    await manager.downloadAvailableUpdate()
    const first = manager.openInstaller(info.version)
    const second = manager.openInstaller(info.version)
    await vi.waitFor(() => expect(nativeUpdater.checkForUpdates).toHaveBeenCalledOnce())
    expect(manager.getState().installation).toBe('opening')
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
    await manager.checkForUpdates(true)
    expect(updater.checkForUpdates).toHaveBeenCalledOnce()
    await expect(manager.downloadAvailableUpdate()).rejects.toThrow('installation')
    nativeUpdater.emit('update-downloaded')
    await Promise.all([first, second])
    await manager.openInstaller(info.version)
    expect(updater.quitAndInstall).toHaveBeenCalledOnce()
    expect(nativeUpdater.quitAndInstall).toHaveBeenCalledOnce()
    expect(nativeUpdater.listenerCount('update-downloaded')).toBe(1)
  })
  it.each(['unavailable', 'throw'])(
    'cleans up native preparation and enables another download after %s',
    async (failure) => {
      const { manager, updater } = makeManager(info, false)
      await manager.checkForUpdates(true)
      await manager.downloadAvailableUpdate()
      vi.mocked(nativeUpdater.checkForUpdates).mockImplementationOnce(() => {
        if (failure === 'throw') throw new Error('Native updater failed')
        nativeUpdater.emit('update-not-available')
      })
      await expect(manager.openInstaller(info.version)).rejects.toThrow()
      expect(manager.getState().ready).toBeNull()
      expect(manager.getState().installation).toBe('error')
      expect(updater.quitAndInstall).not.toHaveBeenCalled()
      expect(nativeUpdater.listenerCount('update-downloaded')).toBe(1)
      expect(nativeUpdater.listenerCount('update-not-available')).toBe(0)
      await manager.downloadAvailableUpdate()
      expect(updater.downloadUpdate).toHaveBeenCalledTimes(2)
    },
  )
  it('invalidates a native installer when an error arrives after requesting quit', async () => {
    const { manager } = makeManager(info, false)
    await manager.checkForUpdates(true)
    await manager.downloadAvailableUpdate()
    const installing = manager.openInstaller(info.version)
    await vi.waitFor(() => expect(nativeUpdater.checkForUpdates).toHaveBeenCalledOnce())
    nativeUpdater.emit('update-downloaded')
    await installing
    const log = vi.spyOn(console, 'error').mockImplementation(vi.fn())
    try {
      nativeUpdater.emit('error', new Error('Cannot replace application'))
      expect(manager.getState().installation).toBe('error')
      expect(manager.getState().ready).toBeNull()
      await manager.downloadAvailableUpdate()
      expect(manager.getState().installation).toBe('idle')
    } finally {
      log.mockRestore()
    }
  })
  it('allows re-downloading after native failure without retaining stale install callbacks', async () => {
    const { manager, updater } = makeManager(info, false)
    await manager.checkForUpdates(true)
    await manager.downloadAvailableUpdate()
    const installing = manager.openInstaller(info.version)
    await vi.waitFor(() => expect(nativeUpdater.checkForUpdates).toHaveBeenCalledOnce())
    const log = vi.spyOn(console, 'error').mockImplementation(vi.fn())
    try {
      const rejected = expect(installing).rejects.toThrow('Installer missing')
      nativeUpdater.emit('error', new Error('Installer missing'))
      await rejected
      expect(manager.getState().installation).toBe('error')
      expect(manager.getState().ready).toBeNull()
      expect(manager.getState().download).toEqual({ status: 'error', version: info.version })
      expect(nativeUpdater.listenerCount('update-downloaded')).toBe(1)
      await manager.downloadAvailableUpdate()
      expect(updater.downloadUpdate).toHaveBeenCalledTimes(2)
      const retry = manager.openInstaller(info.version)
      await vi.waitFor(() => expect(nativeUpdater.checkForUpdates).toHaveBeenCalledTimes(2))
      nativeUpdater.emit('update-downloaded')
      await retry
      expect(nativeUpdater.quitAndInstall).toHaveBeenCalledOnce()
      expect(updater.quitAndInstall).toHaveBeenCalledOnce()
      expect(nativeUpdater.listenerCount('update-downloaded')).toBe(1)
    } finally {
      log.mockRestore()
    }
  })
  it('waits for pending metadata before downloading and never restores an ignored installer', async () => {
    mocks.autoUpdate = false
    const { manager, updater } = makeManager()
    await manager.checkForUpdates(true)
    const newer = {
      ...info,
      version: '2.0.3',
      files: info.files.map((file) => ({ ...file, url: file.url.replace('2.0.2', '2.0.3') })),
    }
    let finishCheck!: () => void
    vi.mocked(updater.checkForUpdates).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishCheck = () => {
            updater.emit('update-available', newer)
            resolve({ updateInfo: newer, versionInfo: newer })
          }
        }),
    )
    let finishDownload!: () => void
    let signal!: AbortSignal
    mocks.download.mockImplementationOnce((artifact, _cache, _fetch, _progress, abort) => {
      signal = abort!
      return new Promise((resolve) => {
        finishDownload = () => resolve({ ...installer, artifact })
      })
    })
    const checking = manager.checkForUpdates(true)
    const downloading = manager.downloadAvailableUpdate()
    await vi.waitFor(() => expect(updater.checkForUpdates).toHaveBeenCalledTimes(2))
    finishCheck()
    await checking
    await vi.waitFor(() => expect(mocks.download).toHaveBeenCalledOnce())
    manager.ignoreVersion(newer.version)
    finishDownload()
    await downloading
    expect(mocks.download.mock.calls[0][0].version).toBe(newer.version)
    expect(signal.aborted).toBe(true)
    expect(manager.getState().ready).toBeNull()
    expect(mocks.menu.visible).toBe(false)
  })
  it('coalesces manual checks that wait for the same cancelled download', async () => {
    const { manager, updater } = makeManager(info, false)
    let finish!: (files: string[]) => void
    vi.mocked(updater.downloadUpdate).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    await manager.checkForUpdates()
    const downloading = manager.downloadAvailableUpdate()
    await vi.waitFor(() => expect(updater.downloadUpdate).toHaveBeenCalledOnce())
    manager.ignoreVersion(info.version)
    mocks.autoUpdate = false
    const first = manager.checkForUpdates(true)
    const second = manager.checkForUpdates(true)
    finish([])
    await Promise.all([downloading, first, second])
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
  })
  it('discards a queued download and pending check when the offered version is ignored', async () => {
    mocks.autoUpdate = false
    const { manager, updater } = makeManager()
    await manager.checkForUpdates(true)
    let finish!: () => void
    vi.mocked(updater.checkForUpdates).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => {
            updater.emit('update-available', info)
            resolve({ updateInfo: info, versionInfo: info })
          }
        }),
    )
    const checking = manager.checkForUpdates(true)
    const downloading = manager.downloadAvailableUpdate()
    await vi.waitFor(() => expect(updater.checkForUpdates).toHaveBeenCalledTimes(2))
    manager.ignoreVersion(info.version)
    finish()
    await Promise.all([checking, downloading])
    expect(mocks.download).not.toHaveBeenCalled()
    expect(manager.getState().release).toBeNull()
    expect(manager.getState().ready).toBeNull()
    expect(manager.getState().check).toBe('idle')
  })
  it('starts a fresh manual check after Ignore instead of joining a superseded check', async () => {
    mocks.autoUpdate = false
    const { manager, updater } = makeManager()
    await manager.checkForUpdates(true)
    let finish!: () => void
    vi.mocked(updater.checkForUpdates).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => {
            updater.emit('update-available', info)
            resolve({ updateInfo: info, versionInfo: info })
          }
        }),
    )
    const superseded = manager.checkForUpdates(true)
    await vi.waitFor(() => expect(updater.checkForUpdates).toHaveBeenCalledTimes(2))
    manager.ignoreVersion(info.version)
    const manual = manager.checkForUpdates(true)
    const another = manager.checkForUpdates(true)
    finish()
    await Promise.all([superseded, manual, another])
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(3)
    expect(manager.getState().release?.version).toBe(info.version)
    await manager.downloadAvailableUpdate()
    expect(mocks.download).toHaveBeenCalledOnce()
  })
  it('does not surface a superseded check failure after Ignore', async () => {
    mocks.autoUpdate = false
    const { manager, updater } = makeManager()
    await manager.checkForUpdates(true)
    let fail!: (error: Error) => void
    vi.mocked(updater.checkForUpdates).mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject
        }),
    )
    const checking = manager.checkForUpdates(true)
    await vi.waitFor(() => expect(updater.checkForUpdates).toHaveBeenCalledTimes(2))
    manager.ignoreVersion(info.version)
    fail(new Error('Offline'))
    await checking
    expect(manager.getState().check).toBe('idle')
    expect(manager.getState().release).toBeNull()
  })
  it('persists a skipped version without automatically restoring or offering it again', async () => {
    const { manager } = makeManager()
    await manager.checkForUpdates()
    await manager.downloadAvailableUpdate()
    manager.ignoreVersion(info.version)
    expect(mocks.preferences.get('ignoredVersion')).toBe(info.version)
    expect(manager.getState().release).toBeNull()
    expect(manager.getState().ready).toBeNull()
    mocks.load.mockResolvedValueOnce({ installer, release: updateRelease(info) })
    const next = makeManager().manager
    await next.initialize()
    await next.checkForUpdates()
    expect(next.getState().ready).toBeNull()
    expect(next.getState().release).toBeNull()
    expect(mocks.download).toHaveBeenCalledOnce()
    expect(mocks.window).toHaveBeenCalledOnce()
    await next.checkForUpdates(true)
    await next.downloadAvailableUpdate()
    expect(next.getState().ready?.release.version).toBe(info.version)
  })
  it('aborts an ignored download without surfacing an error or offering installation', async () => {
    mocks.download.mockImplementationOnce(async (_artifact, _cache, _fetch, progress, signal) => {
      progress(42)
      return new Promise((_resolve, reject) => {
        signal!.addEventListener('abort', () => reject(signal!.reason), { once: true })
      })
    })
    const { manager } = makeManager()
    await manager.checkForUpdates()
    const download = manager.downloadAvailableUpdate()
    await vi.waitFor(() => expect(manager.getState().download.status).toBe('downloading'))
    manager.ignoreVersion(info.version)
    await download
    expect(manager.getState().download.status).toBe('idle')
    expect(manager.getState().ready).toBeNull()
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it('does not re-offer an ignored native download after it completes', async () => {
    const { manager, updater } = makeManager(info, false)
    let complete!: (files: string[]) => void
    vi.mocked(updater.downloadUpdate).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve
        }),
    )
    await manager.checkForUpdates()
    const download = manager.downloadAvailableUpdate()
    await vi.waitFor(() => expect(updater.downloadUpdate).toHaveBeenCalledOnce())
    manager.ignoreVersion(info.version)
    complete([])
    await download
    expect(manager.getState().ready).toBeNull()
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
  })
  it('offers a later release normally after skipping the preceding version', async () => {
    mocks.preferences.set('ignoredVersion', '2.0.2')
    mocks.autoUpdate = false
    const { manager } = makeManager({ ...info, version: '2.0.3' })
    await manager.checkForUpdates()
    expect(manager.getState().release?.version).toBe('2.0.3')
    expect(mocks.window).toHaveBeenCalledWith(false, true)
  })
  it('rejects stale skip actions instead of changing the stored preference', async () => {
    mocks.autoUpdate = false
    const { manager } = makeManager()
    await manager.checkForUpdates()
    expect(() => manager.ignoreVersion('2.0.1')).toThrow()
    expect(mocks.preferences.has('ignoredVersion')).toBe(false)
  })
  it('honors a manual override that joins an automatic check for a skipped version', async () => {
    mocks.preferences.set('ignoredVersion', info.version)
    mocks.autoUpdate = false
    const { manager, updater } = makeManager()
    let complete!: (value: Awaited<ReturnType<AppUpdater['checkForUpdates']>>) => void
    vi.mocked(updater.checkForUpdates).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve
        }),
    )
    const automatic = manager.checkForUpdates()
    await vi.waitFor(() => expect(updater.checkForUpdates).toHaveBeenCalledOnce())
    const manual = manager.checkForUpdates(true)
    updater.emit('update-available', info)
    complete({ updateInfo: info, versionInfo: info })
    await Promise.all([automatic, manual])
    expect(manager.getState().release?.version).toBe(info.version)
  })
  it('does not restore or automatically offer an older installer after skipping a newer release', async () => {
    mocks.preferences.set('ignoredVersion', '2.0.3')
    mocks.load.mockResolvedValueOnce({ installer, release: updateRelease(info) })
    const { manager } = makeManager()
    await manager.initialize()
    await manager.checkForUpdates()
    expect(manager.getState().ready).toBeNull()
    expect(manager.getState().release).toBeNull()
    expect(mocks.window).not.toHaveBeenCalled()
  })
  it('cannot open a skipped package under an older version when skipping overlaps cache commit', async () => {
    mocks.autoUpdate = false
    mocks.load.mockResolvedValueOnce({ installer, release: updateRelease(info) })
    const newer = {
      ...info,
      version: '2.0.3',
      files: info.files.map((file) => ({ ...file, url: file.url.replace('2.0.2', '2.0.3') })),
    }
    const { manager } = makeManager(newer)
    await manager.checkForUpdates(true)
    let complete!: () => void
    mocks.save.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve
        }),
    )
    const download = manager.downloadAvailableUpdate()
    await vi.waitFor(() => expect(mocks.save).toHaveBeenCalledOnce())
    manager.ignoreVersion(newer.version)
    complete()
    await download
    expect(manager.getState().ready).toBeNull()
    await expect(manager.openInstaller(info.version)).rejects.toThrow()
    expect(mocks.openPath).not.toHaveBeenCalled()
  })
  it('retains an explicitly offered skipped version across later automatic checks', async () => {
    mocks.preferences.set('ignoredVersion', info.version)
    mocks.autoUpdate = false
    const { manager } = makeManager()
    await manager.checkForUpdates(true)
    mocks.download.mockRejectedValueOnce(new Error('Offline'))
    await expect(manager.downloadAvailableUpdate()).rejects.toThrow('Offline')
    await manager.checkForUpdates()
    await manager.downloadAvailableUpdate()
    expect(manager.getState().ready?.release.version).toBe(info.version)
  })
  it('does not offer an old native installer after its cache is replaced by a failed newer download', async () => {
    mocks.autoUpdate = false
    const { manager, updater } = makeManager(info, false)
    await manager.checkForUpdates(true)
    await manager.downloadAvailableUpdate()
    expect(manager.getState().ready?.release.version).toBe(info.version)
    const newer = { ...info, version: '2.0.3' }
    vi.mocked(updater.checkForUpdates).mockImplementationOnce(async () => {
      updater.emit('update-available', newer)
      return { updateInfo: newer, versionInfo: newer }
    })
    await manager.checkForUpdates(true)
    vi.mocked(updater.downloadUpdate).mockRejectedValueOnce(new Error('Offline'))
    await expect(manager.downloadAvailableUpdate()).rejects.toThrow('Offline')
    expect(manager.getState().ready).toBeNull()
    await expect(manager.openInstaller(info.version)).rejects.toThrow()
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
  })
})
