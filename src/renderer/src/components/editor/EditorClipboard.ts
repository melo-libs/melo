import { Extension, type Editor } from '@tiptap/core'
import { Plugin, TextSelection } from '@tiptap/pm/state'
import { Fragment, Slice } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'
import { appStore } from '../../store/appStore'
import { workspacePathAtom } from '../../store/workspace'
import { clipboardWriteGuard, copyText } from '../../lib/clipboard'
import { toast } from '../Toaster'
import i18n from '../../i18n'
import { isSingleImageSlice, sliceToMarkdown, sliceToPlainText } from './clipboard'
import { writeImageClipboard } from './clipboardImages'

export function canCopyEditorSelection(editor: Editor): boolean {
  if (editor.state.selection.empty) return false
  const { dom } = editor.view
  const document = dom.ownerDocument
  if (document.activeElement === dom) return true
  const selection = document.getSelection()
  // A read-only editor's selection can be active while focus stays on <body>.
  return Boolean(
    document.activeElement === document.body &&
      selection?.anchorNode &&
      dom.contains(selection.anchorNode) &&
      selection.focusNode &&
      dom.contains(selection.focusNode),
  )
}

export async function copySelectionAsMarkdown(editor: Editor): Promise<void> {
  if (!canCopyEditorSelection(editor)) return
  try {
    const markdown = sliceToMarkdown(
      editor.storage.markdown.manager,
      editor.state.selection.content(),
    )
    if (markdown === null) return
    const copied = await copyText(markdown)
    toast(i18n.t(copied ? 'blocks.copied' : 'editor.copyFailed'))
  } catch {
    toast(i18n.t('editor.copyFailed'))
  }
}

export async function copyImageNode(editor: Editor, pos: number): Promise<void> {
  const node = editor.state.doc.nodeAt(pos)
  if (node?.type.name !== 'image') return
  const slice = new Slice(Fragment.from(node), 0, 0)
  const { dom } = editor.view.serializeForClipboard(slice)
  try {
    const copied = await writeImageClipboard(
      dom,
      sliceToPlainText(slice),
      appStore.get(workspacePathAtom) ?? '',
      true,
    )
    if (copied) toast(i18n.t('editor.imageCopied'))
  } catch {
    toast(i18n.t('editor.copyFailed'))
  }
}

export const EditorClipboard = Extension.create({
  name: 'editorClipboard',
  priority: 1100,
  addProseMirrorPlugins() {
    const copyImages = (view: EditorView, event: ClipboardEvent, cut: boolean): boolean => {
      if (view.state.selection.empty || (cut && !view.editable)) return false
      const snapshot = view.state
      const slice = snapshot.selection.content()
      let containsImage = false
      slice.content.descendants((node) => {
        if (node.type.name === 'image') containsImage = true
        return !containsImage
      })
      if (!containsImage) return false
      const { dom, text } = view.serializeForClipboard(slice)
      event.preventDefault()
      const single = isSingleImageSlice(slice)
      void writeImageClipboard(dom, text, appStore.get(workspacePathAtom) ?? '', single)
        .then((copied) => {
          if (copied && cut) {
            if (
              !view.editable ||
              view.state.doc !== snapshot.doc ||
              !view.state.selection.eq(snapshot.selection)
            ) {
              toast(i18n.t('editor.copiedWithoutCutting'))
              return
            }
            view.dispatch(
              view.state.tr.deleteSelection().scrollIntoView().setMeta('uiEvent', 'cut'),
            )
          }
        })
        .catch(() => toast(i18n.t('editor.copyFailed')))
      return true
    }
    return [
      new Plugin({
        view: (view) => {
          const invalidate = () => {
            clipboardWriteGuard()
          }
          const document = view.dom.ownerDocument
          document.addEventListener('copy', invalidate, true)
          document.addEventListener('cut', invalidate, true)
          return {
            destroy: () => {
              document.removeEventListener('copy', invalidate, true)
              document.removeEventListener('cut', invalidate, true)
            },
          }
        },
        props: {
          clipboardTextSerializer: (slice, view) =>
            sliceToPlainText(
              slice,
              view.state.selection instanceof TextSelection
                ? view.state.selection.$from
                : undefined,
            ),
          handleDOMEvents: {
            copy: (view, event) => copyImages(view, event, false),
            cut: (view, event) => copyImages(view, event, true),
          },
        },
      }),
    ]
  },
})
