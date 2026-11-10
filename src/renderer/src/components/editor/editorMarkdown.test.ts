import { describe, expect, it } from 'vitest'
import { MarkdownManager } from '@tiptap/markdown'
import type { JSONContent } from '@tiptap/core'
import { editorExtensions } from './tiptapExtensions'

const manager = new MarkdownManager({ extensions: editorExtensions })

describe('editor Markdown persistence', () => {
  it.each([
    ['heading spacing', '# Heading\n\n\nAfter heading'],
    ['table spacing', '| A | B |\n| --- | --- |\n| one | two |\n\n\nAfter table'],
    ['nested tasks', '- [ ] Task\n  - Nested bullet\n  - Another bullet\n- [x] Done'],
    ['list boundaries', '1. **First**\n2. *Second*\n\n## Next heading\n\n- Bullet'],
    ['alphabetic lists', 'a. First\nb. Second'],
    ['Roman lists', 'I. First\nII. Second'],
    ['code blocks', '```ts\nconst value = "# literal"\n\n// keep blank line\n```'],
    ['Mermaid diagrams', '```mermaid\nflowchart LR\n  A[开始] --> B[完成]\n```'],
    ['invalid Mermaid source', '```mermaid\nflowchart LR\n  A[unfinished\n```'],
    ['link preceded by exclamation', '\\![example](https://example.com)'],
    ['image caption', '![Caption](.assets/example.png "Title")'],
    ['math', 'Inline $x^2$ formula\n\n$$\ny = x + 1\n$$'],
  ])('preserves %s through repeated saves', (_name, markdown) => {
    const original = manager.parse(markdown)
    let current = original
    for (let save = 0; save < 3; save += 1) {
      current = manager.parse(manager.serialize(current))
      expect(current).toEqual(original)
    }
  })

  it('keeps literal block syntax and consecutive empty paragraphs', () => {
    const original: JSONContent = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '## Literal heading' }] },
        { type: 'paragraph', content: [] },
        { type: 'paragraph', content: [] },
        { type: 'paragraph', content: [{ type: 'text', text: '1. Literal list' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '| Literal table |' }] },
      ],
    }
    let current = original
    for (let save = 0; save < 3; save += 1) {
      current = manager.parse(manager.serialize(current))
      expect(current).toEqual(original)
    }
  })

  it.each(['a.', 'A)', 'aa.', 'IV.', 'iii)'])(
    'keeps a literal %s prefix as paragraph text',
    (marker) => {
      const original: JSONContent = {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: `${marker} Literal text` }] },
        ],
      }
      expect(manager.parse(manager.serialize(original))).toEqual(original)
    },
  )
})
