import { Editor } from '@tiptap/core'
import { StarterKit } from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { TaskList, TaskItem } from '@tiptap/extension-list'
import { Highlight } from '@tiptap/extension-highlight'
import { Image } from '@tiptap/extension-image'
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight'
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table'
import { Mathematics } from '@tiptap/extension-mathematics'
import { createLowlight, common } from 'lowlight'
import katex from 'katex'
import { Wikilink } from '../editor/links/Wikilink'
import { termRanges } from './searchEngine'

/* ============================================================
   Preview renderer — a headless Tiptap editor that shares the
   exact same extension set as the writing surface (minus the
   interactive bits: slash command, placeholder, drag handle,
   ToC). Markdown goes in, rendered HTML comes out, with search-
   term highlighting injected via DOM walking afterward.

   Math nodes (inline/block) are post-processed with KaTeX
   since the headless editor doesn't run NodeViews.
   ============================================================ */

const lowlight = createLowlight(common)

const previewExtensions = [
  StarterKit.configure({ codeBlock: false, dropcursor: false }),
  Markdown,
  TaskList,
  TaskItem.configure({ nested: true }),
  Highlight,
  Image,
  CodeBlockLowlight.configure({ lowlight, defaultLanguage: 'plaintext' }),
  Table,
  TableRow,
  TableCell,
  TableHeader,
  Mathematics,
  Wikilink,
]

let _editor: Editor | null = null
function getEditor(): Editor {
  if (!_editor) {
    _editor = new Editor({ extensions: previewExtensions, content: '' })
  }
  return _editor
}

function mergeRanges(ranges: [number, number][]): [number, number][] {
  const out: [number, number][] = []
  for (const [a, b] of ranges) {
    const last = out[out.length - 1]
    if (last && a <= last[1]) last[1] = Math.max(last[1], b)
    else out.push([a, b])
  }
  return out
}

function highlightTerms(root: HTMLElement, terms: string[]) {
  const wanted = terms.filter(Boolean)
  if (!wanted.length) return
  const doc = root.ownerDocument
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  let n: Node | null
  while ((n = walker.nextNode())) nodes.push(n as Text)
  for (const node of nodes) {
    const ranges = mergeRanges(termRanges(node.data.toLowerCase(), wanted))
    if (!ranges.length) continue
    const frag = doc.createDocumentFragment()
    let cursor = 0
    for (const [a, b] of ranges) {
      if (a > cursor) frag.append(node.data.slice(cursor, a))
      const mark = doc.createElement('mark')
      mark.className = 'hi'
      mark.textContent = node.data.slice(a, b)
      frag.append(mark)
      cursor = b
    }
    if (cursor < node.data.length) frag.append(node.data.slice(cursor))
    node.replaceWith(frag)
  }
}

function renderMathNodes(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>('[data-type="inline-math"]').forEach((el) => {
    const latex = el.getAttribute('data-latex') ?? ''
    try {
      el.innerHTML = katex.renderToString(latex, { throwOnError: false })
    } catch {
      el.textContent = latex
    }
  })
  root.querySelectorAll<HTMLElement>('[data-type="block-math"]').forEach((el) => {
    const latex = el.getAttribute('data-latex') ?? ''
    try {
      el.innerHTML = katex.renderToString(latex, { throwOnError: false, displayMode: true })
    } catch {
      el.textContent = latex
    }
  })
}

// marked won't parse **text**nonspace as bold — insert a space after the
// closing delimiter so the roundtrip (html→md→html) stays faithful.
function fixInlineDelimiters(md: string): string {
  return md
    .replace(/(\*\*[^*\n]+\*\*)(?=[A-Za-z0-9一-鿿])/g, '$1 ')
    .replace(/(__[^_\n]+__)(?=[A-Za-z0-9一-鿿])/g, '$1 ')
}

export function renderPreviewHtml(md: string, terms: string[]): string {
  const editor = getEditor()
  editor.commands.setContent(fixInlineDelimiters(md), { contentType: 'markdown' })
  const html = editor.getHTML()
  const doc = new DOMParser().parseFromString(html, 'text/html')
  renderMathNodes(doc.body)
  doc.body.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((a) => {
    a.removeAttribute('href')
    a.setAttribute('tabindex', '-1')
  })
  highlightTerms(doc.body, terms)
  return doc.body.innerHTML
}
