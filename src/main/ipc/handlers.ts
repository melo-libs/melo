import { IpcMainInvokeEvent, app, BrowserWindow, dialog, shell } from 'electron'
import {
  IpcChannels,
  IpcChannelDefinitions,
  IpcResponseType,
  type LanguagePreference,
} from '../../shared/types/ipc'
import createMenu from '../menu'
import { resolveLanguage, LANGUAGE_KEY } from '../language'
import {
  saveFile,
  saveFileAs,
  openFileDialog,
  openDirectoryDialog,
  listDirectoryContents,
  renameFile,
  trashFile,
  duplicateFile,
  createFile,
  createDirectory,
  readAndProcessFile,
  quickPreviewFile,
  moveFile,
  checkPathExists,
  savePastedImage,
  getMimeType,
} from '../api/fileOperations/fileOperations'
import { checkClipboardHasFiles, pasteFiles } from '../api/fileOperations/clipboardOperations'
import { generatePDF } from '../libs/generatePDF'
import { watchWorkspace, unwatchWorkspace } from '../api/watcher'
import {
  openIndex,
  fullScan,
  searchIndex,
  getFileMeta,
  getAllTags,
  getFilesByTag,
  findBySource,
  listLinkTargets,
  resolveWikilinks,
  getNoteLinks,
  linkMention,
  querySmartRules,
  getClipSources,
  countSmartViews,
  getSmartVocab,
  activeWorkspaceRoot,
} from '../api/indexer'
import { getSmartViews, saveSmartViews } from '../api/smartViews'
import { downloadImageToAssets } from '../api/capture/pipeline'
import { sniffImageExt } from '../api/capture/pipeline'

/** IPC boundary: smart-view persistence must target the open workspace —
 *  a renderer-supplied path may not write .melo anywhere else. */
function assertActiveWorkspace(workspaceRoot: string): void {
  const active = activeWorkspaceRoot()
  if (!active || path.resolve(workspaceRoot) !== path.resolve(active)) {
    throw new Error('Not the active workspace')
  }
}

const MAX_SMART_VIEWS = 100
const MAX_SMART_RULES = 20
import { capture, previewUrl } from '../api/capture'
import {
  createWorkspace,
  listWorkspaces,
  registerWorkspace,
  relocateWorkspace,
  removeWorkspace,
  renameWorkspace,
} from '../api/workspaces'
import path from 'path'
import fs from 'fs-extra'
import { preferences } from '../preferences'
import { getSettings, updateSettings } from '../settings'
import { openSettingsWindow } from '../settingsWindow'
import { getMainWindow } from '../windows'
import { updateManager } from '../updater'

const LAST_DIRECTORY_KEY = 'lastDirectory'
const CODE_GUIDE_VERSION_KEY = 'codeGuideVersion'
const SIDEBAR_COLLAPSED_KEY = 'sidebarCollapsed'

type IpcHandler<K extends IpcChannels> = (
  event: IpcMainInvokeEvent,
  args: IpcChannelDefinitions[K]['args'],
) => Promise<IpcResponseType<K>>

/** Resolve a renderer-supplied path and require it to live inside the
 *  workspace. Compares realpaths so a symlink inside the workspace can't
 *  smuggle an outside target past a lexical prefix check. Returns null
 *  when there is no workspace or the path escapes it. */
async function workspacePath(p: string): Promise<string | null> {
  const rootPref = preferences.get(LAST_DIRECTORY_KEY) as string | null
  if (!rootPref) return null
  const root = await fs.realpath(rootPref)
  const resolved = await fs.realpath(path.resolve(p))
  return resolved === root || resolved.startsWith(root + path.sep) ? resolved : null
}

