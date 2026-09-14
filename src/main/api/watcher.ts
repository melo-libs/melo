import { type WebContents, BrowserWindow } from 'electron'
import fs from 'fs'
import path from 'path'
import parcelWatcher from '@parcel/watcher'
import { IpcChannels, type FileNode, type WorkspaceFilesystemChange } from '../../shared/types/ipc'
import { getClipSourcesForPaths, indexFile, removeFromIndex } from './indexer'
import { getMimeType, listDirectoryContents } from './fileOperations/fileOperations'

/**
 * Workspace watcher — one native recursive subscription per workspace.
 *
 * @parcel/watcher uses the platform backend (FSEvents on macOS,
 * ReadDirectoryChangesW on Windows, inotify/Watchman on Linux) and sends
 * already-coalesced batches to JavaScript. This matters for arbitrary user
 * folders: Chokidar 4 installs an fs.watch handle for every entry, which can
 * exhaust the OS long before a large workspace is unusual for the user.
 *
 * We still debounce across native batches because editors and sync clients
 * often save via several operations. Index updates finish before one renderer
 * notification, so every consumer observes a consistent batch.
 */

type Subscription = Awaited<ReturnType<typeof parcelWatcher.subscribe>>
type PendingOperation = 'create' | 'update' | 'delete'

interface ActiveWatch {
  root: string
  subscription: Subscription | null
  timer: NodeJS.Timeout | null
  pending: Map<string, PendingOperation>
  flushing: boolean
  recoveryAttempt: number
  recoveryTimer: NodeJS.Timeout | null
  terminalErrorReported: boolean
}

let active: ActiveWatch | null = null
let chain: Promise<void> = Promise.resolve()

function isHiddenPath(root: string, filePath: string): boolean {
  const rel = path.relative(root, filePath)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return false
  return rel.split(path.sep).some((segment) => segment.startsWith('.'))
}

function sourcePaths(changes: WorkspaceFilesystemChange[]): string[] {
  const paths: string[] = []
  const visit = (node: FileNode): void => {
    if (node.isDirectory) node.children?.forEach(visit)
    else if (!node.isSymbolicLink) paths.push(node.path)
  }
  for (const change of changes) {
    if (change.type === 'upsert') visit(change.node)
  }
  return paths
}

function broadcastWorkspaceChanged(
  workspaceRoot: string,
  changes: WorkspaceFilesystemChange[],
): void {
  // Query once per native batch, not once per window, and transfer metadata
  // only for nodes represented by this batch.
  const sources = getClipSourcesForPaths(sourcePaths(changes))
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.webContents.isDestroyed()) {
      win.webContents.send(IpcChannels.OnWorkspaceChanged, {
        kind: 'filesystem',
        workspaceRoot,
        changes,
        sources,
      })
    }
  }
}

function mergeOperation(
  previous: PendingOperation | undefined,
  next: PendingOperation,
): PendingOperation {
  if (!previous) return next
  if (next === 'delete') return 'delete'
  if (next === 'create' || previous === 'delete') return next
  // A create followed by content updates is still structurally a create.
  return previous === 'create' ? 'create' : 'update'
}

function hasAncestor(paths: Set<string>, filePath: string): boolean {
  let parent = path.dirname(filePath)
  while (!paths.has(parent)) {
    const next = path.dirname(parent)
    if (next === parent) return false
    parent = next
  }
  return true
}

function compactChanges(changes: WorkspaceFilesystemChange[]): WorkspaceFilesystemChange[] {
  const scannedDirectories = new Set(
    changes
      .filter(
        (change): change is Extract<WorkspaceFilesystemChange, { type: 'upsert' }> =>
          change.type === 'upsert' && change.node.isDirectory && change.node.children !== undefined,
      )
      .map((change) => change.node.path),
  )

  if (scannedDirectories.size === 0) return changes
  return changes.filter((change) => {
    const changedPath = change.type === 'upsert' ? change.node.path : change.path
    return !hasAncestor(scannedDirectories, changedPath)
  })
}

