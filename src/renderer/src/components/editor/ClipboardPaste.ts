import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { importEmbeddedImages, importImageFiles } from './clipboardImageImport'
import { restoreClipboardImageSources } from './clipboardImages'
import { appStore } from '../../store/appStore'
import { workspacePathAtom } from '../../store/workspace'
import {
  chooseClipboardPaste,
  insertMarkdownDrop,
  insertMarkdownPaste,
  markdownSlice,
} from './clipboardPasteRules'

/** One format decision for paste/drop; native ProseMirror remains the HTML/Slice executor. */
export const ClipboardPaste = Extension.create({
  name: 'clipboardPaste',
  priority: 1000,
  addProseMirrorPlugins() {
    let shiftDown = false
    return [
      new Plugin({
        key: new PluginKey('clipboardPaste'),
        props: {
          transformPastedHTML: (html, view) =>
            restoreClipboardImageSources(
              html,
              appStore.get(workspacePathAtom) ?? '',
              view.dom.ownerDocument,
            ),
          handleDOMEvents: {
            keydown: (_view, event) => {
              shiftDown = event.shiftKey
              return false
            },
            keyup: (_view, event) => {
              shiftDown = event.shiftKey
              return false
            },
            blur: () => {
              shiftDown = false
              return false
            },
          },
          handlePaste: (view, event, slice) => {
            const data = event.clipboardData
            // ProseMirror's pasteHTML() supplies a parsed Slice without DataTransfer.
            const files = Array.from(data?.files ?? []).filter((file) =>
              file.type.startsWith('image/'),
            )
            const input = {
              html: data?.getData('text/html') ?? '',
              text: data?.getData('text/plain') ?? '',
              hasImageFiles: files.length > 0,
              plain: shiftDown,
              inCode: Boolean(view.state.selection.$from.parent.type.spec.code),
            }
            const action = chooseClipboardPaste(input, slice)
            if (action === 'native') return false
            if (action === 'markdown') {
              const parsed = markdownSlice(this.editor, input.text)
              if (!parsed) return false
              event.preventDefault()
              insertMarkdownPaste(view, parsed)
            } else {
              event.preventDefault()
              if (action === 'files') importImageFiles(view, files)
              else importEmbeddedImages(view, slice)
            }
            return true
          },
          handleDrop: (view, event, slice, moved) => {
            if (moved || !event.dataTransfer) return false
            const data = event.dataTransfer
            const files = Array.from(data.files).filter((file) => file.type.startsWith('image/'))
            const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })
            if (!pos) return false
            const input = {
              html: data.getData('text/html'),
              text: data.getData('text/plain'),
              hasImageFiles: files.length > 0,
              plain: false,
              inCode: Boolean(view.state.doc.resolve(pos.pos).parent.type.spec.code),
            }
            const action = chooseClipboardPaste(input, slice)
            if (action === 'native') return false
            if (action === 'markdown') {
              const parsed = markdownSlice(this.editor, input.text)
              if (!parsed) return false
              event.preventDefault()
              insertMarkdownDrop(view, parsed, pos.pos)
            } else {
              event.preventDefault()
              if (action === 'files') importImageFiles(view, files, pos.pos)
              else importEmbeddedImages(view, slice, pos.pos)
            }
            return true
          },
        },
      }),
    ]
  },
})
