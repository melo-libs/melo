import { app, BrowserWindow, dialog } from 'electron'
import type { AppUpdater, ProgressInfo } from 'electron-updater'
import { preferences } from './preferences'
import { getSettings } from './settings'

const updaterTestMode = !app.isPackaged && process.env.MELO_UPDATER_TEST === '1'
const updaterEnabled = app.isPackaged || updaterTestMode

export class UpdateManager {
  private static instance: UpdateManager
  private mainWindow: BrowserWindow | null = null
  private checking = false
  private progressWin: BrowserWindow | null = null
  private isManualCheck = false
  private updater: AppUpdater | null = null

  private constructor() {
    // Normal dev sessions must not contact the release channel. The explicit
    // test mode exercises update checks and downloads without ever installing.
    if (!updaterEnabled) return

    // Keep this require after the mode guard: ordinary dev runs should not
    // initialize electron-updater or any of its platform-specific machinery.
    const { autoUpdater: updater } =
      require('electron-updater') as typeof import('electron-updater')
    this.updater = updater

    // Configure autoUpdater
    updater.autoDownload = false
    updater.autoInstallOnAppQuit = !updaterTestMode
    updater.forceDevUpdateConfig = updaterTestMode
    updater.logger = console
    updater.allowDowngrade = false
    updater.allowPrerelease = false

    // Handle update events
    updater.on('error', () => {
      this.checking = false
      this.closeProgressWindow()
      // Let the checkForUpdates method handle the error dialog
    })

    updater.on('checking-for-update', () => {
      console.log('Checking for updates...')
    })

    updater.on('update-available', async (info) => {
      this.checking = false

      // Skip if this version is ignored and it's not a manual check
      const ignoredVersion = preferences.get<string>('ignoredVersion')
      if (!this.isManualCheck && ignoredVersion === info.version) {
        return
      }

      const { response } = await dialog.showMessageBox(this.getWindow(), {
        type: 'info',
        title: 'Update Available',
        message: `Version ${info.version} is available.`,
        detail: updaterTestMode
          ? 'Download it to test the update flow? Installation is disabled in test mode.'
          : 'Would you like to download and install it now?',
        buttons: updaterTestMode
          ? ['Download', 'Cancel', 'Ignore this version']
          : ['Yes', 'No', 'Ignore this version'],
        cancelId: 1,
      })

      if (response === 0) {
        this.createProgressWindow()
        updater.downloadUpdate()
      } else if (response === 2) {
        // Store the ignored version
        preferences.set('ignoredVersion', info.version)
      }
    })

    updater.on('update-not-available', () => {
      this.checking = false
      if (this.isManualCheck) {
        this.showUpdateDialog({
          type: 'info',
          title: 'No Updates',
          message: 'You are using the latest version.',
        })
      }
    })

    updater.on('download-progress', (progress: ProgressInfo) => {
      if (this.mainWindow) {
        this.mainWindow.setProgressBar(progress.percent / 100)
      }
      this.updateProgressWindow(progress)
    })

    updater.on('update-downloaded', async () => {
      this.closeProgressWindow()

      if (updaterTestMode) {
        await dialog.showMessageBox(this.getWindow(), {
          type: 'info',
          title: 'Update Test Complete',
          message: 'The update was downloaded successfully.',
          detail: 'Installation and restart are disabled in updater test mode.',
          buttons: ['OK'],
        })
        return
      }

      const { response } = await dialog.showMessageBox(this.getWindow(), {
        type: 'info',
        title: 'Update Ready',
        message: 'Update has been downloaded',
        detail: 'The application will quit and update now',
        buttons: ['Restart', 'Later'],
        cancelId: 1,
      })

      if (response === 0) {
        updater.quitAndInstall(false, true)
      }
    })
  }

