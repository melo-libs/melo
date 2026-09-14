import { app, dialog, BrowserWindow } from 'electron'
import { getSettings, updateSettings } from '../settings'
import fs from 'fs-extra'
import path from 'path'
import { preferences } from '../preferences'

/* ============================================================
   Workspace registry — the switcher's list of known workspaces,
   stored in preferences.json. Entries are keyed by realpath so
   the same folder reached via a symlink doesn't duplicate.
   Removing an entry never touches the folder on disk.
   ============================================================ */

const KEY = 'workspaces'

export interface WorkspaceEntry {
  path: string
  name: string
  lastOpenedAt: number
}

function read(): WorkspaceEntry[] {
  return preferences.get<WorkspaceEntry[]>(KEY) ?? []
}

function write(list: WorkspaceEntry[]): void {
  preferences.set(KEY, list)
}

async function canonical(p: string): Promise<string> {
  try {
    return await fs.realpath(p)
  } catch {
    return path.resolve(p)
  }
}

/** Upsert on every open (boot restore, picker, create): new entries get
 *  the folder name as display name; existing ones just touch the clock. */
export async function registerWorkspace(p: string): Promise<string> {
  const real = await canonical(p)
  const list = read()
  const existing = list.find((w) => w.path === real)
  if (existing) existing.lastOpenedAt = Date.now()
  else list.push({ path: real, name: path.basename(real), lastOpenedAt: Date.now() })
  write(list)
  return real
}

export async function listWorkspaces(): Promise<(WorkspaceEntry & { exists: boolean })[]> {
  return Promise.all(read().map(async (w) => ({ ...w, exists: await fs.pathExists(w.path) })))
}

export function renameWorkspace(p: string, name: string): void {
  const list = read()
  const w = list.find((x) => x.path === p)
  if (!w) return
  w.name = name.trim() || path.basename(w.path)
  write(list)
}

export function removeWorkspace(p: string): void {
  write(read().filter((w) => w.path !== p))
  // Its per-workspace clip destination goes with it.
  const dests = { ...getSettings().clipCustomDest }
  if (p in dests) {
    delete dests[p]
    updateSettings({ clipCustomDest: dests })
  }
}

/** Point an entry whose folder moved at its new location. If the picked
 *  folder is already registered, the stale entry is dropped instead of
 *  creating a duplicate. */
export async function relocateWorkspace(oldPath: string, win?: BrowserWindow): Promise<string> {
  const r = await dialog.showOpenDialog(win!, {
    title: 'Locate Workspace',
    properties: ['openDirectory', 'createDirectory'],
  })
  if (r.canceled || !r.filePaths[0]) throw new Error('Operation cancelled')
  const real = await canonical(r.filePaths[0])
  const list = read()
  const entry = list.find((x) => x.path === oldPath)
  const dup = list.find((x) => x.path === real && x.path !== oldPath)
  if (dup) {
    write(list.filter((x) => x.path !== oldPath))
  } else if (entry) {
    entry.path = real
    entry.lastOpenedAt = Date.now()
    write(list)
    // Follow the move: the clip destination lived under the old root.
    const dests = { ...getSettings().clipCustomDest }
    const oldDest = dests[oldPath]
    if (oldDest) {
      delete dests[oldPath]
      if (oldDest.startsWith(oldPath)) dests[real] = real + oldDest.slice(oldPath.length)
      updateSettings({ clipCustomDest: dests })
    }
  }
  return real
}

export async function createWorkspace(win?: BrowserWindow): Promise<string> {
  const r = await dialog.showSaveDialog(win!, {
    title: 'New Workspace',
    buttonLabel: 'Create',
    nameFieldLabel: 'Name',
    defaultPath: path.join(app.getPath('documents'), 'Notes'),
    properties: ['createDirectory', 'showOverwriteConfirmation'],
  })
  if (r.canceled || !r.filePath) throw new Error('Operation cancelled')
  await fs.ensureDir(r.filePath)
  return r.filePath
}
