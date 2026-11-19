import { expect, it } from 'vitest'
import { MarkdownManager } from '@tiptap/markdown'
import { StarterKit } from '@tiptap/starter-kit'
import { agentMarkdown, userMarkdown } from './agentMarkdown'

it('keeps chat bold tolerance and user line breaks out of the document parser', () => {
  const document = new MarkdownManager({ extensions: [StarterKit] })
  const source = '**中文。**接着写'
  expect(agentMarkdown.parse(source).content?.[0].content?.[0].marks).toEqual([{ type: 'bold' }])
  expect(document.parse(source).content?.[0].content?.[0].text).toBe(source)
  expect(userMarkdown.parse('first\nsecond').content?.[0].content?.[1].type).toBe('hardBreak')
  expect(document.parse('first\nsecond').content?.[0].content).toHaveLength(1)
})
