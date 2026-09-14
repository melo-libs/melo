/* ============================================================
   File-kind classification by extension — shared between the
   main process (smart folder Kind rules) and the renderer
   (icons, labels). Markdown splits into 'note' vs 'clip' by
   whether the file carries a `source` field, which only the
   index knows — so md maps to 'note' here and the caller
   upgrades it to 'clip' when a source is present.
   ============================================================ */

export type SmartKind = 'note' | 'clip' | 'pdf' | 'image' | 'audio' | 'video' | 'code' | 'other'

export const MARKDOWN_FILE_EXTENSIONS = ['md', 'markdown'] as const
export const TEXT_DOCUMENT_EXTENSIONS = ['txt', ...MARKDOWN_FILE_EXTENSIONS] as const

const MARKDOWN_EXTENSION_RE = /\.(md|markdown)$/i

export function isMarkdownPath(filePath: string): boolean {
  return MARKDOWN_EXTENSION_RE.test(filePath)
}

export function stripMarkdownExtension(fileName: string): string {
  return fileName.replace(MARKDOWN_EXTENSION_RE, '')
}

export function isTextDocumentPath(filePath: string): boolean {
  const extension = filePath.slice(filePath.lastIndexOf('.') + 1).toLowerCase()
  return (TEXT_DOCUMENT_EXTENSIONS as readonly string[]).includes(extension)
}

const EXT_KIND: Record<string, SmartKind> = {
  md: 'note',
  markdown: 'note',
  txt: 'note',
  html: 'clip',
  htm: 'clip',
  pdf: 'pdf',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  svg: 'image',
  heic: 'image',
  mp3: 'audio',
  m4a: 'audio',
  wav: 'audio',
  flac: 'audio',
  ogg: 'audio',
  mp4: 'video',
  mov: 'video',
  mkv: 'video',
  webm: 'video',
  js: 'code',
  ts: 'code',
  jsx: 'code',
  tsx: 'code',
  py: 'code',
  rb: 'code',
  go: 'code',
  rs: 'code',
  c: 'code',
  h: 'code',
  cpp: 'code',
  java: 'code',
  swift: 'code',
  sh: 'code',
  css: 'code',
  scss: 'code',
  json: 'code',
  yaml: 'code',
  yml: 'code',
  toml: 'code',
}

export function kindOfPath(filePath: string): SmartKind {
  const ext = filePath.slice(filePath.lastIndexOf('.') + 1).toLowerCase()
  return EXT_KIND[ext] ?? 'other'
}

/** Extensions for one kind — for SQL LIKE clauses in the main process. */
export function extensionsOf(kind: SmartKind): string[] {
  return Object.entries(EXT_KIND)
    .filter(([, k]) => k === kind)
    .map(([ext]) => ext)
}