async function diskNode(filePath: string, operation: PendingOperation): Promise<FileNode | null> {
  const stats = fs.lstatSync(filePath)
  const isDirectory = stats.isDirectory()
  const isSymbolicLink = stats.isSymbolicLink()
  if (!isDirectory && !stats.isFile() && !isSymbolicLink) return null

  const node: FileNode = {
    name: path.basename(filePath),
    path: filePath,
    type: isDirectory ? 'directory' : getMimeType(filePath),
    isDirectory,
    isSymbolicLink: isSymbolicLink || undefined,
    size: stats.size,
    modifiedTime: stats.mtimeMs,
    createdTime: stats.birthtimeMs,
  }

  // A native directory create/rename is not guaranteed to emit one event per
  // existing descendant. Scan that new subtree once so both tree and index
  // are complete; ordinary directory metadata updates preserve old children.
  if (isDirectory && operation === 'create') {
    node.children = await listDirectoryContents(filePath)
  }
  return node
}

async function indexCreatedSubtree(nodes: FileNode[]): Promise<void> {
  let seen = 0
  const walk = async (items: FileNode[]): Promise<void> => {
    for (const node of items) {
      if (node.isDirectory) await walk(node.children ?? [])
      else if (!node.isSymbolicLink) indexFile(node.path)
      seen += 1
      if (seen % 50 === 0) await new Promise<void>((resolve) => setImmediate(resolve))
    }
  }
  await walk(nodes)
}

function scheduleFlush(state: ActiveWatch): void {
  if (active !== state) return
  if (state.timer) clearTimeout(state.timer)
  state.timer = setTimeout(() => {
    state.timer = null
    void flushPending(state)
  }, 300)
}

async function flushPending(state: ActiveWatch): Promise<void> {
  if (active !== state || state.flushing) return
  state.flushing = true

  // Parents first: a created directory scan already captures the final state
  // of every descendant, so later child events from the same native burst can
  // be skipped rather than indexed and transferred twice.
  const batch = [...state.pending].sort(
    ([left], [right]) => left.split(path.sep).length - right.split(path.sep).length,
  )
  state.pending.clear()
  const changes: WorkspaceFilesystemChange[] = []
  const scannedDirectories = new Set<string>()

  try {
    for (let i = 0; i < batch.length; i += 1) {
      if (active !== state) return
      const [filePath, operation] = batch[i]
      if (hasAncestor(scannedDirectories, filePath)) continue

      try {
        if (operation === 'delete') {
          // Works for both a file and a directory prefix.
          removeFromIndex(filePath)
          changes.push({ type: 'remove', path: filePath })
        } else {
          const node = await diskNode(filePath, operation)
          if (!node) continue
          // Never follow links into another workspace. A newly-arrived folder
          // may already contain files, so index its scanned subtree once.
          if (node.isDirectory) {
            if (operation === 'create') {
              await indexCreatedSubtree(node.children ?? [])
              scannedDirectories.add(filePath)
            }
          } else if (!node.isSymbolicLink) {
            indexFile(filePath)
          }
          changes.push({ type: 'upsert', node })
        }
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        // A path can disappear between an upsert event and this batch. Treat
        // it as a removal immediately rather than waiting for another event.
        if (code === 'ENOENT') {
          removeFromIndex(filePath)
          changes.push({ type: 'remove', path: filePath })
        } else {
          console.error('Index update failed for', filePath, error)
        }
      }

      // Large sync/import bursts must not monopolize Electron's main loop.
      if ((i + 1) % 50 === 0) await new Promise<void>((resolve) => setImmediate(resolve))
    }

    if (active === state && changes.length > 0) {
      broadcastWorkspaceChanged(state.root, compactChanges(changes))
    }
  } finally {
    state.flushing = false
    // Events arriving while the batch was indexed belong to a trailing batch.
    if (active === state && state.pending.size > 0) scheduleFlush(state)
  }
}

function reportWatcherError(sender: WebContents, workspaceRoot: string, retrying: boolean): void {
  if (!sender.isDestroyed()) {
    sender.send(IpcChannels.OnWorkspaceChanged, {
      kind: 'watcher-error',
      workspaceRoot,
      retrying,
    })
  }
}

