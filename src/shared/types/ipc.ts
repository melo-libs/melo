import type { SmartHit, SmartRule, SmartViewDef, SmartVocab } from './smart'
import type { AppSettings } from './settings'

export enum IpcChannels {
  // Send-only channels (renderer -> main)
  FileNew = 'file-new',
  FileMoved = 'file-moved',

  // Event-based channels (main -> renderer)
  OnFileOpened = 'on-file-opened',
  OnWorkspaceChanged = 'on-workspace-changed',
  OnSave = 'on-save',
  OnLanguageChanged = 'on-language-changed',
  OnSettingsChanged = 'on-settings-changed',
  OpenWorkspace = 'open-workspace',
  OpenCodeGuide = 'open-code-guide',
  FlushBeforeClose = 'flush-before-close',
  CloseCurrentTab = 'close-current-tab',

  // Event-based channels (renderer -> main)
  RendererReady = 'renderer-ready',
  ReadyToClose = 'ready-to-close',
  CancelClose = 'cancel-close',

  // Invoke-based channels (renderer -> main with response)
  InvokeSaveFile = 'invoke-save-file',
  InvokeSaveAs = 'invoke-save-as',
  InvokeOpenFile = 'invoke-open-file',
  InvokeOpenDirectory = 'invoke-open-directory',
  InvokeListDirectory = 'invoke-list-directory',
  InvokeRenameFile = 'invoke-rename-file',
  InvokeDeleteFile = 'invoke-delete-file',
  InvokeCreateFile = 'invoke-create-file',
  InvokeCreateDirectory = 'invoke-create-directory',
  InvokeReadFile = 'invoke-read-file',
  // Raw bytes of a workspace file (viewer tabs: pdf rendering)
  InvokeReadFileBinary = 'invoke-read-file-binary',
  InvokeQuickPreview = 'invoke-quick-preview',
  InvokeAddRecentDocument = 'invoke-add-recent-document',
  InvokeGetFileStats = 'invoke-get-file-stats',
  InvokeMoveFile = 'invoke-move-file',
  InvokeShowMessageBox = 'invoke-show-message-box',
  // Add new channels for last directory management
  InvokeGetLastDirectory = 'invoke-get-last-directory',
  InvokeSaveLastDirectory = 'invoke-save-last-directory',
  InvokeGetCodeGuideState = 'invoke-get-code-guide-state',
  InvokeMarkCodeGuideOpened = 'invoke-mark-code-guide-opened',
  // Add new channels for sidebar collapse state
  InvokeGetSidebarCollapsed = 'invoke-get-sidebar-collapsed',
  InvokeSaveSidebarCollapsed = 'invoke-save-sidebar-collapsed',
  // Add new channels for clipboard operations
  InvokeCheckClipboardHasFiles = 'invoke-check-clipboard-has-files',
  InvokePasteFiles = 'invoke-paste-files',
  // Add new channel for saving pasted image
  InvokeSavePastedImage = 'invoke-save-pasted-image',
  InvokeDownloadRemoteImage = 'invoke-download-remote-image',
  // Add new channel for revealing in finder
  InvokeRevealInFinder = 'invoke-reveal-in-finder',
  // Workspace registry (the switcher's list of known workspaces)
  InvokeListWorkspaces = 'invoke-list-workspaces',
  InvokeRegisterWorkspace = 'invoke-register-workspace',
  InvokeRenameWorkspace = 'invoke-rename-workspace',
  InvokeRemoveWorkspace = 'invoke-remove-workspace',
  InvokeRelocateWorkspace = 'invoke-relocate-workspace',
  InvokeCreateWorkspace = 'invoke-create-workspace',
  // Open a workspace file with the OS default application
  InvokeOpenPath = 'invoke-open-path',
  // Open an http(s) URL in the system browser
  InvokeOpenExternal = 'invoke-open-external',
  // Duplicate a file or directory next to itself ("name copy.ext")
  InvokeCopyFile = 'invoke-copy-file',
  // Watch the workspace folder for external changes
  InvokeWatchWorkspace = 'invoke-watch-workspace',
  InvokeUnwatchWorkspace = 'invoke-unwatch-workspace',
  // Index layer (.melo/index.db)
  InvokeInitIndex = 'invoke-init-index',
  InvokeSearchIndex = 'invoke-search-index',
  InvokeGetFileMeta = 'invoke-get-file-meta',
  InvokeGetClipSources = 'invoke-get-clip-sources',
  InvokeGetAllTags = 'invoke-get-all-tags',
  InvokeGetFilesByTag = 'invoke-get-files-by-tag',
  // Wikilinks: picker candidates + batch target resolution
  InvokeListLinkTargets = 'invoke-list-link-targets',
  InvokeResolveWikilinks = 'invoke-resolve-wikilinks',
  // Backlinks panel / Links tab data for one note; link an unlinked mention
  InvokeGetNoteLinks = 'invoke-get-note-links',
  InvokeLinkMention = 'invoke-link-mention',
  // Smart folders: definitions (.melo/views.json), query, counts, vocab
  InvokeGetSmartViews = 'invoke-get-smart-views',
  InvokeSaveSmartViews = 'invoke-save-smart-views',
  InvokeQuerySmartView = 'invoke-query-smart-view',
  InvokeCountSmartViews = 'invoke-count-smart-views',
  InvokeGetSmartVocab = 'invoke-get-smart-vocab',
  // Capture a URL into the workspace as a .md file
  InvokeCaptureUrl = 'invoke-capture-url',
  // Preview a URL (fetch + extract metadata, no write)
  InvokePreviewUrl = 'invoke-preview-url',
  // Check if a source URL was already captured
  InvokeFindBySource = 'invoke-find-by-source',
  // UI language preference ('system' follows the OS locale)
  InvokeGetLanguage = 'invoke-get-language',
  InvokeSetLanguage = 'invoke-set-language',
  InvokeGetSettings = 'invoke-get-settings',
  InvokeSetSettings = 'invoke-set-settings',
  InvokeOpenSettingsWindow = 'invoke-open-settings-window',
  InvokeGetAppVersion = 'invoke-get-app-version',
  InvokeCheckForUpdates = 'invoke-check-for-updates',
  InvokeGetWorkspaceSize = 'invoke-get-workspace-size',
  InvokeExportPDF = 'invoke-export-pdf',
  InvokeImportImage = 'invoke-import-image',
}

