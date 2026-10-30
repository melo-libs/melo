import type { FileNode } from '../sidebar/types'

export function agentFilePath(href: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('/') || href.includes('?')) return null
  let value: string
  try {
    value = decodeURIComponent(href.split('#')[0])
  } catch {
    return null
  }
  value = value.replace(/^\.\//, '')
  if (
    !value ||
    /^[a-z][a-z0-9+.-]*:/i.test(value) ||
    value.includes('\\') ||
    [...value].some((char) => char.charCodeAt(0) < 32) ||
    value.split('/').some((part) => !part || part.startsWith('.'))
  )
    return null
  return value
}

export function findAgentFile(
  tree: FileNode[],
  root: string,
  relativePath: string,
): FileNode | undefined {
  if (
    !relativePath ||
    /^[a-z][a-z0-9+.-]*:/i.test(relativePath) ||
    relativePath.startsWith('/') ||
    relativePath.includes('\\') ||
    [...relativePath].some((char) => char.charCodeAt(0) < 32) ||
    relativePath.split('/').some((part) => !part || part.startsWith('.'))
  )
    return undefined
  const id = `${root}/${relativePath}`
  const find = (nodes: FileNode[]): FileNode | undefined => {
    for (const node of nodes) {
      if (node.id === id && node.kind !== 'folder') return node
      if (node.children) {
        const found = find(node.children)
        if (found) return found
      }
    }
    return undefined
  }
  return find(tree)
}
