import { clipboard } from 'electron'
import fs from 'fs-extra'
import path from 'path'
import { fileURLToPath } from 'url'

/* ============================================================
   File clipboard — read the OS file list and copy it into a
   workspace folder. Only native file-list pasteboard flavors are
   consumed (text/uri-list, NSFilenamesPboardType, public.file-url):
   plain text containing "file://" is NOT a file copy — honoring it
   would turn any clipboard text into an arbitrary-local-file-read
   primitive. The probe and the paste share one extractor, so the
   menu item is enabled exactly when a paste would produce files.
   ============================================================ */

const decodeXmlEntities = (s: string): string =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')

function getClipboardFiles(): string[] {
  const out = new Set<string>()
  // Only real, absolute, existing paths count — the probe drives the
  // menu item's enabled state, so it must not report phantom files.
  const push = (p: string) => {
    if (p && path.isAbsolute(p) && fs.existsSync(p)) out.add(p)
  }

  // NOTE: never gate these reads on availableFormats() — it reports
  // Chromium's normalized MIME list and omits the native macOS flavors
  // (NSFilenamesPboardType etc.) that Finder actually writes. Attempt
  // each read; empty/unavailable formats just yield nothing.
  try {
    const content = clipboard.readBuffer('text/uri-list').toString('utf8')
    for (const line of content.split('\n')) {
      const t = line.trim()
      if (!t || t.startsWith('#') || !t.startsWith('file://')) continue
      try {
        push(fileURLToPath(t))
      } catch {
        /* malformed URI — skip */
      }
    }
  } catch {
    /* format absent */
  }

  // macOS multi-file copies (Finder): an XML plist array of paths.
  if (out.size === 0) {
    try {
      const xml = clipboard.read('NSFilenamesPboardType')
      for (const m of xml.matchAll(/<string>([\s\S]*?)<\/string>/g)) {
        push(decodeXmlEntities(m[1].trim()))
      }
    } catch {
      /* format absent */
    }
  }

  if (out.size === 0) {
    try {
      const u = clipboard.read('public.file-url').trim()
      if (u.startsWith('file://')) push(fileURLToPath(u))
    } catch {
      /* format absent */
    }
  }

  return [...out]
}

export function checkClipboardHasFiles(): boolean {
  try {
    return getClipboardFiles().length > 0
  } catch {
    return false
  }
}

export interface PasteResult {
  copiedFiles: string[]
  failed: number
  /** Set (and nothing copied) when conflicts exist and no resolution was
   *  given — the renderer asks the user and calls again. */
  conflicts?: string[]
}

export type ConflictResolution = 'keep-both' | 'replace'

/**
 * Copy the clipboard's files into `targetPath`, which must be a directory
 * inside `workspaceRoot` (checked on resolved real paths — a symlinked
 * "folder" must not smuggle writes outside the workspace).
 *
 * Name clashes: with no `onConflict` the call returns the conflicting
 * names WITHOUT copying anything (preflight — the UI prompts, Finder
 * style). 'keep-both' allocates " (n)" suffixes atomically
 * (`errorOnExist` + retry, so a concurrent paste can't overwrite a fresh
 * copy); 'replace' removes the existing entry first. Symlink sources are
 * materialized (`dereference`) — no live links land in the workspace.
 */
export async function pasteFiles(
  targetPath: string,
  workspaceRoot: string,
  onConflict?: ConflictResolution,
): Promise<PasteResult> {
  const realTarget = await fs.realpath(targetPath)
  const realRoot = await fs.realpath(workspaceRoot)
  if (realTarget !== realRoot && !realTarget.startsWith(realRoot + path.sep)) {
    throw new Error('Paste target is outside the workspace')
  }
  if (!(await fs.stat(realTarget)).isDirectory()) {
    throw new Error('Paste target is not a folder')
  }

  const sources = getClipboardFiles()

  if (!onConflict) {
    const conflicts: string[] = []
    for (const src of sources) {
      const name = path.basename(src)
      if (await fs.pathExists(path.join(realTarget, name))) conflicts.push(name)
    }
    if (conflicts.length > 0) return { copiedFiles: [], failed: 0, conflicts }
  }

  const copiedFiles: string[] = []
  let failed = 0

  for (const src of sources) {
    try {
      const name = path.basename(src)
      const ext = path.extname(name)
      const base = path.basename(name, ext)
      let candidate = path.join(realTarget, name)

      if (onConflict === 'replace' && (await fs.pathExists(candidate))) {
        // A folder must not replace itself away before being copied.
        const realSrc = await fs.realpath(src).catch(() => src)
        if (realSrc === candidate) throw new Error('Source and target are the same file')
        await fs.remove(candidate)
      }

      for (let counter = 1; ; counter++) {
        try {
          await fs.copy(src, candidate, {
            overwrite: false,
            errorOnExist: true,
            dereference: true,
          })
          break
        } catch (e) {
          const exists =
            (e as NodeJS.ErrnoException).code === 'EEXIST' || /already exists/i.test(String(e))
          if (!exists || counter > 500) throw e
          candidate = path.join(realTarget, `${base} (${counter})${ext}`)
        }
      }
      copiedFiles.push(candidate)
    } catch (error) {
      console.error(`Failed to paste ${src}:`, error)
      failed++
    }
  }

  return { copiedFiles, failed }
}
