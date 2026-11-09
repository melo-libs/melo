import { Extension, getMarkAttributes, getMarkRange, isMacOS } from '@tiptap/core'
import { Plugin, type EditorState } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { openDocumentLink } from '../../../lib/documentLinks'

function navigationModifier(
  event: Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>,
): boolean {
  if (event.altKey || event.shiftKey) return false
  return isMacOS() ? event.metaKey && !event.ctrlKey : event.ctrlKey
}

export function selectedLinkHref(state: EditorState): string | null {
  const href = getMarkAttributes(state, 'link').href as string | undefined
  if (!href) return null
  const range = getMarkRange(state.selection.$from, state.schema.marks.link, { href })
  if (!range || state.selection.to > range.to) return null
  return href
}

export function handleDocumentLinkClick(
  view: Pick<EditorView, 'dom' | 'editable'>,
  event: MouseEvent,
): boolean {
  if (event.button !== 0 || event.shiftKey || event.altKey) return false
  const mac = isMacOS()
  if (mac && event.ctrlKey) return false
  if (view.editable && !navigationModifier(event)) return false
  const target = event.target as Element | null
  const link = target?.closest?.('a[href]')
  if (!link || !view.dom.contains(link) || link.classList.contains('wikilink')) return false
  event.preventDefault()
  void openDocumentLink(link.getAttribute('href') ?? '', view.dom)
  return true
}

export const LinkNavigation = Extension.create({
  name: 'linkNavigation',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        view: ({ dom }) => {
          const document = dom.ownerDocument
          const window = document.defaultView!
          const update = (event: KeyboardEvent | MouseEvent) => {
            dom.classList.toggle('melo-link-navigation', navigationModifier(event))
          }
          const reset = () => dom.classList.remove('melo-link-navigation')
          document.addEventListener('keydown', update)
          document.addEventListener('keyup', update)
          dom.addEventListener('mousemove', update)
          window.addEventListener('blur', reset)
          return {
            destroy: () => {
              document.removeEventListener('keydown', update)
              document.removeEventListener('keyup', update)
              dom.removeEventListener('mousemove', update)
              window.removeEventListener('blur', reset)
              reset()
            },
          }
        },
        // ProseMirror handleClick runs on mouseup. Cancel the actual click
        // default so a read-only anchor cannot also navigate on its own.
        props: { handleDOMEvents: { click: handleDocumentLinkClick } },
      }),
    ]
  },
})
