import { classifyDocumentHref } from '@shared/documentLinks'

/** http(s)/mailto only, scheme-less input coerced to https — keeps
 *  javascript: and friends away from the system browser and out of
 *  saved documents. */
export function safeExternalUrl(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const url = new URL(withScheme)
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.href : null
  } catch {
    return null
  }
}

/** Completion belongs only to edited input, not hrefs loaded from a note. */
export function normalizeLinkInput(raw: string, originalHref = ''): string | null {
  const href = raw.trim()
  const target = classifyDocumentHref(href)
  if (target.kind === 'unsupported') return null
  if (target.kind === 'external') return target.url
  if (
    href === originalHref.trim() ||
    target.kind === 'fragment' ||
    /^(?:file:|[a-z]:[\\/]|\.{1,2}[\\/]|[\\/])/i.test(href)
  )
    return href
  // A web resource's extension does not make its host a local directory.
  if (/^(?:[\p{L}\p{N}-]+\.)+(?:\p{L}{2,}|xn--[a-z0-9-]+)\//iu.test(href))
    return safeExternalUrl(href)
  if (
    /\.(?:md|markdown|txt|pdf|png|jpe?g|gif|webp|svg)(?:[?#]|$)/i.test(href) ||
    (href.includes('/') && !href.split('/')[0].includes('.'))
  )
    return href
  return safeExternalUrl(href)
}
