import {
  IpcChannels,
  type FileNode as DiskNode,
  type WorkspaceFilesystemChange,
} from '@shared/types/ipc'
import { openCodeGuide } from './codeGuide'
import { restoreTabSession } from '../store/tabSession'
import type { FileNode } from '../components/sidebar/types'
import type { FileKind } from '../components/FileTypeIcon'
import { appStore } from '../store/appStore'
import { indexingAtom, workspacePathAtom, workspaceTreeAtom } from '../store/workspace'

/* ============================================================
   Workspace loading — open / restore the workspace folder and
   map the main process's disk tree onto the sidebar's FileNode.
   ============================================================ */

/** Extension → file kind, aligned with the FileTypeIcon registry. */
const EXT_KIND: Record<string, FileKind> = {
  md: 'md',
  markdown: 'md',
  txt: 'txt',
  html: 'html',
  htm: 'html',
  webloc: 'bookmark',
  url: 'bookmark',
  pdf: 'pdf',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  svg: 'image',
  mp3: 'audio',
  wav: 'audio',
  m4a: 'audio',
  flac: 'audio',
  mp4: 'video',
  mov: 'video',
  webm: 'video',
  mkv: 'video',
  js: 'code',
  ts: 'code',
  jsx: 'code',
  tsx: 'code',
  py: 'code',
  rs: 'code',
  go: 'code',
  sh: 'code',
  css: 'code',
  scss: 'code',
  json: 'data',
  csv: 'data',
  yaml: 'data',
  yml: 'data',
  zip: 'zip',
  gz: 'zip',
  tar: 'zip',
}

export function kindOf(name: string): FileKind {
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : ''
  // Unknown extensions are 'other', NOT 'txt' — a .key/.numbers/binary blob
  // treated as text would get its whole content read into the search preview.
  return EXT_KIND[ext] ?? 'other'
}

/** Kinds the Tiptap editor owns; everything else opens as a viewer tab. */
export const isEditableKind = (kind: FileKind): boolean => kind === 'md' || kind === 'txt'

export const workspaceName = (p: string) => p.split(/[\\/]/).pop() || p

/** Map a disk node into the sidebar tree shape (id = absolute path). */
function mapNode(n: DiskNode, isRootChild: boolean): FileNode {
  if (n.isDirectory) {
    return {
      id: n.path,
      name: n.name,
      kind: 'folder',
      // The workspace Inbox by convention: a root-level folder named Inbox.
      system: isRootChild && n.name === 'Inbox' ? 'inbox' : undefined,
      open: isRootChild && n.name === 'Inbox',
      children: (n.children ?? []).map((c) => mapNode(c, false)),
      size: n.size,
      mtime: n.modifiedTime,
      btime: n.createdTime,
    }
  }
  return {
    id: n.path,
    name: n.name,
    kind: kindOf(n.name),
    size: n.size,
    mtime: n.modifiedTime,
    btime: n.createdTime,
  }
}

/** Load the workspace tree: the folder's entries, Inbox pinned first.
 *  The workspace folder itself isn't a row — its name lives in the
 *  switcher, and a wrapping root would just add an indent level. */
const hostOf = (url: string): string | undefined => {
  try {
    return new URL(url).hostname.replace(/^www\./, '') || undefined
  } catch {
    return undefined
  }
}

/** Attach clip source info (favicon dot, "open original", Captured row)
 *  from the index — one batch call, then a tree walk. */
function decorateSources(
  nodes: FileNode[],
  sources: Record<string, { url: string; capturedAt?: string }>,
): void {
  for (const n of nodes) {
    const src = sources[n.id]
    if (src) n.source = { url: src.url, host: hostOf(src.url), capturedAt: src.capturedAt }
    if (n.children) decorateSources(n.children, sources)
  }
}

type ClipSources = Record<string, { url: string; capturedAt?: string }>
const EMPTY_TREE: FileNode[] = []

function sourceOf(path: string, sources: ClipSources): FileNode['source'] {
  const source = sources[path]
  return source
    ? { url: source.url, host: hostOf(source.url), capturedAt: source.capturedAt }
    : undefined
}

const sameSource = (left: FileNode['source'], right: FileNode['source']): boolean =>
  left?.url === right?.url && left?.host === right?.host && left?.capturedAt === right?.capturedAt

