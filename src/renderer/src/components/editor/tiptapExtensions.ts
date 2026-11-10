import { StarterKit } from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { TableKit } from './table/TableNodeExtension'
import { BlockMath, InlineMath } from '@tiptap/extension-mathematics'
import { TaskList, TaskItem } from '@tiptap/extension-list'
import { Highlight } from '@tiptap/extension-highlight'
import { Image } from '@tiptap/extension-image'
import { Placeholder, Selection } from '@tiptap/extensions'
import { InputRule, type AnyExtension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
import { MeloCodeBlock, lowlight } from './CodeBlock'
import { imageNodeView } from './ImageNodeView'
import { MathShortcut } from './MathShortcut'
import { MarkdownInput } from './MarkdownInput'
import { ClipboardPaste } from './ClipboardPaste'
import { ParagraphMarkdown } from '@shared/serializers/paragraphMarkdown'
import { Wikilink } from './links/Wikilink'
import { LinkNavigation } from './links/LinkNavigation'
import { classifyDocumentHref } from '@shared/documentLinks'
import { SmoothCaret } from './SmoothCaret'
import { BlockShortcuts } from './BlockShortcuts'
import { EditorClipboard } from './EditorClipboard'

// Clicking a formula opens the equation editor (see MathEditor).
function emitMathEdit(node: unknown, pos: number, block: boolean) {
  const latex = (node as { attrs: { latex: string } }).attrs.latex
  window.dispatchEvent(
    new CustomEvent('melo:math-edit', { detail: { pos, latex, block, fresh: false } }),
  )
}

// Marks images that are their paragraph's sole child with .img-block —
// they present as figures (block + caption). CSS can't express this
// (:only-child is blind to text nodes and broken by ProseMirror's
// trailing-break hack node), so a decoration carries the class. Rebuilt
// only when the doc changes; mapped through everything else.
function imageBlockDecos(doc: PMNode): DecorationSet {
  const decos: Decoration[] = []
  doc.descendants((node, pos, parent) => {
    if (
      node.type.name === 'image' &&
      parent?.type.name === 'paragraph' &&
      parent.childCount === 1
    ) {
      decos.push(
        Decoration.node(pos, pos + node.nodeSize, { class: 'img-block' }, { meloImageBlock: true }),
      )
    }
    return node.isBlock
  })
  return DecorationSet.create(doc, decos)
}

// Standard inline math: a single $…$ wraps a formula (LaTeX / Obsidian
// convention). This replaces the extension's default $$…$$ inline rule, which
// would collide with our `$$` block shortcut. The content must be non-empty and
// not space-padded, so prose like "$5 to $10" never turns into a formula.
const InlineMathStd = InlineMath.extend({
  renderText: ({ node }) => `$${node.attrs.latex as string}$`,
  renderHTML: ({ node, HTMLAttributes }) => [
    'span',
    { ...HTMLAttributes, 'data-type': 'inline-math' },
    `$${node.attrs.latex as string}$`,
  ],
  addInputRules() {
    return [
      new InputRule({
        find: /(?<!\$)\$([^\s$][^$\n]*?[^\s$]|[^\s$])\$/,
        handler: ({ state, range, match }) => {
          const { tr } = state
          tr.replaceWith(range.from, range.to, this.type.create({ latex: match[1] }))
        },
      }),
    ]
  },
})

// Block math is entered via `$$` on an empty line (MathShortcut) or `/equation`,
// so drop the extension's $$$…$$$ rule — one convention, no surprises.
const BlockMathStd = BlockMath.extend({
  renderText: ({ node }) => `$$${node.attrs.latex as string}$$`,
  renderHTML: ({ node, HTMLAttributes }) => [
    'div',
    { ...HTMLAttributes, 'data-type': 'block-math' },
    `$$${node.attrs.latex as string}$$`,
  ],
  addInputRules() {
    return []
  },
})

/**
 * Editor extension set.
 *
 * StarterKit bundles and enables, by default: document/paragraph/
 * text, the bold/italic/strike/code/**underline** marks, link, headings,
 * blockquote, bullet/ordered lists + list item, horizontal rule, history.
 * So `toggleUnderline` / `toggleBold` / link etc. are available without
 * importing those extensions again (re-adding would warn about a dupe).
 *
 * We disable StarterKit's plain code block in favor of lowlight, and add
 * task lists, highlight, images, and a placeholder.
 */
export const editorExtensions: AnyExtension[] = [
  StarterKit.configure({
    codeBlock: false,
    // Replaced by ParagraphMarkdown (round-trip-safe serialization).
    paragraph: false,
    // Drop indicator in our accent (softened via .melo-dropcursor opacity),
    // not ProseMirror's default heavy black line.
    dropcursor: { color: 'var(--accent)', width: 1, class: 'melo-dropcursor' },
    // Ordinary clicks keep links editable; LinkNavigation owns explicit
    // navigation gestures and clicks in a read-only document.
    link: {
      openOnClick: false,
      isAllowedUri: (href) => classifyDocumentHref(href).kind !== 'unsupported',
    },
  }),
  // Keeps the selection visible (as a `.selection` decoration) while focus
  // is in the bubble's link input, so you can see what you're linking.
  Selection,
  LinkNavigation,
  ParagraphMarkdown,
  TaskList,
  TaskItem.extend({
    addInputRules() {
      return [
        ...(this.parent?.() ?? []),
        // "- [ ] " — the bullet rule fires on "- " first, so the "[ ]"
        // lands inside a fresh listItem where the stock task rule (plain
        // paragraphs only) never matches. Convert that list to a task
        // list: this is every Markdown user's muscle memory.
        new InputRule({
          find: /^\[([ xX])\]\s$/,
          handler: ({ state, range, match, chain }) => {
            if (state.selection.$from.node(-1)?.type.name !== 'listItem') return
            chain()
              .deleteRange(range)
              .toggleTaskList()
              .updateAttributes('taskItem', { checked: match[1].toLowerCase() === 'x' })
              .run()
          },
        }),
      ]
    },
  }).configure({ nested: true }),
  // Single-color highlight only: it round-trips as ==text== in Markdown.
  // Multicolor (and text color via TextStyle) had no Markdown representation
  // — the attrs were silently dropped on save, so the UI was lying.
  Highlight,
  Image.extend({
    renderText: ({ node }) => (node.attrs.alt as string | null) ?? '',
    addAttributes() {
      const parent = this.parent?.() ?? {}
      return {
        ...parent,
        src: {
          default: (parent as Record<string, { default?: unknown }>).src?.default ?? null,
          parseHTML: (el: HTMLElement) => {
            const raw = el.getAttribute('src') || ''
            return raw.startsWith('app://') ? raw.slice(6) : raw
          },
          renderHTML: (attrs: Record<string, unknown>) => {
            const src = attrs.src as string | undefined
            if (src && !/^[a-z][a-z0-9+.-]*:/i.test(src)) return { src: `app://${src}` }
            return { src }
          },
        },
      }
    },
    addNodeView() {
      return imageNodeView
    },
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: new PluginKey('imageBlockClass'),
          state: {
            init: (_, state) => imageBlockDecos(state.doc),
            apply: (tr, old) => (tr.docChanged ? imageBlockDecos(tr.doc) : old),
          },
          props: {
            decorations(state) {
              return this.getState(state)
            },
          },
        }),
      ]
    },
  }).configure({ inline: true, allowBase64: true }),
  MeloCodeBlock.configure({ lowlight, defaultLanguage: 'plaintext' }),
  TableKit.configure({
    table: { resizable: true },
    tableCell: {},
    tableHeader: {},
    tableRow: {},
  }),
  BlockMathStd.configure({ onClick: (node, pos) => emitMathEdit(node, pos, true) }),
  InlineMathStd.configure({ onClick: (node, pos) => emitMathEdit(node, pos, false) }),
  Placeholder.configure({ placeholder: "Type '/' for commands…" }),
  Markdown,
  EditorClipboard,
  MarkdownInput,
  ClipboardPaste,
  MathShortcut,
  Wikilink,
  SmoothCaret,
  BlockShortcuts,
]
