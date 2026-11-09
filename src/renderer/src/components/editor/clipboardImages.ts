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
