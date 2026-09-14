import type { FileNode } from './types'
import type { FlatFolder } from './treeOps'

const lastSeparator = (value: string): number =>
  Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'))

export const parentFolderId = (value: string): string => {
  const cut = lastSeparator(value)
  if (cut < 0) return ''
  if (cut === 0) return value[0]
  if (cut === 2 && value[1] === ':') return value.slice(0, 3)
  return value.slice(0, cut)
}

const normalized = (value: string): string => {
  if (value.length <= 1 || /^[A-Za-z]:[\\/]$/.test(value)) return value
  return value.replace(/[\\/]+$/, '')
}

export const isInsidePath = (candidate: string, parent: string): boolean => {
  const child = normalized(candidate)
  const root = normalized(parent)
  return child.startsWith(root + '/') || child.startsWith(root + '\\')
}

/** A folder may be browsed unless it is the moving folder or one of its descendants. */
export const canBrowseMoveFolder = (source: FileNode, folderId: string): boolean =>
  source.kind !== 'folder' || (folderId !== source.id && !isInsidePath(folderId, source.id))

/** Moving to the current parent is a no-op and is therefore not confirmable. */
export const canMoveToFolder = (source: FileNode, folderId: string): boolean =>
  canBrowseMoveFolder(source, folderId) &&
  normalized(folderId) !== normalized(parentFolderId(source.id))

const searchable = (value: string): string => value.normalize('NFKC').toLocaleLowerCase()

export const searchMoveFolders = (
  folders: FlatFolder[],
  source: FileNode,
  query: string,
): FlatFolder[] => {
  const terms = searchable(query).split(/\s+/).filter(Boolean)
  if (terms.length === 0) return []
  return folders
    .filter((folder) => canMoveToFolder(source, folder.id))
    .filter((folder) => {
      const haystack = searchable(`${folder.name} ${folder.path}`)
      return terms.every((term) => haystack.includes(term))
    })
    .sort((left, right) => {
      const leftName = searchable(left.name)
      const rightName = searchable(right.name)
      const first = terms[0]
      const leftRank = leftName === first ? 0 : leftName.startsWith(first) ? 1 : 2
      const rightRank = rightName === first ? 0 : rightName.startsWith(first) ? 1 : 2
      return leftRank - rightRank || left.path.localeCompare(right.path)
    })
}

export const moveFolderBreadcrumbs = (
  currentId: string,
  workspaceId: string,
  folderById: Map<string, FlatFolder>,
): FlatFolder[] => {
  const result: FlatFolder[] = []
  let id = currentId
  const seen = new Set<string>()
  while (id && !seen.has(id)) {
    seen.add(id)
    const folder = folderById.get(id)
    if (folder) result.unshift(folder)
    if (id === workspaceId) break
    id = parentFolderId(id)
  }
  const workspace = folderById.get(workspaceId)
  if (workspace && result[0]?.id !== workspaceId) result.unshift(workspace)
  return result
}
