import path from 'node:path'
import { app, autoUpdater as nativeUpdater, BrowserWindow, Menu, net, shell } from 'electron'
import type { AppUpdater, UpdateCheckResult, UpdateInfo } from 'electron-updater'
import { INITIAL_UPDATE_STATE, IpcChannels, type UpdateState } from '../shared/types/ipc'
import { en } from '../shared/locales/en'
import { zhCN } from '../shared/locales/zh-CN'
import { resolveLanguage } from './language'
import {
  downloadMacUpdate,
  loadPendingMacUpdate,
  savePendingMacUpdate,
  selectMacUpdate,
  verifyMacUpdate,
  type DownloadedMacUpdate,
} from './macUpdate'
import { preferences } from './preferences'
import { getSettings } from './settings'
import { scheduleUpdateChecks } from './updateSchedule'
import { isNewerVersion, updateRelease } from './updateRelease'
import { supportsNativeMacUpdates } from './updateInstallMode'
import { openUpdateWindow, resizeUpdateWindow } from './updateWindow'

const updaterTestMode = !app.isPackaged && process.env.MELO_UPDATER_TEST === '1'
const updaterEnabled = app.isPackaged || updaterTestMode
// Only the certificate-signed packaging entry point sets this in the app manifest.
// Runtime environment variables must not enable native installation for ad-hoc builds.
const nativeMacUpdates = app.isPackaged && supportsNativeMacUpdates(app.getAppPath())
const manualUpdateInstall = process.platform === 'darwin' && !updaterTestMode && !nativeMacUpdates
const PROMPTED_VERSION_KEY = 'updatePromptedVersion'

export class UpdateManager {
  private mainWindow: BrowserWindow | null = null
  private check: Promise<void> | null = null
  private ignoreRevision = 0
  private checkingRevision = 0
  private manualCheckRequested = false
  private initialization: Promise<void> | null = null
  private availableInfo: UpdateInfo | null = null
  private state: UpdateState = { ...INITIAL_UPDATE_STATE }
  private download: Promise<void> | null = null
  private downloadAbort: AbortController | null = null
  private cancellationToken: UpdateCheckResult['cancellationToken']
  private opening: Promise<void> | null = null
  private installer: DownloadedMacUpdate | null = null
  private promptedVersion = preferences.get<string>(PROMPTED_VERSION_KEY)

  public constructor(
    private readonly updater: AppUpdater | null,
    private readonly manualInstall = manualUpdateInstall,
  ) {
    if (!updater) return
    updater.autoDownload = false
    updater.autoInstallOnAppQuit = false
    updater.forceDevUpdateConfig = updaterTestMode
    updater.logger = console
    updater.allowDowngrade = false
    updater.allowPrerelease = false
    updater.on('error', (error) => {
      console.error('Update error:', error)
      if (this.state.installation === 'opening') this.failInstallation()
    })
    updater.on('download-progress', (progress) => {
      if (this.state.download.status !== 'downloading') return
      this.setState({ download: { ...this.state.download, percent: Math.floor(progress.percent) } })
    })
  }

  private get copy() {
    return (resolveLanguage() === 'zh-CN' ? zhCN : en).updates
  }

  private get cacheDirectory() {
    return path.join(app.getPath('userData'), 'updates')
  }

  private failInstallation(): void {
    const version = this.state.ready?.release.version
    this.setState({
      installation: 'error',
      ...(!this.manualInstall && version
        ? { ready: null, download: { status: 'error' as const, version } }
        : {}),
    })
  }

