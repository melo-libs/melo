export const MAX_CLIPBOARD_IMAGE_BYTES = 20 * 1024 * 1024
export const MAX_CLIPBOARD_HTML_LENGTH = 32 * 1024 * 1024
export const MAX_CLIPBOARD_TEXT_LENGTH = 2 * 1024 * 1024
export const MAX_CLIPBOARD_IMAGE_PIXELS = 32 * 1024 * 1024

export const CLIPBOARD_COPY_ID_ATTRIBUTE = 'data-melo-copy-id'
export const CLIPBOARD_IMAGE_SOURCE_ATTRIBUTE = 'data-melo-image-src'
export const CLIPBOARD_IMAGE_WORKSPACE_ATTRIBUTE = 'data-melo-image-workspace'

export interface EditorClipboardContent {
  text: string
  html: string
  workspaceRoot: string
  singleImage: boolean
}

export interface EditorClipboardResult {
  fallbackImages: number
  bitmap: 'none' | 'ready' | 'pending' | 'unavailable'
}

export type ClipboardImageCopyStatus = 'copying' | 'copied' | 'failed'

export function clipboardWorkspaceKey(root: string): string {
  let hash = 5381
  for (const character of root) hash = (Math.imul(hash, 33) ^ character.charCodeAt(0)) >>> 0
  return hash.toString(16)
}
