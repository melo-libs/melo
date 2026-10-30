/** Keep a possible key prefix between chunks so a split credential never
 * reaches the transcript before the rest of it arrives. */
export function runtimeOutput(secret: string | undefined) {
  let pending = ''
  const sanitize = (text: string) => (secret ? text.replaceAll(secret, '[redacted]') : text)
  return {
    sanitize,
    push(text: string): string {
      if (!secret) return text
      const value = sanitize(pending + text)
      let keep = Math.min(secret.length - 1, value.length)
      while (keep && !value.endsWith(secret.slice(0, keep))) keep--
      pending = keep ? value.slice(-keep) : ''
      return keep ? value.slice(0, -keep) : value
    },
    flush(): string {
      const value = pending
      pending = ''
      return value
    },
  }
}