/** Retry one runtime backend failure. A second failure is surfaced and left
 * stopped so a broken backend cannot enter an infinite reconnect loop. */
function recoverWatch(state: ActiveWatch, sender: WebContents): void {
  if (active !== state || state.recoveryTimer) return
  if (state.recoveryAttempt >= 1) {
    if (!state.terminalErrorReported) {
      state.terminalErrorReported = true
      reportWatcherError(sender, state.root, false)
    }
    return
  }

  reportWatcherError(sender, state.root, true)
  state.recoveryTimer = setTimeout(() => {
    state.recoveryTimer = null
    const operation = chain.then(async () => {
      if (active !== state || sender.isDestroyed()) return
      try {
        await doWatch(state.root, sender, state.recoveryAttempt + 1)
        if (!sender.isDestroyed()) {
          sender.send(IpcChannels.OnWorkspaceChanged, {
            kind: 'watcher-recovered',
            workspaceRoot: state.root,
          })
        }
      } catch (error) {
        console.error('Workspace watcher recovery failed:', error)
        reportWatcherError(sender, state.root, false)
      }
    })
    chain = operation.catch(() => undefined)
  }, 1000)
}

async function doUnwatch(): Promise<void> {
  const current = active
  active = null
  if (!current) return

  if (current.timer) {
    clearTimeout(current.timer)
    current.timer = null
  }
  if (current.recoveryTimer) {
    clearTimeout(current.recoveryTimer)
    current.recoveryTimer = null
  }
  current.pending.clear()
  if (current.subscription) await current.subscription.unsubscribe()
}

async function doWatch(dir: string, sender: WebContents, recoveryAttempt = 0): Promise<void> {
  await doUnwatch()

  const state: ActiveWatch = {
    root: dir,
    subscription: null,
    timer: null,
    pending: new Map(),
    flushing: false,
    recoveryAttempt,
    recoveryTimer: null,
    terminalErrorReported: false,
  }
  active = state

  try {
    const subscription = await parcelWatcher.subscribe(
      dir,
      (error, events) => {
        if (active !== state) return
        if (error) {
          console.error('Workspace watcher error:', error)
          recoverWatch(state, sender)
          return
        }

        for (const event of events) {
          if (isHiddenPath(state.root, event.path)) continue
          const operation = event.type as PendingOperation
          state.pending.set(event.path, mergeOperation(state.pending.get(event.path), operation))
        }
        if (state.pending.size > 0) scheduleFlush(state)
      },
      {
        // The tree hides dotted entries and the index lives in .melo. Ignore
        // them at the native boundary to avoid self-triggered index events.
        ignore: ['**/.*', '**/.*/**'],
      },
    )

    // The serialized lifecycle normally makes this impossible, but keeping
    // the guard prevents a late native subscription from surviving teardown.
    if (active !== state) {
      await subscription.unsubscribe()
      return
    }
    state.subscription = subscription
  } catch (error) {
    if (active === state) {
      active = null
      if (state.timer) clearTimeout(state.timer)
      state.pending.clear()
    }
    throw error
  }

  // A renderer can die without invoking unwatch. Keep exactly one listener
  // per sender across workspace switches.
  if (destroyedSender !== sender) {
    destroyedSender?.removeListener('destroyed', onSenderDestroyed)
    destroyedSender = sender
    sender.once('destroyed', onSenderDestroyed)
  }
}

let destroyedSender: WebContents | null = null
const onSenderDestroyed = () => {
  destroyedSender = null
  void unwatchWorkspace()
}

export function watchWorkspace(dir: string, sender: WebContents): Promise<void> {
  const operation = chain.then(() => doWatch(dir, sender))
  // A failed native subscription must be reported to this caller without
  // poisoning every later watch/unwatch operation in the serialized chain.
  chain = operation.catch(() => undefined)
  return operation
}

export function unwatchWorkspace(): Promise<void> {
  const operation = chain.then(() => doUnwatch())
  chain = operation.catch(() => undefined)
  return operation
}
