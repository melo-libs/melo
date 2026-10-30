import { createTwoFilesPatch } from 'diff'

export function editPreview(file: string, before: string, after: string): string {
  const patch = createTwoFilesPatch(file, file, before, after, undefined, undefined, {
    context: 3,
    timeout: 500,
  })
  if (!patch) throw new Error('AGENT_DIFF_UNAVAILABLE')
  return patch
}
