export type DocumentHref =
  | { kind: 'external'; url: string }
  | { kind: 'local'; href: string }
  | { kind: 'fragment'; fragment: string }
  | { kind: 'unsupported' }

/** Stored hrefs are references, never input for website auto-completion. */
export function classifyDocumentHref(raw: string): DocumentHref {
  const href = raw.trim()
  // eslint-disable-next-line no-control-regex -- URL parsers silently discard controls in scheme names.
  if (!href || /[\u0000-\u001f\u007f]/.test(href)) return { kind: 'unsupported' }
  if (href.startsWith('#')) {
    try {
      return { kind: 'fragment', fragment: decodeURIComponent(href.slice(1)) }
    } catch {
      return { kind: 'unsupported' }
    }
  }
  if (/^(https?:|mailto:)/i.test(href)) {
    try {
      return { kind: 'external', url: new URL(href).href }
    } catch {
      return { kind: 'unsupported' }
    }
  }
  if (/^file:/i.test(href) || /^[a-z]:[\\/]/i.test(href) || !/^[a-z][a-z0-9+.-]*:/i.test(href))
    return { kind: 'local', href }
  return { kind: 'unsupported' }
}

export type DocumentLinkError = 'outside' | 'missing' | 'invalid' | 'workspaceChanged'

export type ResolvedDocumentLink =
  | { kind: 'file' | 'directory'; path: string; fragment: string }
  | { kind: 'error'; reason: DocumentLinkError }

export interface ResolveDocumentLinkRequest {
  href: string
  fromPath: string | null
  workspaceRoot: string
}