  private createProgressWindow() {
    this.closeProgressWindow()

    this.progressWin = new BrowserWindow({
      width: 400,
      height: 150,
      useContentSize: true,
      titleBarStyle: 'hidden',
      trafficLightPosition: { x: 8, y: 6 },
      resizable: false,
      minimizable: false,
      maximizable: false,
      parent: this.mainWindow || undefined,
      modal: true,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    })

    // Create HTML content for the progress window
    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Downloading Update</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
              margin: 0;
              padding: 20px;
              user-select: none;
              -webkit-user-select: none;
              background: #ffffff;
              color: #333333;
            }
            #title {
              font-size: 14px;
              margin-bottom: 10px;
              -webkit-app-region: drag;
            }
            #progressBar {
              width: 100%;
              height: 8px;
              background-color: #f0f0f0;
              border-radius: 4px;
              overflow: hidden;
            }
            #progressFill {
              width: 0%;
              height: 100%;
              background-color: #007AFF;
              border-radius: 4px;
              transition: width 0.3s ease;
            }
            #status {
              font-size: 12px;
              margin-top: 10px;
              color: #666666;
            }
          </style>
        </head>
        <body>
          <div id="title">Downloading Update...</div>
          <div id="progressBar">
            <div id="progressFill"></div>
          </div>
          <div id="status">Starting download...</div>
          <script>
            window.updateProgress = function(percent, speed, transferred, total) {
              document.getElementById('progressFill').style.width = percent + '%';
              document.getElementById('status').textContent =
                'Downloaded ' + transferred + ' of ' + total + ' (' + speed + ')';
            };
          </script>
        </body>
      </html>
    `

    // Load the HTML content
    this.progressWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(htmlContent))

    this.progressWin.once('ready-to-show', () => {
      if (this.progressWin) {
        this.progressWin.show()
      }
    })
  }

  private updateProgressWindow(progressInfo: ProgressInfo) {
    if (!this.progressWin) return

    const percent = progressInfo.percent || 0
    const transferred = this.formatBytes(progressInfo.transferred)
    const total = this.formatBytes(progressInfo.total)
    const speed = this.formatBytes(progressInfo.bytesPerSecond) + '/s'

    this.progressWin.webContents.executeJavaScript(
      `updateProgress(${percent}, "${speed}", "${transferred}", "${total}")`,
    )
  }

  private formatBytes(bytes: number, decimals = 2): string {
    if (bytes === 0) return '0 B'
    const k = 1024
    const dm = decimals < 0 ? 0 : decimals
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i]
  }

  private closeProgressWindow() {
    if (this.progressWin) {
      this.progressWin.destroy()
      this.progressWin = null
    }
    if (this.mainWindow) {
      this.mainWindow.setProgressBar(-1) // Remove progress bar
    }
  }

  public static getInstance(): UpdateManager {
    if (!UpdateManager.instance) {
      UpdateManager.instance = new UpdateManager()
    }
    return UpdateManager.instance
  }

  public setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window
  }

  private getWindow(): BrowserWindow {
    if (!this.mainWindow) {
      throw new Error('Main window is not set')
    }
    return this.mainWindow
  }

  private showUpdateDialog(options: Electron.MessageBoxOptions): void {
    dialog.showMessageBox(this.getWindow(), options)
  }

  private showErrorDialog(error: Error): void {
    let errorMessage = 'Failed to check for updates'
    let errorDetail = error.message

    // Handle specific error cases
    if (error.message.includes('404')) {
      errorMessage = 'Update server is not reachable'
      errorDetail = 'Please try again later or check our website for updates.'
    }

    this.showUpdateDialog({
      type: 'error',
      title: 'Update Error',
      message: errorMessage,
      detail: errorDetail,
    })
  }

  public async checkForUpdates(manual = false): Promise<void> {
    const updater = this.updater
    if (!updaterEnabled || !updater) return
    if (this.checking) {
      console.log('Update check already in progress')
      return
    }

    try {
      this.checking = true
      this.isManualCheck = manual
      await updater.checkForUpdates()
    } catch (error) {
      console.error('Update check error:', error)
      this.checking = false
      if (manual) {
        this.showErrorDialog(error instanceof Error ? error : new Error('Unknown error'))
      }
    }
  }
}

// Initialize update manager
export const updateManager = UpdateManager.getInstance()

// Start checking for updates when app is ready
app.whenReady().then(() => {
  if (!updaterEnabled) return

  // Check for updates every 6 hours
  setInterval(
    () => {
      // For automatic checks, only proceed if enabled and not already checking
      if (getSettings().autoUpdate && !updateManager['checking']) {
        updateManager.checkForUpdates(false)
      }
    },
    6 * 60 * 60 * 1000,
  )

  // Initial check after app is ready
  setTimeout(() => {
    if (getSettings().autoUpdate) updateManager.checkForUpdates()
  }, 60000) // Check after 60 seconds to allow app to fully load
})
