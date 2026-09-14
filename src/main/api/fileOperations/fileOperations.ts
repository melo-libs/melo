/* eslint-disable @typescript-eslint/no-unused-vars */
import { app, BrowserWindow, dialog, shell } from 'electron'
import fs from 'fs-extra'
import path from 'path'
import mime from 'mime-types'
import { IpcChannels, type FileNode } from '../../../shared/types/ipc'
import { v4 as uuidv4 } from 'uuid'
import { isMarkdownPath, TEXT_DOCUMENT_EXTENSIONS } from '../../../shared/fileKinds'

/**
 * Opens a file dialog to allow the user to select a file and returns the selected file path.
 */
export async function openFileDialog(mainWindow?: BrowserWindow | null): Promise<string | null> {
  const curWindow = mainWindow || BrowserWindow.getFocusedWindow()

  if (!curWindow) {
    console.error('No focused window available to show the file dialog.')
    return null
  }

  try {
    const { canceled, filePaths } = await dialog.showOpenDialog(curWindow, {
      properties: ['openFile'],
      filters: [{ name: 'Text Files', extensions: [...TEXT_DOCUMENT_EXTENSIONS] }],
    })

    return canceled || filePaths.length === 0 ? null : filePaths[0]
  } catch (error) {
    console.error('Failed to show open file dialog:', error)
    return null
  }
}

/**
 * Opens a directory selection dialog
 */
export async function openDirectoryDialog(
  mainWindow?: BrowserWindow | null,
): Promise<string | null> {
  const curWindow = mainWindow || BrowserWindow.getFocusedWindow()

  if (!curWindow) {
    console.error('No focused window available to show the directory dialog.')
    return null
  }

  try {
    const { canceled, filePaths } = await dialog.showOpenDialog(curWindow, {
      properties: ['openDirectory'],
    })

    return canceled || filePaths.length === 0 ? null : filePaths[0]
  } catch (error) {
    console.error('Failed to show directory dialog:', error)
    return null
  }
}

/**
 * Reads and processes the content of a file.
 */
export async function readAndProcessFile(
  filePath: string,
): Promise<{ content: string; filePath: string; mtime: number }> {
  const fileContent = await fs.readFile(filePath, 'utf-8')
  const stats = await fs.stat(filePath)
  // Add to recent documents when reading markdown files
  if (isMarkdownPath(filePath)) {
    app.addRecentDocument(filePath)
  }

  // Return raw markdown — the renderer will parse it via @tiptap/markdown.
  // mtime rides along so the document session can detect external changes
  // without a second stat round-trip.
  return { content: fileContent, filePath, mtime: stats.mtimeMs }
}

/** Ask the renderer's document session to open a file from disk. */
export function sendFileToRenderer(filePath: string, mainWindow?: BrowserWindow | null): void {
  const curWindow = mainWindow || BrowserWindow.getFocusedWindow()

  if (!curWindow || curWindow.isDestroyed()) {
    console.error('No window available to open the file.')
    return
  }

  curWindow.webContents.send(IpcChannels.OnFileOpened, { filePath })
}

/**
 * Saves content to a file. Returns the resulting mtime so the renderer's
 * document session can tell its own writes apart from external changes.
 * Deliberately a plain in-place write — tmp+rename "atomic" saves break
 * symlinks, hard links, xattrs and sync clients (why Sublime ships
 * atomic_save off and VS Code rejected it for documents).
 */
export async function saveFile(content: string, filePath: string): Promise<{ mtime: number }> {
  // Content is already markdown from editor.getMarkdown()
  await fs.writeFile(filePath, content, 'utf-8')
  const stats = await fs.stat(filePath)
  return { mtime: stats.mtimeMs }
}

/**
 * Shows save dialog and saves content to the selected file
 */
export async function saveFileAs(
  content: string,
  defaultPath: string,
  parentWindow?: BrowserWindow,
  filters?: { name: string; extensions: string[] }[],
): Promise<{ filePath: string }> {
  const opts = {
    title: 'Save As',
    buttonLabel: 'Save',
    filters: filters ?? [{ name: 'Text Files', extensions: ['md'] }],
    defaultPath,
  }
  const result = parentWindow
    ? await dialog.showSaveDialog(parentWindow, opts)
    : await dialog.showSaveDialog(opts)

  if (!result.canceled && result.filePath) {
    await saveFile(content, result.filePath)
    app.addRecentDocument(result.filePath)
    return { filePath: result.filePath }
  }

  throw new Error('Operation cancelled')
}

/**
 * Gets MIME type for a file
 */
