import { app, Menu, shell, BrowserWindow, MenuItemConstructorOptions } from 'electron'
import { IpcChannels, type ResolvedLanguage } from '../shared/types/ipc'
import { en } from '../shared/locales/en'
import { zhCN } from '../shared/locales/zh-CN'
import { openFileDialog, sendFileToRenderer } from './api/fileOperations/fileOperations'
import { updateManager } from './updater'
import { openSettingsWindow } from './settingsWindow'

export default function createMenu(
  mainWindow: BrowserWindow,
  locale: ResolvedLanguage = 'en',
): void {
  const isMac = process.platform === 'darwin'
  const m = (locale === 'zh-CN' ? zhCN : en).menu

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              {
                label: m.settings,
                accelerator: 'CmdOrCtrl+,',
                click: () => openSettingsWindow(),
              },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ] as MenuItemConstructorOptions[],
          } as MenuItemConstructorOptions,
        ]
      : []),
    {
      label: m.file,
      submenu: [
        {
          label: m.newFile,
          accelerator: 'CmdOrCtrl+N',
          click: () => mainWindow.webContents.send(IpcChannels.FileNew),
        },
        {
          label: m.openFolder,
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => mainWindow.webContents.send(IpcChannels.OpenWorkspace, undefined),
        },
        {
          label: m.openFile,
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            const filePath = await openFileDialog(mainWindow)
            if (filePath) {
              sendFileToRenderer(filePath, mainWindow)
            }
          },
        },
        {
          label: m.openRecent,
          role: 'recentDocuments',
          submenu: [
            {
              label: m.clearRecent,
              role: 'clearRecentDocuments',
            },
          ],
        },
        { type: 'separator' },
        {
          label: m.save,
          accelerator: 'CmdOrCtrl+S',
          click: () => {
            mainWindow.webContents.send(IpcChannels.OnSave)
          },
        },
        ...(!isMac
          ? ([
              { type: 'separator' },
              {
                label: m.settings,
                accelerator: 'CmdOrCtrl+,',
                click: () => openSettingsWindow(),
              },
            ] as MenuItemConstructorOptions[])
          : []),
        { type: 'separator' },
        {
          label: m.closeTab,
          accelerator: 'CmdOrCtrl+W',
          click: () => {
            // With another window focused (Settings), ⌘W closes THAT
            // window — never a note tab behind it.
            const focused = BrowserWindow.getFocusedWindow()
            if (focused && focused !== mainWindow) focused.close()
            else mainWindow.webContents.send(IpcChannels.CloseCurrentTab)
          },
        },
      ] as MenuItemConstructorOptions[],
    },
    {
      label: m.edit,
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'delete' },
        { type: 'separator' },
        { role: 'selectAll' },
      ] as MenuItemConstructorOptions[],
    },
    {
      label: m.view,
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ] as MenuItemConstructorOptions[],
    },
    {
      label: m.window,
      role: 'window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac
          ? [{ type: 'separator' }, { role: 'front' }, { type: 'separator' }, { role: 'window' }]
          : [{ role: 'close' }]),
      ] as MenuItemConstructorOptions[],
    },
    {
      label: m.help,
      role: 'help',
      submenu: [
        {
          label: m.codeGuide,
          click: () => mainWindow.webContents.send(IpcChannels.OpenCodeGuide, undefined),
        },
        { type: 'separator' },
        {
          label: m.checkUpdates,
          click: () => {
            updateManager.checkForUpdates(true)
          },
        },
        { type: 'separator' },
        {
          label: m.reportIssue,
          click: async () => {
            await shell.openExternal('https://github.com/melo-libs/melo/issues')
          },
        },
        {
          label: m.learnMore,
          click: async () => {
            await shell.openExternal('https://www.melolib.com')
          },
        },
      ] as MenuItemConstructorOptions[],
    },
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}
