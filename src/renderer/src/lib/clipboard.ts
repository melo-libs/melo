/**
 * Copy plain text to the system clipboard.
 *
 * The async Clipboard API is unreliable in packaged Electron: the renderer is
 * served from `file://`, where `navigator.clipboard.writeText` can be gated by
 * focus/permission rules and silently reject. We try it first (best on the web /
 * dev server) and fall back to a hidden-textarea `execCommand('copy')`, which
 * works under `file://` without needing a main-process round-trip.
 *
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
    const focused = document.activeElement as HTMLElement | null
    const selection = document.getSelection()
    const ranges = selection
      ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange())
      : []
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    ta.style.pointerEvents = 'none'
    document.body.appendChild(ta)
    try {
      ta.select()
      return document.execCommand('copy')
    } finally {
      ta.remove()
      if (focused?.isConnected) focused.focus({ preventScroll: true })
      if (selection) {
        selection.removeAllRanges()
        for (const range of ranges) selection.addRange(range)
      }
    }
  } catch {
    return false
  }
}
