import type { FileNode } from './types'

/* ============================================================
   Immutable file-tree operations. Every mutation rebuilds the
   tree so React rerenders cleanly.
   ============================================================ */

export function findNode(tree: FileNode[], id: string): FileNode | null {
  for (const n of tree) {
    if (n.id === id) return n
    if (n.children) {
      const f = findNode(n.children, id)
      if (f) return f
    }
  }
  return null
}

export function findParent(tree: FileNode[], id: string): FileNode | null {
  for (const n of tree) {
    if (n.children) {
      if (n.children.some((c) => c.id === id)) return n
      const found = findParent(n.children, id)
      if (found) return found
    }
  }
  return null
}

export function mapTree(tree: FileNode[], fn: (n: FileNode) => FileNode | null): FileNode[] {
  return tree.map((n) => {
    const next = fn(n) ?? n
    if (next.children) return { ...next, children: mapTree(next.children, fn) }
    return next
  })
}

export function removeNode(tree: FileNode[], id: string): FileNode[] {
  const out: FileNode[] = []
  for (const n of tree) {
    if (n.id === id) continue
    if (n.children) out.push({ ...n, children: removeNode(n.children, id) })
    else out.push(n)
  }
  return out
}

export function insertInto(tree: FileNode[], folderId: string, child: FileNode): FileNode[] {
  return mapTree(tree, (n) => {
    if (n.id === folderId && n.kind === 'folder') {
      return { ...n, open: true, children: [child, ...(n.children ?? [])] }
    }
    return n
  })
}

export function moveTo(tree: FileNode[], id: string, folderId: string): FileNode[] {
  const node = findNode(tree, id)
  if (!node) return tree
  return insertInto(removeNode(tree, id), folderId, node)
}

/** Flatten folders to a list (id, name, indented path) for the "Move to" menu. */
export interface FlatFolder {
  id: string
  name: string
  path: string
  system?: FileNode['system']
}
export function flattenFolders(tree: FileNode[], out: FlatFolder[] = [], path = ''): FlatFolder[] {
  for (const n of tree) {
    if (n.kind === 'folder') {
      const here = path ? `${path} / ${n.name}` : n.name
      out.push({ id: n.id, name: n.name, path: here, system: n.system })
      if (n.children) flattenFolders(n.children, out, here)
    }
  }
  return out
}

/** Ids of a node plus all of its ancestor folders, root-first (for revealing). */
export function ancestorChain(tree: FileNode[], id: string): string[] {
  const found: string[] = []
  const walk = (nodes: FileNode[], trail: string[]): boolean => {
    for (const n of nodes) {
      const next = [...trail, n.id]
      if (n.id === id) {
        found.push(...next)
        return true
      }
      if (n.children && walk(n.children, next)) return true
    }
    return false
  }
  walk(tree, [])
  return found
}

/** Slash-separated path of a node (for "Copy path"). */
export function pathOf(tree: FileNode[], id: string, prefix = ''): string {
  for (const n of tree) {
    if (n.id === id) return prefix + n.name
    if (n.children) {
      const p = pathOf(n.children, id, `${prefix + n.name}/`)
      if (p) return p
    }
  }
  return ''
}

/** Deep-clone a node, assigning a fresh id to it and every descendant. */
export function cloneWithNewIds(node: FileNode, makeId: () => string): FileNode {
  return {
    ...node,
    id: makeId(),
    children: node.children?.map((c) => cloneWithNewIds(c, makeId)),
  }
}

export function deriveCopyName(name: string): string {
  const m = name.match(/^(.*?)( copy(?: (\d+))?)?(\.[^.]+)?$/)
  if (!m) return `${name} copy`
  const base = m[1]
  const ext = m[4] ?? ''
  if (!m[2]) return `${base} copy${ext}` // first copy
  // Already a copy: " copy" → " copy 2", " copy 2" → " copy 3", …
  const next = m[3] ? parseInt(m[3], 10) + 1 : 2
  return `${base} copy ${next}${ext}`
}

export type TreeSortRule =
  | 'name-asc'
  | 'name-desc'
  | 'modified-desc'
  | 'modified-asc'
  | 'created-desc'
  | 'created-asc'

/** Display ordering: folders before files, the system Inbox pinned first,
 *  then the chosen rule + direction. Pure — returns new arrays. */
export function sortNodes(nodes: FileNode[], rule: TreeSortRule): FileNode[] {
  const [key, dir] = rule.split('-') as ['name' | 'modified' | 'created', 'asc' | 'desc']
  const sign = dir === 'asc' ? 1 : -1
  const cmp = (a: FileNode, b: FileNode): number => {
    if (a.system === 'inbox') return -1
    if (b.system === 'inbox') return 1
    const aDir = a.kind === 'folder'
    const bDir = b.kind === 'folder'
    if (aDir !== bDir) return aDir ? -1 : 1
    if (key === 'modified') return sign * ((a.mtime ?? 0) - (b.mtime ?? 0))
    if (key === 'created') return sign * ((a.btime ?? 0) - (b.btime ?? 0))
    return sign * a.name.localeCompare(b.name)
  }
  return [...nodes].sort(cmp)
}

/** Deep form retained for non-UI callers and tests. The sidebar sorts one
 *  visible level at a time so a collapsed large workspace is not cloned in
 *  full whenever one file changes. */
export function sortTree(nodes: FileNode[], rule: TreeSortRule): FileNode[] {
  return sortNodes(nodes, rule).map((n) =>
    n.children ? { ...n, children: sortTree(n.children, rule) } : n,
  )
}