export function getMimeType(filePath: string): string {
  const mimeType = mime.lookup(filePath)
  return mimeType || 'application/octet-stream'
}

/**
 * Checks if a file or directory exists at the given path
 */
export async function checkPathExists(pathToCheck: string): Promise<boolean> {
  try {
    await fs.access(pathToCheck)
    return true
  } catch {
    return false
  }
}

/**
 * Renames a file or directory
 */
export async function renameFile(oldPath: string, newPath: string): Promise<void> {
  try {
    if (!(await checkPathExists(oldPath))) {
      // The tree drifted from disk (external move/rename) — say so plainly;
      // the renderer re-scans on failure.
      throw new Error('That file no longer exists on disk — refreshing the tree')
    }
    if (await checkPathExists(newPath)) {
      throw new Error('A file or directory with this name already exists')
    }
    await fs.rename(oldPath, newPath)
  } catch (error) {
    console.error('Failed to rename file:', error)
    throw error
  }
}

/**
 * Moves a file or directory to the system trash (recoverable from Finder).
 */
export async function trashFile(filePath: string): Promise<void> {
  try {
    await shell.trashItem(filePath)
  } catch (error) {
    console.error('Failed to trash file:', error)
    throw error
  }
}

/**
 * Deletes a file or directory permanently.
 */
export async function deleteFile(filePath: string): Promise<void> {
  try {
    const stats = await fs.stat(filePath)
    if (stats.isDirectory()) {
      await fs.remove(filePath)
    } else {
      await fs.unlink(filePath)
    }
  } catch (error) {
    console.error('Failed to delete file:', error)
    throw error
  }
}

/**
 * Creates a new file
 */
export async function createFile(filePath: string): Promise<void> {
  try {
    if (await checkPathExists(filePath)) {
      throw new Error('A file or directory with this name already exists')
    }
    await fs.writeFile(filePath, '')
  } catch (error) {
    console.error('Failed to create file:', error)
    throw error
  }
}

/**
 * Creates a new directory
 */
export async function createDirectory(dirPath: string): Promise<void> {
  try {
    if (await checkPathExists(dirPath)) {
      throw new Error('A file or directory with this name already exists')
    }
    await fs.mkdir(dirPath)
  } catch (error) {
    console.error('Failed to create directory:', error)
    throw error
  }
}

/**
 * Lists all files in a directory recursively
 */
const directoryScans = new Map<string, Promise<FileNode[]>>()

export function listDirectoryContents(directoryPath: string): Promise<FileNode[]> {
  const root = path.resolve(directoryPath)
  const inFlight = directoryScans.get(root)
  if (inFlight) return inFlight

  const scan = scanDirectoryContents(root).finally(() => {
    if (directoryScans.get(root) === scan) directoryScans.delete(root)
  })
  directoryScans.set(root, scan)
  return scan
}

async function scanDirectoryContents(directoryPath: string): Promise<FileNode[]> {
  try {
    const entries = await fs.readdir(directoryPath, { withFileTypes: true })
    const result: FileNode[] = []

    for (const entry of entries) {
      const file = entry.name
      // Skip hidden files and directories (starting with a dot)
      if (file.startsWith('.')) {
        continue
      }

      try {
        const fullPath = path.join(directoryPath, file)
        let stats
        try {
          // lstat deliberately does not follow symlinks. A linked directory
          // may point outside the workspace or back into an ancestor; treating
          // it as a leaf keeps traversal finite and dangling links harmless.
          stats = await fs.lstat(fullPath)
        } catch (statError) {
          // Entries can disappear between readdir and lstat.
          const code = (statError as NodeJS.ErrnoException).code
          if (code !== 'ENOENT') console.warn(`Skipping inaccessible file: ${fullPath}`, statError)
          continue
        }

        const isDirectory = stats.isDirectory()
        // Sockets, devices and other special filesystem entries are neither
        // editable documents nor folders. Symlinks remain visible as leaves.
        if (!isDirectory && !stats.isFile() && !stats.isSymbolicLink()) continue

        const node: FileNode = {
          name: file,
          path: fullPath,
          type: isDirectory ? 'directory' : mime.lookup(file) || 'application/octet-stream',
          isDirectory,
          isSymbolicLink: stats.isSymbolicLink() || undefined,
          size: stats.size,
          modifiedTime: stats.mtimeMs,
          createdTime: stats.birthtimeMs,
        }

        if (isDirectory) {
          try {
            node.children = await scanDirectoryContents(fullPath)
          } catch (childError) {
            // If we can't read the directory contents, set empty children array
            console.warn(`Could not read directory contents: ${fullPath}`, childError)
            node.children = []
          }
        }

        result.push(node)
      } catch (fileError) {
        // Skip any file that causes an error
        console.warn(`Skipping problematic file: ${file}`, fileError)
        continue
      }
    }

    // Sort directories first, then files, both alphabetically
    return result.sort((a, b) => {
      if (a.isDirectory === b.isDirectory) {
        return a.name.localeCompare(b.name)
      }
      return a.isDirectory ? -1 : 1
    })
  } catch (error) {
    console.error(`Error listing directory contents: ${directoryPath}`, error)
    throw error
  }
}

