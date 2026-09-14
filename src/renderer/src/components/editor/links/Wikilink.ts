import { InputRule, Node, mergeAttributes } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { cachedResolution, onResolutionsChanged, resolveTargets } from './resolve'

/**
 * Wikilink — inline atom node for [[Note]] / [[Note|alias]] links.
 * Note-level only (heading/block targets were rejected in architecture.md).
 *
 * Rendered as <a class="wikilink" data-note="…">⟦label⟧</a>; the hover peek,
 * navigation and styling hang off those classes (see WikilinkLayer).
 * Whether a target exists is runtime state owned by the resolution cache
 * and painted as a `wikilink-new` node decoration — never a doc attribute,
 * so resolution changes don't dirty the document.
 */
/** Characters the tokenizer can never read back from a target: brackets,
 *  pipe, '#' (heading targets rejected) and newlines. Collapsed to a space
 *  so serialize → parse is closed. Insert paths should sanitize too. */
export function sanitizeWikilinkTarget(target: string): string {
  return target
    .replace(/[\][#|\n]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export const Wikilink = Node.create({
  name: 'wikilink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      target: { default: '' },
      label: { default: null },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'a.wikilink[data-note]',
        getAttrs: (el) => {
          const a = el as HTMLElement
          const target = a.getAttribute('data-note') ?? ''
          // Prefer the explicit label attr; fall back to text minus brackets.
          const label =
            a.getAttribute('data-label') ?? a.textContent?.replace(/[⟦⟧]/g, '').trim() ?? null
          return { target, label: label || null }
        },
      },
    ]
  },

  renderHTML({ node }) {
    const label = (node.attrs.label as string | null) || (node.attrs.target as string)
    return [
      'a',
      mergeAttributes({
        class: 'wikilink',
        'data-note': node.attrs.target,
        'data-label': label,
        tabindex: '0',
      }),
      ['span', { class: 'wl-bracket' }, '⟦'],
      label,
      ['span', { class: 'wl-bracket' }, '⟧'],
    ]
  },

  parseMarkdown(token) {
    return {
      type: 'wikilink',
      attrs: { target: token.target as string, label: (token.label as string | null) ?? null },
    }
  },

  renderMarkdown(node) {
    const target = sanitizeWikilinkTarget((node.attrs?.target as string) ?? '')
    const rawLabel = (node.attrs?.label as string | null) ?? null
    // Labels tolerate '#' and '|' but not brackets/newlines.
    const label =
      rawLabel
        ?.replace(/[\][\n]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim() || null
    return label && label !== target ? `[[${target}|${label}]]` : `[[${target}]]`
  },

  addInputRules() {
    return [
      // Typing "[[" swaps to the link picker (same overlay as the slash
      // item). The brackets are consumed; the picker inserts the node.
      new InputRule({
        find: /\[\[$/,
        handler: ({ state, range }) => {
          if (state.doc.resolve(range.from).parent.type.spec.code) return null
          state.tr.delete(range.from, range.to)
          const editor = this.editor
          requestAnimationFrame(() => {
            const caret = editor.view.coordsAtPos(editor.state.selection.from)
            window.dispatchEvent(
              new CustomEvent('melo:linkpicker', {
                detail: { x: caret.left, y: caret.bottom + 6 },
              }),
            )
          })
          return undefined
        },
      }),
    ]
  },

  addProseMirrorPlugins() {
    return [
      // Paints unresolved links (wikilink-new) from the resolution cache.
      // Unknown targets are batched to the index; when results land, an
      // empty meta transaction recomputes decorations without touching
      // the doc (so no dirty/save cycle).
      new Plugin({
        key: new PluginKey('wikilinkResolution'),
        view: (view) => {
          const off = onResolutionsChanged(() => {
            view.dispatch(view.state.tr.setMeta('wikilinkResolve', true))
          })
          return { destroy: off }
        },
        props: {
          decorations: (state) => {
            const decos: Decoration[] = []
            const unknown: string[] = []
            state.doc.descendants((node, pos) => {
              if (node.type.name !== 'wikilink') return
              const r = cachedResolution(node.attrs.target as string)
              if (r === undefined) unknown.push(node.attrs.target as string)
              else if (r === null)
                decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'wikilink-new' }))
            })
            if (unknown.length) queueMicrotask(() => void resolveTargets(unknown))
            return DecorationSet.create(state.doc, decos)
          },
        },
      }),
    ]
  },

  markdownTokenizer: {
    name: 'wikilink',
    level: 'inline',
    start: (src: string) => src.indexOf('[['),
    tokenize: (src: string) => {
      // Note-level targets only ('#' excluded — heading links were rejected
      // in architecture.md). An empty or bracketed target stays plain text.
      const m = src.match(/^\[\[([^\][|#\n]+)(?:\|([^\][\n]+))?\]\]/)
      if (!m) return undefined
      const target = m[1].trim()
      if (!target) return undefined
      return { type: 'wikilink', raw: m[0], target, label: m[2]?.trim() || null }
    },
  },
})
