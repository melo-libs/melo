import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  classifyDocumentHref,
  type ResolveDocumentLinkRequest,
  type ResolvedDocumentLink,
} from '../../shared/documentLinks'

const inside = (root: string, target: string): boolean => {
  const relative = path.relative(root, target)
  return (
    relative === '' ||
    (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
  )
}

/** Only ENOENT/ENOTDIR mean a missing target; permission and IO failures propagate. */
async function canonicalPath(target: string): Promise<string | null> {
  try {
    return await fs.realpath(target)
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return null
    throw error
  }
}

export async function resolveDocumentLink(
  request: ResolveDocumentLinkRequest,
  activeRoot: string | null,
): Promise<ResolvedDocumentLink> {
  if (!activeRoot || path.resolve(request.workspaceRoot) !== path.resolve(activeRoot))
    return { kind: 'error', reason: 'workspaceChanged' }
  const root = await fs.realpath(activeRoot)
  const classified = classifyDocumentHref(request.href)
  if (classified.kind !== 'local') return { kind: 'error', reason: 'invalid' }

  let target: string
  let fragment: string
  try {
    const hash = classified.href.indexOf('#')
    fragment = hash < 0 ? '' : decodeURIComponent(classified.href.slice(hash + 1))
    const reference = (hash < 0 ? classified.href : classified.href.slice(0, hash)).split('?')[0]
    if (/^file:/i.test(reference)) {
      target = fileURLToPath(reference)
    } else {
      const decoded = decodeURIComponent(reference)
      if (!decoded || decoded.includes('\0')) return { kind: 'error', reason: 'invalid' }
      // A drive path is explicitly absolute, even on a different OS.
      if (/^[a-z]:[\\/]/i.test(decoded)) {
        if (process.platform !== 'win32') return { kind: 'error', reason: 'outside' }
        target = path.resolve(decoded)
      } else if (path.isAbsolute(decoded)) {
        const absolute = path.resolve(decoded)
        // Slash paths have one meaning independent of file existence. file://
        // is the unambiguous way to name an absolute path outside this root.
        target =
          inside(root, absolute) || inside(path.resolve(activeRoot), absolute)
            ? absolute
            : path.resolve(root, '.' + decoded)
      } else {
        let base = root
        if (request.fromPath) {
          const source = await canonicalPath(request.fromPath)
          if (!source || !inside(root, source)) return { kind: 'error', reason: 'outside' }
          base = path.dirname(path.resolve(request.fromPath))
        }
        target = path.resolve(base, decoded)
      }
    }
  } catch (error) {
    if (error instanceof URIError || error instanceof TypeError)
      return { kind: 'error', reason: 'invalid' }
    throw error
  }
  // Check lexical containment before probing disk, then canonical containment
  // after resolving symlinks. No fallback from an outside symlink to .md.
  if (!inside(root, target) && !inside(path.resolve(activeRoot), target))
    return { kind: 'error', reason: 'outside' }
  let resolved = await canonicalPath(target)
  if (!resolved && !path.extname(target)) resolved = await canonicalPath(target + '.md')
  if (!resolved) return { kind: 'error', reason: 'missing' }
  if (!inside(root, resolved)) return { kind: 'error', reason: 'outside' }
  const stat = await fs.stat(resolved)
  if (!stat.isDirectory() && !stat.isFile()) return { kind: 'error', reason: 'invalid' }
  // Keep the workspace's path spelling so tabs and tree rows share one identity
  // even when the workspace itself was opened through a symlink.
  return {
    kind: stat.isDirectory() ? 'directory' : 'file',
    path: path.join(path.resolve(activeRoot), path.relative(root, resolved)),
    fragment,
  }
}