export const ipcHandlers: { [K in IpcChannels]?: IpcHandler<K> } = {
  [IpcChannels.InvokeSaveFile]: async (_event, args) => {
    try {
      const { content, filePath } = args
      const { mtime } = await saveFile(content, filePath)
      return { success: true, data: { mtime } }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  },

  [IpcChannels.InvokeSaveAs]: async (event, args) => {
    try {
      const { content, defaultPath } = args
      const win = BrowserWindow.fromWebContents(event.sender) ?? undefined
      const result = await saveFileAs(content, defaultPath, win, args.filters)
      return { success: true, data: result }
    } catch (error) {
      if (error instanceof Error && error.message === 'Operation cancelled') {
        return { success: false, error: 'Operation cancelled' }
      }
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  },

  [IpcChannels.InvokeOpenFile]: async (event) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender)
      const filePath = await openFileDialog(win)
      return { success: true, data: { filePath } }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  },

  [IpcChannels.InvokeOpenDirectory]: async () => {
    try {
      const directoryPath = await openDirectoryDialog()
      if (!directoryPath) {
        return { success: false, error: 'Operation cancelled' }
      }
      return { success: true, data: { directoryPath } }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  },

  [IpcChannels.InvokeListDirectory]: async (_, args) => {
    try {
      const files = await listDirectoryContents(args.directoryPath)
      return { success: true, data: { files } }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  },

  [IpcChannels.InvokeRenameFile]: async (_, args) => {
    try {
      const { oldPath, newName } = args
      const dir = path.dirname(oldPath)
      const newPath = path.join(dir, newName)
      // The new name must stay a sibling — reject separators / traversal.
      if (path.dirname(newPath) !== path.resolve(dir)) {
        return { success: false, error: 'Invalid file name' }
      }
      await renameFile(oldPath, newPath)
      return { success: true, data: { newPath } }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  },

  [IpcChannels.InvokeDeleteFile]: async (_, args) => {
    try {
      // The UI action is "Move to Trash" — recoverable from the Finder.
      await trashFile(args.path)
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  },

  [IpcChannels.InvokeCopyFile]: async (_, args) => {
    try {
      const newPath = await duplicateFile(args.sourcePath)
      return { success: true, data: { newPath } }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  },

  [IpcChannels.InvokeWatchWorkspace]: async (event, args) => {
    try {
      await watchWorkspace(args.directoryPath, event.sender)
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  },

  [IpcChannels.InvokeUnwatchWorkspace]: async () => {
    try {
      await unwatchWorkspace()
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  },

  [IpcChannels.InvokeInitIndex]: async (_event, args) => {
    try {
      openIndex(args.directoryPath)
      await fullScan()
      // A slower scan for a workspace that has already been switched away
      // must not publish the new workspace's source map under the old request.
      if (activeWorkspaceRoot() !== args.directoryPath) return { success: true }
      const sources = getClipSources()
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.webContents.isDestroyed())
          win.webContents.send(IpcChannels.OnWorkspaceChanged, {
            kind: 'index',
            workspaceRoot: args.directoryPath,
            sources,
          })
      }
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  },

  [IpcChannels.InvokeSearchIndex]: async (_, args) => {
    try {
      return { success: true, data: searchIndex(args.query) }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  },

  [IpcChannels.InvokeGetClipSources]: async () => {
    try {
      return { success: true, data: { sources: getClipSources() } }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  },

  [IpcChannels.InvokeGetFileMeta]: async (_, args) => {
    try {
      return { success: true, data: { meta: getFileMeta(args.path) } }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  },

  [IpcChannels.InvokeGetAllTags]: async () => {
    try {
      return { success: true, data: { tags: getAllTags() } }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  },

  [IpcChannels.InvokeGetFilesByTag]: async (_, args) => {
    try {
      return { success: true, data: { files: getFilesByTag(args.tag) } }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  },

  [IpcChannels.InvokeListLinkTargets]: async (_, args) => {
    try {
      return {
        success: true,
        data: { targets: listLinkTargets(args.query, args.excludePath) },
      }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  },

  [IpcChannels.InvokeResolveWikilinks]: async (_, args) => {
    try {
      return { success: true, data: { resolved: resolveWikilinks(args.targets) } }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  },

  [IpcChannels.InvokeGetNoteLinks]: async (_, args) => {
    try {
      return { success: true, data: getNoteLinks(args.path) }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  },

  [IpcChannels.InvokeLinkMention]: async (_, args) => {
    try {
      return { success: true, data: { linked: linkMention(args.sourcePath, args.targetTitle) } }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  },

  [IpcChannels.InvokeGetSmartViews]: async (_, args) => {
    try {
      assertActiveWorkspace(args.workspaceRoot)
      return { success: true, data: { views: getSmartViews(args.workspaceRoot) } }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  },

  [IpcChannels.InvokeSaveSmartViews]: async (_, args) => {
    try {
      assertActiveWorkspace(args.workspaceRoot)
      if (args.views.length > MAX_SMART_VIEWS) {
        return { success: false, error: 'Too many views' }
      }
      saveSmartViews(args.workspaceRoot, args.views)
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  },

  [IpcChannels.InvokeQuerySmartView]: async (_, args) => {
    try {
      return {
        success: true,
        data: { items: querySmartRules(args.rules.slice(0, MAX_SMART_RULES), 200, args.sort) },
      }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  },

  [IpcChannels.InvokeCountSmartViews]: async (_, args) => {
    try {
      const bounded = args.views
        .slice(0, MAX_SMART_VIEWS)
        .map((v) => ({ id: v.id, rules: v.rules.slice(0, MAX_SMART_RULES) }))
      return { success: true, data: { counts: countSmartViews(bounded) } }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  },

  [IpcChannels.InvokeGetSmartVocab]: async () => {
    try {
      return { success: true, data: getSmartVocab() }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  },

  [IpcChannels.InvokeCreateFile]: async (_, args) => {
    try {
      const { parentPath, name } = args
      const filePath = path.join(parentPath, name)
      // The name must stay a direct child of parentPath — reject separators
      // and traversal smuggled in via the name.
      if (path.dirname(filePath) !== path.resolve(parentPath)) {
        return { success: false, error: 'Invalid file name' }
      }
      await createFile(filePath)
      return { success: true, data: { filePath } }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  },

  [IpcChannels.InvokeCreateDirectory]: async (_, args) => {
    try {
      const { parentPath, name } = args
      const dirPath = path.join(parentPath, name)
      if (path.dirname(dirPath) !== path.resolve(parentPath)) {
        return { success: false, error: 'Invalid folder name' }
      }
      await createDirectory(dirPath)
      return { success: true, data: { directoryPath: dirPath } }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  },

  [IpcChannels.InvokeReadFile]: async (_, args) => {
    try {
      const result = await readAndProcessFile(args.filePath)
      return { success: true, data: result }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  },

  [IpcChannels.InvokeQuickPreview]: async (_, args) => {
    try {
      await quickPreviewFile(args.filePath)
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  },

  [IpcChannels.InvokeAddRecentDocument]: async (
    _: IpcMainInvokeEvent,
    args: IpcChannelDefinitions[IpcChannels.InvokeAddRecentDocument]['args'],
  ) => {
    try {
      app.addRecentDocument(args.filePath)
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to add to recent documents',
      }
    }
  },

  [IpcChannels.InvokeExportPDF]: async (event, args) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const dlg = await (win
      ? dialog.showSaveDialog(win, {
          defaultPath: `${args.defaultName}.pdf`,
          filters: [{ name: 'PDF', extensions: ['pdf'] }],
        })
      : dialog.showSaveDialog({
          defaultPath: `${args.defaultName}.pdf`,
          filters: [{ name: 'PDF', extensions: ['pdf'] }],
        }))
    if (dlg.canceled || !dlg.filePath) return { success: false, error: 'Operation cancelled' }
    try {
      await generatePDF(args.html, dlg.filePath)
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Export failed' }
    }
  },

  [IpcChannels.InvokeGetWorkspaceSize]: async (_, args) => {
    // Honest disk footprint: includes .assets images and the .melo index
    // the file tree hides. Symlinks are not followed (lstat semantics via
    // withFileTypes) so a link out of the workspace can't inflate the sum.
    const root = preferences.get(LAST_DIRECTORY_KEY) as string | null
    if (!root || args.directoryPath !== root) {
      return { success: false, error: 'Not the open workspace' }
    }
    const walk = async (dir: string): Promise<number> => {
      let total = 0
      let entries: import('fs').Dirent[]
      try {
        entries = await fs.readdir(dir, { withFileTypes: true })
      } catch {
        return 0
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) total += await walk(full)
        else if (entry.isFile()) {
          try {
            total += (await fs.stat(full)).size
          } catch {
            /* raced deletion — skip */
          }
        }
      }
      return total
    }
    return { success: true, data: { bytes: await walk(root) } }
  },

  [IpcChannels.InvokeGetFileStats]: async (_, args) => {
    try {
      const stats = await fs.stat(args.filePath)
      return {
        success: true,
        data: {
          mtime: stats.mtimeMs,
          size: stats.size,
          isDirectory: stats.isDirectory(),
        },
      }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  },

  [IpcChannels.InvokeMoveFile]: async (event, { sourcePath, targetPath, suggestedName }) => {
    try {
      const newPath = await moveFile(sourcePath, targetPath, suggestedName)
      // Emit FileMoved event
      event.sender.send(IpcChannels.FileMoved, { oldPath: sourcePath, newPath })
      return { success: true, data: { newPath } }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to move file',
      }
    }
  },

  [IpcChannels.InvokeShowMessageBox]: async (event, args) => {
    try {
      const window = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow()
      if (!window) {
        throw new Error('No focused window available')
      }

      const { response } = await dialog.showMessageBox(window, {
        type: args.type,
        title: args.title,
        message: args.message,
        detail: args.detail,
        buttons: args.buttons,
        defaultId: args.defaultId ?? 0,
        cancelId: args.cancelId ?? 0,
      })

      return { success: true, data: { response } }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to show message box',
      }
    }
  },

  [IpcChannels.InvokeGetLastDirectory]: async () => {
    try {
      const lastDirectory = preferences.get(LAST_DIRECTORY_KEY) as string | null

      // Check if the directory still exists
      if (lastDirectory && (await checkPathExists(lastDirectory))) {
        return { success: true, data: { directoryPath: lastDirectory } }
      }

      // If directory doesn't exist, clear it from preferences
      preferences.delete(LAST_DIRECTORY_KEY)
      return { success: true, data: { directoryPath: null } }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  },

  [IpcChannels.InvokeSaveLastDirectory]: async (_, args) => {
    try {
      preferences.set(LAST_DIRECTORY_KEY, args.directoryPath)
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  },

  [IpcChannels.InvokeGetCodeGuideState]: async () => {
    try {
      const stored = preferences.get(CODE_GUIDE_VERSION_KEY)
      const version = typeof stored === 'number' && Number.isFinite(stored) ? stored : 0
      return { success: true, data: { version } }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  },

  [IpcChannels.InvokeMarkCodeGuideOpened]: async (_, args) => {
    try {
      if (!Number.isInteger(args.version) || args.version < 1) {
        return { success: false, error: 'Invalid guide version' }
      }
      const stored = preferences.get(CODE_GUIDE_VERSION_KEY)
      const current = typeof stored === 'number' && Number.isFinite(stored) ? stored : 0
      preferences.set(CODE_GUIDE_VERSION_KEY, Math.max(current, args.version))
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  },

  [IpcChannels.InvokeGetSidebarCollapsed]: async () => {
    try {
      const isCollapsed = preferences.get(SIDEBAR_COLLAPSED_KEY) as boolean
      return { success: true, data: { isCollapsed: isCollapsed ?? true } }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  },

  [IpcChannels.InvokeSaveSidebarCollapsed]: async (_, args) => {
    try {
      preferences.set(SIDEBAR_COLLAPSED_KEY, args.isCollapsed)
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  },

  [IpcChannels.InvokeCheckClipboardHasFiles]: async () => {
    try {
      const hasFiles = checkClipboardHasFiles()
      return { success: true, data: { hasFiles } }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  },

  [IpcChannels.InvokePasteFiles]: async (_, args) => {
    try {
      const rootDir = preferences.get(LAST_DIRECTORY_KEY) as string | null
      if (!rootDir) return { success: false, error: 'No workspace open' }
      const result = await pasteFiles(args.targetPath, rootDir, args.onConflict)
      return { success: true, data: result }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  },

  [IpcChannels.InvokeImportImage]: async (event) => {
    const rootDir = preferences.get(LAST_DIRECTORY_KEY) as string | null
    if (!rootDir) return { success: false, error: 'No workspace open' }
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const dlg = await (win
      ? dialog.showOpenDialog(win, {
          properties: ['openFile'],
          filters: [
            { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'heic'] },
          ],
        })
      : dialog.showOpenDialog({
          properties: ['openFile'],
          filters: [
            { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'heic'] },
          ],
        }))
    if (dlg.canceled || !dlg.filePaths[0]) return { success: true, data: null }
    try {
      const source = dlg.filePaths[0]
      const buffer = await fs.readFile(source)
      // The dialog filter is filename theater, not validation — check the
      // bytes. SVG is text (sniffed loosely); heic has no cheap signature
      // and keeps its extension check.
      const ext = path.extname(source).slice(1).toLowerCase()
      const sniffed = sniffImageExt(buffer)
      const looksSvg =
        ext === 'svg' && /^\s*(<\?xml|<svg)/i.test(buffer.subarray(0, 256).toString('utf8'))
      if (!sniffed && !looksSvg && ext !== 'heic') {
        return { success: false, error: 'Not an image file' }
      }
      const mimeType = getMimeType(source)
      const result = await savePastedImage(buffer, mimeType, rootDir)
      return { success: true, data: { filePath: result.filePath } }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  },

  [IpcChannels.InvokeSavePastedImage]: async (_, args) => {
    try {
      const { imageBuffer, mimeType } = args

      // Get rootDir from preferences (lastDirectory)
      const rootDir = preferences.get(LAST_DIRECTORY_KEY) as string | null

      const result = await savePastedImage(imageBuffer, mimeType, rootDir)
      return { success: true, data: result }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  },

  [IpcChannels.InvokeGetLanguage]: async () => {
    const language = (preferences.get(LANGUAGE_KEY) as LanguagePreference | null) ?? 'system'
    return { success: true, data: { language, resolved: resolveLanguage(language) } }
  },

  [IpcChannels.InvokeSetLanguage]: async (_event, args) => {
    preferences.set(LANGUAGE_KEY, args.language)
    const resolved = resolveLanguage(args.language)
    // The application menu carries baked-in labels — rebuild it in the
    // new language immediately. Always against the MAIN window: the
    // sender may be the Settings window, and menu actions must keep
    // targeting the editor.
    const main = getMainWindow()
    if (main) createMenu(main, resolved)
    // Every window re-renders in the new language, not just the invoker.
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.send(IpcChannels.OnLanguageChanged, { resolved })
    }
    return { success: true, data: { resolved } }
  },

  [IpcChannels.InvokeGetSettings]: async () => {
    return { success: true, data: { settings: getSettings() } }
  },

  [IpcChannels.InvokeSetSettings]: async (_, args) => {
    return { success: true, data: { settings: updateSettings(args.patch) } }
  },

  [IpcChannels.InvokeOpenSettingsWindow]: async () => {
    openSettingsWindow()
    return { success: true }
  },

  [IpcChannels.InvokeGetAppVersion]: async () => {
    return { success: true, data: { version: app.getVersion() } }
  },

  [IpcChannels.InvokeCheckForUpdates]: async () => {
    void updateManager.checkForUpdates(true)
    return { success: true }
  },

  [IpcChannels.InvokeDownloadRemoteImage]: async (_, args) => {
    const rootDir = preferences.get(LAST_DIRECTORY_KEY) as string | null
    if (!rootDir) return { success: false, error: 'No workspace open' }
    if (!/^https?:\/\//i.test(args.url)) return { success: false, error: 'Not a remote URL' }
    const filePath = await downloadImageToAssets(args.url, rootDir)
    if (!filePath) return { success: false, error: 'Download failed' }
    return { success: true, data: { filePath } }
  },

  [IpcChannels.InvokeCaptureUrl]: async (_, args) => {
    try {
      const result = await capture(args.url, args.destFolder, args.workspaceRoot, {
        downloadImages: getSettings().clipDownloadImages,
      })
      return { success: true, data: result }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Capture failed' }
    }
  },

  [IpcChannels.InvokePreviewUrl]: async (_, args) => {
    try {
      const result = await previewUrl(args.url)
      return { success: true, data: result }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Preview failed' }
    }
  },

  [IpcChannels.InvokeFindBySource]: async (_, args) => {
    try {
      const found = findBySource(args.url)
      return { success: true, data: found }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Query failed' }
    }
  },

  [IpcChannels.InvokeRevealInFinder]: async (_, args) => {
    try {
      await shell.showItemInFolder(args.path)
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  },

  [IpcChannels.InvokeListWorkspaces]: async () => {
    try {
      return { success: true, data: { workspaces: await listWorkspaces() } }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  },

  [IpcChannels.InvokeRegisterWorkspace]: async (_, args) => {
    try {
      return { success: true, data: { path: await registerWorkspace(args.path) } }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  },

  [IpcChannels.InvokeRenameWorkspace]: async (_, args) => {
    try {
      renameWorkspace(args.path, args.name)
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  },

  [IpcChannels.InvokeRemoveWorkspace]: async (_, args) => {
    try {
      removeWorkspace(args.path)
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  },

  [IpcChannels.InvokeRelocateWorkspace]: async (event, args) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender) ?? undefined
      const newPath = await relocateWorkspace(args.path, win)
      return { success: true, data: { newPath } }
    } catch (error) {
      if (error instanceof Error && error.message === 'Operation cancelled') {
        return { success: false, error: 'Operation cancelled' }
      }
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  },

  [IpcChannels.InvokeCreateWorkspace]: async (event) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender) ?? undefined
      const created = await createWorkspace(win)
      return { success: true, data: { path: created } }
    } catch (error) {
      if (error instanceof Error && error.message === 'Operation cancelled') {
        return { success: false, error: 'Operation cancelled' }
      }
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  },

  [IpcChannels.InvokeOpenPath]: async (_, args) => {
    try {
      const resolved = await workspacePath(args.path)
      if (!resolved) return { success: false, error: 'Path outside workspace' }
      const err = await shell.openPath(resolved)
      if (err) return { success: false, error: err }
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  },

  [IpcChannels.InvokeReadFileBinary]: async (_, args) => {
    try {
      const resolved = await workspacePath(args.filePath)
      if (!resolved) return { success: false, error: 'Path outside workspace' }
      // The whole file crosses the IPC boundary as one buffer — refuse
      // sizes that would stall the main process or spike memory.
      const { size } = await fs.stat(resolved)
      if (size > 256 * 1024 * 1024) {
        return { success: false, error: 'File is too large to render (over 256 MB)' }
      }
      const data = await fs.readFile(resolved)
      return { success: true, data: { data } }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  },

  [IpcChannels.InvokeOpenExternal]: async (_, args) => {
    try {
      if (!/^https?:\/\//i.test(args.url)) {
        return { success: false, error: 'Only http(s) URLs can be opened' }
      }
      await shell.openExternal(args.url)
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  },
}

// Helper function to ensure type safety when registering handlers
export function getHandler<K extends IpcChannels>(channel: K): IpcHandler<K> | undefined {
  return ipcHandlers[channel] as IpcHandler<K> | undefined
}
