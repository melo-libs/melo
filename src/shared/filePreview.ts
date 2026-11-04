import { kindOfPath, isMarkdownPath } from './fileKinds'

export function filePreview(name: string) {
  const extension = name.split('.').pop()!.toLowerCase()
  const kind = kindOfPath(name)
  if (kind === 'image') return { kind: 'image', label: '', tone: 'image' } as const
  if (kind === 'video') return { kind: 'video', label: '', tone: 'video' } as const
  if (extension === 'pdf') return { kind: 'document', label: 'PDF', tone: 'pdf' } as const
  if (['doc', 'docx', 'pages', 'rtf'].includes(extension))
    return { kind: 'document', label: 'W', tone: 'word' } as const
  if (['xls', 'xlsx', 'numbers'].includes(extension))
    return { kind: 'document', label: 'X', tone: 'sheet' } as const
  if (['ppt', 'pptx', 'key'].includes(extension))
    return { kind: 'document', label: 'P', tone: 'slides' } as const
  if (isMarkdownPath(name)) return { kind: 'file', label: 'MD', tone: 'note' } as const
  if (kind === 'audio')
    return { kind: 'file', label: extension.toUpperCase(), tone: 'audio' } as const
  if (['zip', '7z', 'rar', 'tar', 'gz'].includes(extension))
    return { kind: 'file', label: 'ZIP', tone: 'archive' } as const
  return { kind: 'file', label: 'FILE', tone: 'other' } as const
}
