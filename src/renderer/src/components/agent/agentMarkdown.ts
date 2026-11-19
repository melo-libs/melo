import { Extension } from '@tiptap/core'
import { MarkdownManager } from '@tiptap/markdown'
import { StarterKit } from '@tiptap/starter-kit'
import { Highlight } from '@tiptap/extension-highlight'
import { Image } from '@tiptap/extension-image'
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table'
import { TaskList, TaskItem } from '@tiptap/extension-list'
import { Marked, type marked } from 'marked'

// Model prose often closes bold after punctuation or a stray space. Keep this
// tolerance in chat; document parsing and escaped/code examples stay unchanged.
const ChatStrong = Extension.create({
  name: 'chatStrong',
  markdownTokenName: 'strong',
  parseMarkdown: (token, helpers) =>
    helpers.applyMark('bold', helpers.parseInline(token.tokens ?? [])),
  markdownTokenizer: {
    name: 'strong',
    level: 'inline',
    start: (source) => source.indexOf('**'),
    tokenize(source, _, helpers) {
      if (!/^\*\*[^\s*]/u.test(source)) return
      for (let index = 2; index < source.length; index++) {
        if (source[index] === '\\') {
          index++
          continue
        }
        if (source[index] === '`') {
          const delimiter = /^`+/.exec(source.slice(index))![0]
          let end = source.indexOf(delimiter, index + delimiter.length)
          while (end >= 0 && (source[end - 1] === '`' || source[end + delimiter.length] === '`'))
            end = source.indexOf(delimiter, end + delimiter.length)
          if (end >= 0) index = end + delimiter.length - 1
          else index += delimiter.length - 1
          continue
        }
        if (source.startsWith('\n\n', index)) return
        if (!source.startsWith('**', index)) continue
        // Leave triple delimiters and their nested emphasis to the standard parser.
        if (source[index - 1] === '*' || source[index + 2] === '*') return
        const text = source.slice(2, index)
        return {
          type: 'strong',
          raw: source.slice(0, index + 2),
          text,
          tokens: helpers.inlineTokens(text),
        }
      }
      return undefined
    },
  },
})

const extensions = [
  StarterKit,
  Highlight,
  // Markdown images are supported; raw model-provided HTML is never activated.
  Image.extend({ parseHTML: () => [] }).configure({ inline: true }),
  Table,
  TableRow,
  TableCell,
  TableHeader,
  TaskList,
  TaskItem,
]

// Tiptap types this option as the callable singleton, but uses its parser methods.
// Separate instances prevent chat tolerance/options from changing the document editor.
export const agentMarkdown = new MarkdownManager({
  marked: new Marked() as unknown as typeof marked,
  extensions: [...extensions, ChatStrong],
})
export const userMarkdown = new MarkdownManager({
  marked: new Marked() as unknown as typeof marked,
  extensions,
  markedOptions: { breaks: true },
})
