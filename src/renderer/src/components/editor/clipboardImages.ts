import {
  clipboardWorkspaceKey,
  CLIPBOARD_IMAGE_SOURCE_ATTRIBUTE,
  CLIPBOARD_IMAGE_WORKSPACE_ATTRIBUTE,
} from '@shared/clipboard'

/** Public HTML embeds image data; our own paste can reuse its workspace asset. */
export function originalClipboardImageSrc(
  element: HTMLElement,
  workspaceRoot: string,
): string | null {
  const src = element.getAttribute(CLIPBOARD_IMAGE_SOURCE_ATTRIBUTE)
  if (
    !src ||
    element.getAttribute(CLIPBOARD_IMAGE_WORKSPACE_ATTRIBUTE) !==
      clipboardWorkspaceKey(workspaceRoot)
  )
    return null
  if (
    /^[a-z][a-z\d+.-]*:/i.test(src) ||
    src.startsWith('/') ||
    src.includes('\\') ||
    /(^|\/)\.\.(\/|$)/.test(src)
  )
    return null
  return src
}

export function restoreClipboardImageSources(
  html: string,
  workspaceRoot: string,
  document: Document,
): string {
  if (!workspaceRoot || !html.includes(CLIPBOARD_IMAGE_SOURCE_ATTRIBUTE)) return html
  // A template parses a fragment without dropping top-level table rows/cells.
  const template = document.createElement('template')
  template.innerHTML = html
  let changed = false
  for (const element of template.content.querySelectorAll('img')) {
    const src = originalClipboardImageSrc(element, workspaceRoot)
    if (!src) continue
    element.setAttribute('src', src)
    changed = true
  }
  return changed ? template.innerHTML : html
}
