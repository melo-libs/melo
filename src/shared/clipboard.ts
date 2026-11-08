export const MAX_CLIPBOARD_IMAGE_BYTES = 20 * 1024 * 1024
export const MAX_CLIPBOARD_HTML_LENGTH = 32 * 1024 * 1024
export const MAX_CLIPBOARD_TEXT_LENGTH = 2 * 1024 * 1024

export const CLIPBOARD_COPY_ID_ATTRIBUTE = 'data-melo-copy-id'

export type ClipboardWriteCondition = { expectedStamp: string } | { expectedCopyId: string }
