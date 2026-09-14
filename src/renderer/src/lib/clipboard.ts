/**
 * Copy plain text to the system clipboard.
 *
 * The async Clipboard API is unreliable in packaged Electron: the renderer is
 * served from `file://`, where `navigator.clipboard.writeText` can be gated by
 * focus/permission rules and silently reject. We try it first (best on the web /
 * dev server) and fall back to a hidden-textarea `execCommand('copy')`, which
 * works under `file://` without needing a main-process round-trip.
 *
 * TODO: once real file operations are wired up, route this through an Electron
 * IPC `clipboard.writeText` channel for a fully robust path.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to the execCommand path below
  }

  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    ta.style.pointerEvents = 'none'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}