export const quickPreviewFile = async (filePath: string): Promise<void> => {
  try {
    if (process.platform === 'darwin') {
      const window = BrowserWindow.getFocusedWindow()
      if (!window) {
        throw new Error('No focused window available')
      }
      window.previewFile(filePath)
    } else {
      await shell.openPath(filePath)
    }
  } catch (error) {
    throw new Error(
      `Failed to preview file: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Duplicates a file or directory next to itself as "name copy.ext",
 * bumping to "name copy 2.ext" etc. while the target exists.
 */
export async function duplicateFile(sourcePath: string): Promise<string> {
  const dir = path.dirname(sourcePath)
  const stats = await fs.stat(sourcePath)
  const ext = stats.isDirectory() ? '' : path.extname(sourcePath)
  const base = path.basename(sourcePath, ext)

  let n = 1
  let target = path.join(dir, `${base} copy${ext}`)
  while (await checkPathExists(target)) {
    n += 1
    target = path.join(dir, `${base} copy ${n}${ext}`)
  }
  await fs.copy(sourcePath, target, { errorOnExist: true })
  return target
}

/**
 * Moves a file or directory to a new location
 */
export async function moveFile(
  sourcePath: string,
  targetPath: string,
  suggestedName?: string,
): Promise<string> {
  try {
    // const sourceStats = await fs.stat(sourcePath)
    // const sourceIsDir = sourceStats.isDirectory()
    const sourceExt = path.extname(sourcePath)
    const sourceName = path.basename(sourcePath)

    // If suggestedName is provided, use it instead of the original name
    const finalName = suggestedName || sourceName
    let finalPath = path.join(targetPath, finalName)

    // If target exists, generate a new name
    if (await checkPathExists(finalPath)) {
      const baseName = path.basename(finalName, sourceExt)
      let counter = 1

      while (await checkPathExists(finalPath)) {
        const newName = `${baseName} (${counter})${sourceExt}`
        finalPath = path.join(targetPath, newName)
        counter++
      }
    }

    // Move the file/directory
    await fs.move(sourcePath, finalPath, { overwrite: false })
    return finalPath
  } catch (error) {
    console.error('Failed to move file:', error)
    throw error
  }
}

/**
 * Saves a pasted image to the specified root directory
 * If rootDir is not provided, returns a base64 data URL
 */
export async function savePastedImage(
  imageBuffer: Uint8Array,
  mimeType: string,
  rootDir: string | null,
): Promise<{ filePath: string; isBase64?: boolean }> {
  try {
    // Convert Uint8Array to Buffer
    const buffer = Buffer.from(imageBuffer)

    // If no rootDir provided, return base64 data URL
    if (!rootDir) {
      const base64Data = buffer.toString('base64')
      return {
        filePath: `data:${mimeType};base64,${base64Data}`,
        isBase64: true,
      }
    }

    // Create .assets/year/month subdirectory
    const now = new Date()
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const assetsDir = path.join(rootDir, '.assets')
    const imageDir = path.join(assetsDir, String(year), month)
    await fs.ensureDir(imageDir)
    // .assets could be a symlink pointing anywhere — never write through
    // it to a destination outside the workspace.
    const realImageDir = await fs.realpath(imageDir)
    const realRoot = await fs.realpath(rootDir)
    if (realImageDir !== realRoot && !realImageDir.startsWith(realRoot + path.sep)) {
      throw new Error('.assets resolves outside the workspace')
    }

    // Generate unique filename with proper extension
    const imageId = uuidv4()
    const extension = mime.extension(mimeType) || 'bin'
    const imagePath = path.join(imageDir, `${imageId}.${extension}`)

    // Save the image
    await fs.writeFile(imagePath, buffer)

    // Return the path relative to root directory, but as a web-compatible path
    const relativePath = path.relative(rootDir, imagePath)
    return {
      filePath: relativePath.split(path.sep).join('/'), // Convert to forward slashes for web
      isBase64: false,
    }
  } catch (error) {
    console.error('Failed to save pasted image:', error)
    throw error
  }
}
