const IMAGE_EXTENSION = /\.(?:png|jpe?g|gif|webp|avif|bmp|svg)$/i
export const MAX_AGENT_IMAGE_BYTES = 20 * 1024 * 1024

export type AgentImageSource =
  | { kind: 'remote'; url: string }
  | { kind: 'data'; url: string }
  | { kind: 'workspace'; path: string }

export function agentImageSource(source: string): AgentImageSource | null {
  if (/^https?:\/\//i.test(source)) {
    try {
      const url = new URL(source)
      if (url.username || url.password) return null
      return { kind: 'remote', url: url.href }
    } catch {
      return null
    }
  }
  if (/^data:image\/(?:png|jpeg|gif|webp|avif|bmp);base64,[a-z\d+/=]+$/i.test(source))
    return source.length <= MAX_AGENT_IMAGE_BYTES * 1.4 ? { kind: 'data', url: source } : null
  let relative: string
  try {
    relative = decodeURIComponent(source).replace(/^\.\//, '')
  } catch {
    return null
  }
  if (
    !IMAGE_EXTENSION.test(relative) ||
    /^[a-z][a-z\d+.-]*:/i.test(relative) ||
    relative.startsWith('/') ||
    relative.includes('\\') ||
    /[?#]/.test(relative) ||
    [...relative].some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    ) ||
    relative
      .split('/')
      .some(
        (part, index) => !part || (part.startsWith('.') && !(index === 0 && part === '.assets')),
      )
  )
    return null
  return { kind: 'workspace', path: relative }
}
