import { isMap, isNode, isScalar, parseDocument } from 'yaml'

export function normalizeTags(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : []
  return [
    ...new Set(
      list.map((tag) => String(tag).trim().replace(/^#/, '').toLowerCase()).filter(Boolean),
    ),
  ]
}

function metadata(content: string) {
  const match = /^(?:\uFEFF)?---[^\S\r\n]*\r?\n/.exec(content)
  if (!match) return { prefix: '', yaml: '', suffix: content }
  const end = /^---[^\S\r\n]*\r?$/m.exec(content.slice(match[0].length))
  if (!end) throw new Error('Unclosed document metadata; fix the frontmatter before editing tags')
  const offset = match[0].length + end.index
  return {
    prefix: match[0],
    yaml: content.slice(match[0].length, offset),
    suffix: content.slice(offset),
  }
}

function parseTags(content: string) {
  const parts = metadata(content)
  const doc = parseDocument(parts.yaml, { uniqueKeys: true })
  if (doc.errors.length || (doc.contents && !isMap(doc.contents)))
    throw new Error('Invalid document metadata; fix the frontmatter before editing tags')
  // Merge keys and aliases can make tags depend on another field; refuse to mutate that ambiguity.
  if (
    isMap(doc.contents) &&
    doc.contents.items.some((pair) => isScalar(pair.key) && pair.key.value === '<<')
  )
    throw new Error('Merged document metadata is not supported for tag edits')
  const raw = doc.toJS({ maxAliasCount: 20 })?.tags
  if (
    raw != null &&
    typeof raw !== 'string' &&
    !(Array.isArray(raw) && raw.every((tag) => typeof tag === 'string'))
  )
    throw new Error('Document tags must be a string or a list of strings')
  return { ...parts, doc, tags: normalizeTags(raw) }
}

export function readDocumentTags(content: string): string[] {
  return parseTags(content).tags
}

export function updateDocumentTags(content: string, tags: string[]): string {
  const parsed = parseTags(content)
  const next = normalizeTags(tags)
  if (JSON.stringify(next) === JSON.stringify(parsed.tags)) return content
  const newline = parsed.prefix.endsWith('\r\n') ? '\r\n' : '\n'
  const encoded = JSON.stringify(next)
  if (!parsed.prefix) return `---\ntags: ${encoded}\n---\n` + content
  const map = parsed.doc.contents
  const pair = isMap(map)
    ? map.items.find((pair) => isScalar(pair.key) && pair.key.value === 'tags')
    : undefined
  let yaml = parsed.yaml
  if (isMap(map) && map.flow) {
    parsed.doc.set('tags', next)
    yaml = parsed.doc.toString().replace(/\n/g, newline)
  } else if (pair && isNode(pair.key) && pair.key.range && isNode(pair.value) && pair.value.range) {
    const start = pair.key.range[0],
      end = pair.value.range[1]
    const previous = yaml.slice(start, end)
    yaml =
      yaml.slice(0, start) +
      `tags: ${encoded}` +
      (/\r?\n$/.test(previous) ? newline : '') +
      yaml.slice(end)
  } else {
    yaml += `${yaml && !yaml.endsWith('\n') ? newline : ''}tags: ${encoded}${newline}`
  }
  return parsed.prefix + yaml + parsed.suffix
}

/** Internal metadata writes may change tags only, including when restoring an undo backup. */
export function assertTagOnlyChange(before: string, after: string): void {
  const comparable = (content: string) => {
    const parsed = parseTags(content)
    const data = parsed.doc.toJS({ maxAliasCount: 20 }) ?? {}
    delete data.tags
    const body = parsed.prefix
      ? parsed.suffix.replace(/^---[^\S\r\n]*(?:\r?\n|$)/, '')
      : parsed.suffix
    return JSON.stringify({ data, body })
  }
  if (comparable(before) !== comparable(after))
    throw new Error('Tag changes must preserve document content and other metadata')
}