/** Apply the authoritative source map produced after a full index scan without
 * reading the workspace from disk again. */
export function applyWorkspaceSources(tree: FileNode[], sources: ClipSources): FileNode[] {
  let changed = false
  const next = tree.map((node) => {
    const source = sourceOf(node.id, sources)
    const children = node.children ? applyWorkspaceSources(node.children, sources) : node.children
    if (sameSource(node.source, source) && children === node.children) return node
    changed = true
    return { ...node, source, children }
  })
  return changed ? next : tree
}

function mapChangedNode(node: DiskNode, isRootChild: boolean, sources: ClipSources): FileNode {
  const mapped = mapNode(node, isRootChild)
  mapped.source = sourceOf(node.path, sources)
  if (mapped.children) decorateSources(mapped.children, sources)
  return mapped
}

const parentPathOf = (filePath: string): string => {
  const cut = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  return cut <= 0 ? filePath.slice(0, Math.max(cut, 0) + 1) : filePath.slice(0, cut)
}

/** Apply a native watcher batch without sending the entire workspace tree
 *  across IPC again. Existing nodes are reconciled in one tree walk; new
 *  siblings are grouped by parent and attached in a second walk, so a large
 *  import stays O(tree + changes), not O(tree × changes).
 *
 *  `complete: false` means an event referenced an unknown parent. The caller
 *  then performs the conservative full re-scan — correctness remains the
 *  fallback when a platform backend delivers an incomplete rename batch. */
export function applyWorkspaceChanges(
  tree: FileNode[],
  root: string,
  changes: WorkspaceFilesystemChange[],
  sources: ClipSources,
): { tree: FileNode[]; complete: boolean } {
  const removed = new Set(
    changes.filter((change) => change.type === 'remove').map((change) => change.path),
  )
  const upserts = new Map(
    changes
      .filter(
        (change): change is Extract<WorkspaceFilesystemChange, { type: 'upsert' }> =>
          change.type === 'upsert',
      )
      .map((change) => [change.node.path, change.node]),
  )

  // A created directory may carry a complete scanned subtree. Native backends
  // can also report each descendant separately; consume those duplicates now.
  const consumeDescendants = (node: DiskNode): void => {
    for (const child of node.children ?? []) {
      upserts.delete(child.path)
      consumeDescendants(child)
    }
  }
  for (const node of upserts.values()) consumeDescendants(node)

  const knownDirectories = new Set<string>()
  const reconcile = (nodes: FileNode[], rootLevel: boolean): FileNode[] => {
    const next: FileNode[] = []
    let changed = false
    for (const current of nodes) {
      if (removed.has(current.id)) {
        changed = true
        continue
      }
      const disk = upserts.get(current.id)
      if (disk) upserts.delete(current.id)

      let node = current
      if (disk) {
        const mapped = mapChangedNode(disk, rootLevel, sources)
        node = {
          ...current,
          ...mapped,
          // Directory metadata updates do not carry children; directory
          // creates/renames do, and their scanned subtree is authoritative.
          children: disk.children === undefined ? current.children : mapped.children,
          source: mapped.source,
        }
        changed = true
      }
      if (node.kind === 'folder') {
        knownDirectories.add(node.id)
        if (!disk?.children) {
          const currentChildren = node.children ?? EMPTY_TREE
          const children = reconcile(currentChildren, false)
          if (children !== currentChildren) {
            node = { ...node, children }
            changed = true
          }
        }
      }
      next.push(node)
    }
    return changed ? next : nodes
  }

  let nextTree = reconcile(tree, true)

  const newDirectories = new Set(
    [...upserts.values()].filter((node) => node.isDirectory).map((node) => node.path),
  )
  let complete = true
  const additions = new Map<string, DiskNode[]>()
  for (const node of upserts.values()) {
    const parent = parentPathOf(node.path)
    if (parent !== root && !knownDirectories.has(parent) && !newDirectories.has(parent)) {
      complete = false
      continue
    }
    const siblings = additions.get(parent) ?? []
    siblings.push(node)
    additions.set(parent, siblings)
  }

  const attach = (nodes: FileNode[], parent: string, rootLevel: boolean): FileNode[] => {
    const added = (additions.get(parent) ?? []).map((node) =>
      mapChangedNode(node, rootLevel, sources),
    )
    additions.delete(parent)
    let changed = added.length > 0
    const next = [...nodes, ...added].map((node) => {
      if (node.kind !== 'folder') return node
      const currentChildren = node.children ?? EMPTY_TREE
      const children = attach(currentChildren, node.id, false)
      if (children === currentChildren) return node
      changed = true
      return { ...node, children }
    })
    return changed ? next : nodes
  }
  nextTree = attach(nextTree, root, true)
  if (additions.size > 0) complete = false
  return { tree: nextTree, complete }
}

