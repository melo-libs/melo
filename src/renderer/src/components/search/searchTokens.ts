/** Quoted tag values keep multi-word labels intact while other search syntax stays unchanged. */
export function searchTokens(query: string): string[] {
  return query.match(/tag:"(?:\\.|[^"\\])*"|\S+/gi) ?? []
}

export function tagSearchQuery(tag: string): string {
  return `tag:${JSON.stringify(tag)}`
}

export function searchFilterValue(kind: string, value: string): string {
  if (kind.toLowerCase() === 'tag' && value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value) as string
    } catch {
      // A partially typed quoted value remains searchable as literal text.
    }
  }
  return value
}