  public setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window
  }

  public getState(): UpdateState {
    return this.state
  }

  private setState(patch: Partial<UpdateState>): void {
    this.state = { ...this.state, ...patch, revision: this.state.revision + 1 }
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.setProgressBar(
        this.state.download.status === 'downloading' ? this.state.download.percent / 100 : -1,
      )
    }
    const item = Menu.getApplicationMenu()?.getMenuItemById('install-update')
    if (item) item.visible = this.state.ready !== null
    resizeUpdateWindow(this.state.release !== null || this.state.ready !== null)
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(IpcChannels.OnUpdateState, this.state)
    }
  }

  public initialize(): Promise<void> {
    this.initialization ??= (async () => {
      if (!this.updater || !this.manualInstall) return
      try {
        const pending = await loadPendingMacUpdate(
          this.cacheDirectory,
          app.getVersion(),
          process.arch,
        )
        const ignored = preferences.get<string>('ignoredVersion')
        if (pending && (!ignored || isNewerVersion(pending.release.version, ignored))) {
          this.installer = pending.installer
          this.setState({ ready: { release: pending.release, install: 'manual' } })
        }
      } catch (error) {
        // An unreadable cache must not prevent checking or downloading a fresh copy.
        console.error('Could not restore the pending update:', error)
      }
    })()
    return this.initialization
  }

  public showUpdateWindow(): void {
    openUpdateWindow(true, this.state.release !== null || this.state.ready !== null)
  }

  public ignoreVersion(version: string): void {
    const release = this.state.release ?? this.state.ready?.release
    if (!release || release.version !== version || this.state.installation === 'opening') {
      throw new Error(this.copy.ignoreUnavailable)
    }
    const ignored = preferences.get<string>('ignoredVersion')
    if (!ignored || isNewerVersion(version, ignored)) preferences.set('ignoredVersion', version)
    this.ignoreRevision++
    if (this.download) {
      this.downloadAbort?.abort()
      this.cancellationToken?.cancel()
    }
    this.availableInfo = null
    this.installer = null
    this.setState({
      check: 'idle',
      release: null,
      ready: null,
      download: { status: 'idle' },
      installation: 'idle',
    })
  }

  public async checkForUpdates(manual = false): Promise<UpdateState> {
    if (manual) this.showUpdateWindow()
    if (!this.updater) {
      this.setState({ check: 'disabled' })
      return this.state
    }
    if (this.state.installation === 'opening') return this.state
    // A manual request joins the existing task; it still opens/focuses the window above.
    if (this.check) {
      if (this.checkingRevision !== this.ignoreRevision) {
        await this.check
        return this.checkForUpdates(manual)
      }
      if (manual) this.manualCheckRequested = true
      await this.check
      return this.state
    }
    if (this.download && !this.downloadAbort?.signal.aborted) return this.state
    this.manualCheckRequested = manual
    this.checkingRevision = this.ignoreRevision
    this.check = this.performCheck()
    try {
      await this.check
    } finally {
      this.check = null
      this.manualCheckRequested = false
    }
    return this.state
  }

  private async performCheck(): Promise<void> {
    const ignoreRevision = this.ignoreRevision
    // Keep this wait inside the shared check task so simultaneous retries still coalesce.
    if (this.downloadAbort?.signal.aborted && this.download) await this.download
    this.setState({
      check: 'checking',
      installation: this.state.installation === 'error' ? 'idle' : this.state.installation,
      ...(!this.state.ready ? { download: { status: 'idle' as const } } : {}),
    })
    await this.initialize()
    try {
      let available = false
      const onAvailable = (): void => {
        available = true
      }
      this.updater!.once('update-available', onAvailable)
      let result: Awaited<ReturnType<AppUpdater['checkForUpdates']>>
      try {
        result = await this.updater!.checkForUpdates()
      } finally {
        this.updater!.removeListener('update-available', onAvailable)
      }
      if (ignoreRevision !== this.ignoreRevision) {
        this.setState({ check: 'idle' })
        return
      }
      if (!result) {
        this.setState({ check: 'disabled' })
        return
      }
      const info = result.updateInfo
      if (!available || !isNewerVersion(info.version, app.getVersion())) {
        this.availableInfo = null
        this.setState({
          check: 'up-to-date',
          release: null,
          ...(!this.state.ready
            ? { installation: 'idle', download: { status: 'idle' as const } }
            : {}),
        })
        return
      }
      const manual = this.manualCheckRequested
      const ignored = preferences.get<string>('ignoredVersion')
      if (!manual && ignored && !isNewerVersion(info.version, ignored)) {
        this.setState({ check: 'idle' })
        return
      }
      this.availableInfo = info
      this.cancellationToken = result.cancellationToken
      const release = updateRelease(info)
      this.setState({ check: 'idle', release })
      if (!this.promptedVersion || isNewerVersion(info.version, this.promptedVersion)) {
        this.promptedVersion = info.version
        preferences.set(PROMPTED_VERSION_KEY, info.version)
        if (!manual) openUpdateWindow(false, true)
      }
      if (getSettings().autoUpdate && this.state.ready?.release.version !== info.version) {
        void this.downloadAvailableUpdate().catch((error) => {
          console.error('Update download failed:', error)
        })
      }
    } catch (error) {
      if (ignoreRevision !== this.ignoreRevision) return
      console.error('Update check failed:', error)
      this.setState({ check: 'error' })
    }
  }

  public async downloadAvailableUpdate(): Promise<void> {
    if (this.download) return this.download
    const ignoreRevision = this.ignoreRevision
    // A metadata check may replace the offered version; choose the artifact only after it settles.
    if (this.check) await this.check
    await this.initialize()
    // Ignore supersedes requests that were queued before any actual download started.
    if (ignoreRevision !== this.ignoreRevision) return
    // initialize() yields, so a second caller may already have started the job.
    if (this.download) return this.download
    if (this.state.installation === 'opening') throw new Error(this.copy.installationInProgress)
    if (!this.updater || !this.availableInfo) throw new Error(this.copy.checkFirst)
    const info = this.availableInfo
    if (this.state.ready?.release.version === info.version) return
    const release = updateRelease(info)
    const controller = new AbortController()
    this.downloadAbort = controller
    this.setState({
      download: { status: 'downloading', version: info.version, percent: 0 },
      installation: 'idle',
      // electron-updater replaces its previous native installer cache when downloading again.
      ready: this.manualInstall ? this.state.ready : null,
    })
    this.download = (async () => {
      try {
        if (this.manualInstall) {
          const installer = await downloadMacUpdate(
            selectMacUpdate(info, process.arch),
            this.cacheDirectory,
            (url, init) => net.fetch(url, init),
            (percent) => {
              if (controller.signal.aborted) return
              this.setState({
                download: { status: 'downloading', version: info.version, percent },
              })
            },
            controller.signal,
          )
          if (controller.signal.aborted) return
          // An open/reveal action holds a snapshot of the old package until it finishes.
          if (this.opening) {
            await this.opening.catch((error) => {
              // Failure to open the previous package does not invalidate the new download.
              console.warn('Previous installer action failed:', error)
            })
          }
          await savePendingMacUpdate(installer, release, this.cacheDirectory)
          if (controller.signal.aborted) return
          this.installer = installer
        } else {
          await this.updater!.downloadUpdate(this.cancellationToken)
        }
        if (controller.signal.aborted) return
        this.setState({
          download: { status: 'idle' },
          ready: { release, install: this.manualInstall ? 'manual' : 'in-app' },
          installation: 'idle',
        })
      } catch (error) {
        if (controller.signal.aborted) return
        this.setState({ download: { status: 'error', version: info.version } })
        throw error
      }
    })()
    try {
      await this.download
    } finally {
      this.download = null
      this.downloadAbort = null
    }
  }

  public async openInstaller(version: string, reveal = false): Promise<void> {
    await this.initialize()
    if (this.download) throw new Error(this.copy.downloadInProgress)
    if (this.state.ready?.release.version !== version) throw new Error(this.copy.installerChanged)
    if (this.opening) return this.opening
    // Native quit can still be pending after the preparation task has resolved.
    if (this.state.installation === 'opening') return
    this.setState({ installation: 'opening' })
    this.opening = (async () => {
      try {
        if (!this.manualInstall) {
          if (updaterTestMode) throw new Error(this.copy.testReadyDetail)
          if (process.platform === 'darwin') await this.prepareNativeMacUpdate()
          this.updater!.quitAndInstall(false, true)
          return
        }
        const installer = this.installer
        if (!installer || !(await verifyMacUpdate(installer))) {
          this.installer = null
          this.setState({ ready: null, download: { status: 'error', version } })
          throw new Error(this.copy.invalidInstaller)
        }
        if (reveal) shell.showItemInFolder(installer.filePath)
        else {
          const error = await shell.openPath(installer.filePath)
          if (error) throw new Error(error)
        }
        this.setState({ installation: 'opened' })
      } catch (error) {
        this.failInstallation()
        throw error
      }
    })()
    try {
      await this.opening
    } finally {
      this.opening = null
    }
  }

  private prepareNativeMacUpdate(): Promise<void> {
    // MacUpdater.quitAndInstall() leaves a persistent callback if Squirrel is not ready.
    // Prepare through Electron's public API first, so a failed attempt leaves no install callback.
    return new Promise((resolve, reject) => {
      const complete = (): void => {
        cleanup()
        resolve()
      }
      const failed = (error: Error): void => {
        cleanup()
        reject(error)
      }
      const unavailable = (): void => failed(new Error(this.copy.invalidInstaller))
      const cleanup = (): void => {
        nativeUpdater.removeListener('update-downloaded', complete)
        nativeUpdater.removeListener('update-not-available', unavailable)
        this.updater!.removeListener('error', failed)
      }
      nativeUpdater.once('update-downloaded', complete)
      nativeUpdater.once('update-not-available', unavailable)
      this.updater!.once('error', failed)
      try {
        nativeUpdater.checkForUpdates()
      } catch (error) {
        cleanup()
        reject(error)
      }
    })
  }
}

// Keep the require behind the mode guard so ordinary dev runs never initialize it.
export const updateManager = new UpdateManager(
  updaterEnabled
    ? (require('electron-updater') as typeof import('electron-updater')).autoUpdater
    : null,
)

app.whenReady().then(() => {
  if (!updaterEnabled) return
  void updateManager.initialize()
  const stop = scheduleUpdateChecks(() => {
    if (getSettings().autoUpdate) void updateManager.checkForUpdates()
  })
  app.once('will-quit', stop)
})
