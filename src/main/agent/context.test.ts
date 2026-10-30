import { expect, it } from 'vitest'
import { assembleContext, MAX_CONTEXT_CHARS } from './context'
it('keeps recent exchanges across notes with explicit source labels and historical retrieval', () => {
  const prompt = assembleContext({
    text: 'Explain this',
    context: { filePath: 'Travel.md' },
    history: [
      {
        id: 'a',
        role: 'user',
        content: 'Unrelated project instructions',
        context: { filePath: 'Work.md' },
        createdAt: 1,
      },
      {
        id: 'b',
        role: 'assistant',
        content: 'Earlier travel explanation',
        context: { filePath: 'Travel.md' },
        createdAt: 2,
      },
    ],
    memory: { user: 'Prefer concise replies.', workspace: '' },
  })
  expect(prompt).toContain('Unrelated project instructions')
  expect(prompt).toContain('Referenced document: Work.md')
  expect(prompt).toContain('Earlier travel explanation')
  expect(prompt).toContain('Prefer concise replies.')
  expect(prompt).toContain('melo_search_history')
})

it('prioritizes the current request and selection within a total context budget', () => {
  const request = 'Q'.repeat(32000),
    selection = 'S'.repeat(24000)
  const prompt = assembleContext({
    text: request,
    context: { filePath: 'B.md', selection },
    memory: { user: 'U'.repeat(16000), workspace: 'W'.repeat(16000) },
    history: [
      {
        id: 'reply',
        role: 'assistant',
        content: 'Latest useful answer ' + 'A'.repeat(8000),
        context: { filePath: 'A.md' },
        createdAt: 1,
      },
    ],
  })
  expect(prompt.length).toBeLessThanOrEqual(MAX_CONTEXT_CHARS)
  expect(prompt).toContain(request)
  expect(prompt).toContain(selection)
  expect(prompt).toContain('Referenced document: A.md')
  expect(prompt).toContain('Latest useful answer')
  expect(prompt).toContain('[Truncated to fit the context budget.]')
})

it('limits recent exchanges and omits raw tool messages', () => {
  const prompt = assembleContext({
    text: 'Continue',
    context: {},
    memory: { user: '', workspace: '' },
    history: [
      { id: 'old', role: 'user', content: 'Older exchange outside the window', createdAt: 0 },
      ...Array.from({ length: 8 }, (_, index) => ({
        id: String(index),
        role: 'assistant' as const,
        content: `Recent ${index}`,
        createdAt: index + 1,
      })),
      { id: 'tool', role: 'tool', content: 'Raw tool output', createdAt: 10 },
    ],
  })
  expect(prompt).not.toContain('Older exchange outside the window')
  expect(prompt).not.toContain('Raw tool output')
  expect(prompt).toContain('Recent 0')
  expect(prompt).toContain('Recent 7')
})
