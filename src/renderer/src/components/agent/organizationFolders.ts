export const parentFolder = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')))
export const folderName = (path: string) => path.split('/').pop()!
export const joinFolder = (parent: string, name: string) => [parent, name].filter(Boolean).join('/')
export const validOrganizationName = (name: string) =>
  !!name.trim() &&
  !name.trim().startsWith('.') &&
  !/[\\/]/.test(name) &&
  [...name].every((character) => character.charCodeAt(0) >= 32)

export function folderPrefixes(path: string): string[] {
  return path ? path.split('/').map((_, index, parts) => parts.slice(0, index + 1).join('/')) : []
}

export function organizationFolders(locations: string[], destinations: (string | null)[]) {
  const folders = new Set(['', ...locations])
  for (const destination of destinations)
    if (destination)
      for (const folder of folderPrefixes(parentFolder(destination))) folders.add(folder)
  return [...folders].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
}

/** Renaming a planned folder keeps every file in that draft subtree together. */
export function renamePlannedFolder(
  destinations: Map<string, string | null>,
  folder: string,
  name: string,
) {
  const renamed = joinFolder(parentFolder(folder), name)
  return new Map(
    [...destinations].map(([id, destination]) => [
      id,
      destination?.startsWith(folder + '/')
        ? renamed + destination.slice(folder.length)
        : destination,
    ]),
  )
}