export async function loadTree(root: string): Promise<FileNode[]> {
  const res = await window.api.invoke(IpcChannels.InvokeListDirectory, { directoryPath: root })
  if (!res.success || !res.data) throw new Error(res.error || 'Could not read the workspace')
  const children = res.data.files.map((c) => mapNode(c, true))
  const srcRes = await window.api.invoke(IpcChannels.InvokeGetClipSources, undefined)
  if (srcRes.success && srcRes.data) decorateSources(children, srcRes.data.sources)
  return children.sort((a, b) => (a.system === 'inbox' ? -1 : b.system === 'inbox' ? 1 : 0))
}

/** Make sure the conventional Inbox folder exists (created on first open). */
export async function ensureInbox(root: string): Promise<void> {
  const res = await window.api.invoke(IpcChannels.InvokeListDirectory, { directoryPath: root })
  const has = res.success && res.data?.files.some((f) => f.isDirectory && f.name === 'Inbox')
  if (has) return
  const created = await window.api.invoke(IpcChannels.InvokeCreateDirectory, {
    parentPath: root,
    name: 'Inbox',
  })
  // A workspace must be writable — surface the failure instead of opening
  // a half-initialized folder.
  if (!created.success) throw new Error(created.error || 'Could not create the Inbox folder')
}

/** Open a workspace directory: ensure its Inbox, load the tree into the
 *  store, persist it as the last-used directory, upsert it into the
 *  registry, and kick off indexing. Shared by boot, the opener page and
 *  the switcher. Throws when the folder is unreadable. */
export async function adoptWorkspace(dir: string): Promise<void> {
  // The registry canonicalizes (realpath) — use that as the workspace
  // identity everywhere so a symlinked open matches its registry entry.
  const reg = await window.api.invoke(IpcChannels.InvokeRegisterWorkspace, { path: dir })
  const root = reg.success && reg.data ? reg.data.path : dir
  await ensureInbox(root)
  const tree = await loadTree(root)
  appStore.set(workspaceTreeAtom, tree)
  appStore.set(workspacePathAtom, root)
  // Reopen this workspace's last session first — the first-use guide opens a tab,
  // and that write must not clobber the saved session before it's read.
  await restoreTabSession(root)
  // The first workspace opened on this installation gets Melo's editable
  // CODE guide. The global version marker is written only after the file
  // was successfully created/opened, so a failed write retries next time.
  const guide = await openCodeGuide({ tree, firstUseOnly: true })
  if (guide.created) {
    appStore.set(workspaceTreeAtom, await loadTree(root))
  }
  void window.api.invoke(IpcChannels.InvokeSaveLastDirectory, { directoryPath: root })
  appStore.set(indexingAtom, true)
  void window.api
    .invoke(IpcChannels.InvokeInitIndex, { directoryPath: root })
    .finally(() => appStore.set(indexingAtom, false))
}

/** Restore the last-used workspace, if it still exists. */
export async function restoreWorkspacePath(): Promise<string | null> {
  const res = await window.api.invoke(IpcChannels.InvokeGetLastDirectory, undefined)
  return res.success ? (res.data?.directoryPath ?? null) : null
}

/** Ask the user to pick a workspace folder. The directory is remembered only
 *  after adoptWorkspace succeeds, so cancelling a tab close during a switch
 *  cannot change which workspace is restored on the next launch. */
export async function pickWorkspacePath(): Promise<string | null> {
  const res = await window.api.invoke(IpcChannels.InvokeOpenDirectory, undefined)
  if (!res.success || !res.data) return null
  return res.data.directoryPath
}