export type LanguagePreference = 'system' | 'en' | 'zh-CN'
export type ResolvedLanguage = 'en' | 'zh-CN'

// Base interfaces for different types of IPC communication
export interface IpcRequest<T = unknown> {
  args: T
}

export interface IpcResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

export interface FileNode {
  name: string
  path: string
  type: string // MIME type
  isDirectory: boolean
  isSymbolicLink?: boolean
  children?: FileNode[]
  size: number
  modifiedTime: number
  createdTime: number
  parent?: FileNode
}

export type WorkspaceFilesystemChange =
  | { type: 'upsert'; node: FileNode }
  | { type: 'remove'; path: string }

export type WorkspaceChangedEvent =
  | {
      kind: 'filesystem'
      workspaceRoot: string
      changes: WorkspaceFilesystemChange[]
      /** Source metadata only for files carried by this batch. */
      sources: Record<string, { url: string; capturedAt?: string }>
    }
  | {
      kind: 'index'
      workspaceRoot: string
      /** Full authoritative source map after the initial index scan. */
      sources: Record<string, { url: string; capturedAt?: string }>
    }
  | { kind: 'watcher-error'; workspaceRoot: string; retrying: boolean }
  | { kind: 'watcher-recovered'; workspaceRoot: string }

// Channel-specific type definitions
export interface IpcChannelDefinitions {
  [IpcChannels.FileNew]: {
    args: undefined
    response: void
  }
  [IpcChannels.OnFileOpened]: {
    args: { filePath: string }
    response: void
  }
  [IpcChannels.OnSave]: {
    args: undefined
    response: void
  }
  [IpcChannels.OnLanguageChanged]: {
    args: { resolved: ResolvedLanguage }
    response: void
  }
  [IpcChannels.OnSettingsChanged]: {
    args: { settings: AppSettings }
    response: void
  }
  [IpcChannels.OpenWorkspace]: {
    args: undefined
    response: void
  }
  [IpcChannels.OpenCodeGuide]: {
    args: undefined
    response: void
  }
  [IpcChannels.FlushBeforeClose]: {
    args: undefined
    response: void
  }
  [IpcChannels.CloseCurrentTab]: {
    args: undefined
    response: void
  }
  [IpcChannels.RendererReady]: {
    args: undefined
    response: void
  }
  [IpcChannels.ReadyToClose]: {
    args: undefined
    response: void
  }
  [IpcChannels.CancelClose]: {
    args: undefined
    response: void
  }
  [IpcChannels.InvokeSaveFile]: {
    args: { content: string; filePath: string }
    response: IpcResponse<{ mtime: number }>
  }
  [IpcChannels.InvokeSaveAs]: {
    args: {
      content: string
      defaultPath: string
      filters?: { name: string; extensions: string[] }[]
    }
    response: IpcResponse<{ filePath: string }>
  }
  [IpcChannels.InvokeOpenFile]: {
    args: undefined
    response: IpcResponse<{ filePath: string | null }>
  }
  [IpcChannels.InvokeOpenDirectory]: {
    args: undefined
    response: IpcResponse<{ directoryPath: string }>
  }
  [IpcChannels.InvokeListDirectory]: {
    args: { directoryPath: string }
    response: IpcResponse<{ files: FileNode[] }>
  }
  [IpcChannels.InvokeRenameFile]: {
    args: { oldPath: string; newName: string }
    response: IpcResponse<{ newPath: string }>
  }
  [IpcChannels.InvokeDeleteFile]: {
    args: { path: string }
    response: IpcResponse<void>
  }
  [IpcChannels.InvokeCreateFile]: {
    args: { parentPath: string; name: string }
    response: IpcResponse<{ filePath: string }>
  }
  [IpcChannels.InvokeCreateDirectory]: {
    args: { parentPath: string; name: string }
    response: IpcResponse<{ directoryPath: string }>
  }
  [IpcChannels.InvokeReadFile]: {
    args: { filePath: string }
    response: IpcResponse<{ content: string; filePath: string; mtime: number }>
  }
  [IpcChannels.InvokeReadFileBinary]: {
    args: { filePath: string }
    response: IpcResponse<{ data: Uint8Array }>
  }
  [IpcChannels.InvokeQuickPreview]: {
    args: { filePath: string }
    response: IpcResponse<void>
  }
  [IpcChannels.InvokeAddRecentDocument]: {
    args: { filePath: string }
    response: IpcResponse<void>
  }
  [IpcChannels.InvokeGetFileStats]: {
    args: { filePath: string }
    response: IpcResponse<{
      mtime: number
      size: number
      isDirectory: boolean
    }>
  }
  [IpcChannels.InvokeMoveFile]: {
    args: { sourcePath: string; targetPath: string; suggestedName?: string }
    response: IpcResponse<{ newPath: string }>
  }
  [IpcChannels.InvokeShowMessageBox]: {
    args: {
      type: 'warning' | 'question'
      title: string
      message: string
      detail?: string
      buttons: string[]
      defaultId?: number
      cancelId?: number
    }
    response: IpcResponse<{ response: number }>
  }
  [IpcChannels.FileMoved]: {
    args: { oldPath: string; newPath: string }
    response: void
  }
  [IpcChannels.InvokeGetLastDirectory]: {
    args: undefined
    response: IpcResponse<{ directoryPath: string | null }>
  }
  [IpcChannels.InvokeSaveLastDirectory]: {
    args: { directoryPath: string }
    response: IpcResponse<void>
  }
  [IpcChannels.InvokeGetCodeGuideState]: {
    args: undefined
    response: IpcResponse<{ version: number }>
  }
  [IpcChannels.InvokeMarkCodeGuideOpened]: {
    args: { version: number }
    response: IpcResponse<void>
  }
  // Add new channel definitions
  [IpcChannels.InvokeGetSidebarCollapsed]: {
    args: undefined
    response: IpcResponse<{ isCollapsed: boolean }>
  }
  [IpcChannels.InvokeSaveSidebarCollapsed]: {
    args: { isCollapsed: boolean }
    response: IpcResponse<void>
  }
  [IpcChannels.InvokeCheckClipboardHasFiles]: {
    args: undefined
    response: IpcResponse<{ hasFiles: boolean }>
  }
  [IpcChannels.InvokePasteFiles]: {
    args: { targetPath: string; onConflict?: 'keep-both' | 'replace' }
    response: IpcResponse<{ copiedFiles: string[]; failed: number; conflicts?: string[] }>
  }
  [IpcChannels.InvokeSavePastedImage]: {
    args: {
      imageBuffer: Uint8Array
      mimeType: string
    }
    response: IpcResponse<{
      filePath: string
      isBase64?: boolean
    }>
  }
  [IpcChannels.InvokeDownloadRemoteImage]: {
    args: { url: string }
    response: IpcResponse<{ filePath: string }>
  }
  // Add new channel definition for revealing in finder
  [IpcChannels.InvokeRevealInFinder]: {
    args: { path: string }
    response: IpcResponse<void>
  }
  [IpcChannels.InvokeListWorkspaces]: {
    args: undefined
    response: IpcResponse<{
      workspaces: { path: string; name: string; lastOpenedAt: number; exists: boolean }[]
    }>
  }
  [IpcChannels.InvokeRegisterWorkspace]: {
    args: { path: string }
    response: IpcResponse<{ path: string }>
  }
  [IpcChannels.InvokeRenameWorkspace]: {
    args: { path: string; name: string }
    response: IpcResponse<void>
  }
  [IpcChannels.InvokeRemoveWorkspace]: {
    args: { path: string }
    response: IpcResponse<void>
  }
  [IpcChannels.InvokeRelocateWorkspace]: {
    args: { path: string }
    response: IpcResponse<{ newPath: string }>
  }
  [IpcChannels.InvokeCreateWorkspace]: {
    args: undefined
    response: IpcResponse<{ path: string }>
  }
  [IpcChannels.InvokeOpenPath]: {
    args: { path: string }
    response: IpcResponse<void>
  }
  [IpcChannels.InvokeOpenExternal]: {
    args: { url: string }
    response: IpcResponse<void>
  }
  [IpcChannels.InvokeCopyFile]: {
    args: { sourcePath: string }
    response: IpcResponse<{ newPath: string }>
  }
  [IpcChannels.OnWorkspaceChanged]: {
    args: WorkspaceChangedEvent
    response: void
  }
  [IpcChannels.InvokeWatchWorkspace]: {
    args: { directoryPath: string }
    response: IpcResponse<void>
  }
  [IpcChannels.InvokeUnwatchWorkspace]: {
    args: undefined
    response: IpcResponse<void>
  }
  [IpcChannels.InvokeInitIndex]: {
    args: { directoryPath: string }
    response: IpcResponse<void>
  }
  [IpcChannels.InvokeSearchIndex]: {
    args: { query: string }
    response: IpcResponse<{
      hits: { path: string; title: string; snippet: string }[]
      total: number
    }>
  }
  [IpcChannels.InvokeGetClipSources]: {
    args: undefined
    response: IpcResponse<{ sources: Record<string, { url: string; capturedAt?: string }> }>
  }
  [IpcChannels.InvokeGetFileMeta]: {
    args: { path: string }
    response: IpcResponse<{
      meta: { title: string; words: number; tags: string[]; createdAt: number } | null
    }>
  }
  [IpcChannels.InvokeGetAllTags]: {
    args: undefined
    response: IpcResponse<{ tags: { tag: string; count: number }[] }>
  }
  [IpcChannels.InvokeGetFilesByTag]: {
    args: { tag: string }
    response: IpcResponse<{ files: { path: string; title: string }[] }>
  }
  [IpcChannels.InvokeListLinkTargets]: {
    args: { query: string; excludePath: string | null }
    response: IpcResponse<{ targets: { path: string; title: string }[] }>
  }
  [IpcChannels.InvokeResolveWikilinks]: {
    args: { targets: string[] }
    response: IpcResponse<{
      resolved: Record<string, { path: string; title: string; excerpt: string } | null>
    }>
  }
  [IpcChannels.InvokeGetNoteLinks]: {
    args: { path: string }
    response: IpcResponse<{
      selfTitle: string
      backlinks: {
        path: string
        title: string
        refs: { heading: string | null; context: string }[]
      }[]
      mentions: { path: string; title: string; context: string }[]
      outgoing: { target: string; path: string | null; title: string | null }[]
      edges: [string, string][]
    }>
  }
  [IpcChannels.InvokeLinkMention]: {
    args: { sourcePath: string; targetTitle: string }
    response: IpcResponse<{ linked: boolean }>
  }
  [IpcChannels.InvokeGetSmartViews]: {
    args: { workspaceRoot: string }
    response: IpcResponse<{ views: SmartViewDef[] }>
  }
  [IpcChannels.InvokeSaveSmartViews]: {
    args: { workspaceRoot: string; views: SmartViewDef[] }
    response: IpcResponse<void>
  }
  [IpcChannels.InvokeQuerySmartView]: {
    args: { rules: SmartRule[]; sort?: 'Newest first' | 'Oldest first' | 'Name A–Z' | 'Source' }
    response: IpcResponse<{ items: SmartHit[] }>
  }
  [IpcChannels.InvokeCountSmartViews]: {
    args: { views: { id: string; rules: SmartRule[] }[] }
    response: IpcResponse<{ counts: Record<string, number> }>
  }
  [IpcChannels.InvokeGetSmartVocab]: {
    args: undefined
    response: IpcResponse<SmartVocab>
  }
  [IpcChannels.InvokeCaptureUrl]: {
    args: { url: string; destFolder: string; workspaceRoot: string }
    response: IpcResponse<{
      filePath: string
      title: string
      wordCount: number
      excerpt: string
      empty: boolean
    }>
  }
  [IpcChannels.InvokePreviewUrl]: {
    args: { url: string }
    response: IpcResponse<{
      title: string
      host: string
      wordCount: number
      imageCount: number
      excerpt: string
      bodyPreview: string
    }>
  }
  [IpcChannels.InvokeFindBySource]: {
    args: { url: string }
    response: IpcResponse<{ path: string; title: string; savedAt: number } | null>
  }
  [IpcChannels.InvokeGetLanguage]: {
    args: undefined
    response: IpcResponse<{ language: LanguagePreference; resolved: ResolvedLanguage }>
  }
  [IpcChannels.InvokeSetLanguage]: {
    args: { language: LanguagePreference }
    response: IpcResponse<{ resolved: ResolvedLanguage }>
  }
  [IpcChannels.InvokeGetSettings]: {
    args: undefined
    response: IpcResponse<{ settings: AppSettings }>
  }
  [IpcChannels.InvokeSetSettings]: {
    args: { patch: Partial<AppSettings> }
    response: IpcResponse<{ settings: AppSettings }>
  }
  [IpcChannels.InvokeOpenSettingsWindow]: {
    args: undefined
    response: IpcResponse<void>
  }
  [IpcChannels.InvokeGetAppVersion]: {
    args: undefined
    response: IpcResponse<{ version: string }>
  }
  [IpcChannels.InvokeCheckForUpdates]: {
    args: undefined
    response: IpcResponse<void>
  }
  [IpcChannels.InvokeGetWorkspaceSize]: {
    args: { directoryPath: string }
    response: IpcResponse<{ bytes: number }>
  }
  [IpcChannels.InvokeExportPDF]: {
    args: { html: string; defaultName: string }
    response: IpcResponse<void>
  }
  [IpcChannels.InvokeImportImage]: {
    args: undefined
    response: IpcResponse<{ filePath: string } | null>
  }
}

// Type helpers
export type IpcRequestType<K extends IpcChannels> = IpcChannelDefinitions[K]
export type IpcResponseType<K extends IpcChannels> = IpcChannelDefinitions[K]['response']

// API interface exposed to renderer
export interface IpcApi {
  channels: typeof IpcChannels
  send: <K extends IpcChannels>(channel: K, args: IpcChannelDefinitions[K]['args']) => void
  on: <K extends IpcChannels>(
    channel: K,
    callback: (args: IpcChannelDefinitions[K]['args']) => void,
  ) => () => void
  invoke: <K extends IpcChannels>(
    channel: K,
    args: IpcChannelDefinitions[K]['args'],
  ) => Promise<IpcResponseType<K>>
}

// Declare the API in the window object
declare global {
  interface Window {
    api: IpcApi
  }
}
