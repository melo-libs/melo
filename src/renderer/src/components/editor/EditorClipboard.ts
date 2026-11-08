import { Extension, type Editor } from '@tiptap/core'
import { CLIPBOARD_COPY_ID_ATTRIBUTE } from '@shared/clipboard'
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
    const result = await writeImageClipboard(
      dom,
      sliceToPlainText(slice),
      appStore.get(workspacePathAtom) ?? '',
      { type: 'image' },
    )
    if (result.copied) toast(i18n.t('editor.imageCopied'))
  } catch {
    toast(i18n.t('editor.copyFailed'))
  }
}

export const EditorClipboard = Extension.create({
  name: 'editorClipboard',
  priority: 1100,
  addProseMirrorPlugins() {
    const copyImages = (view: EditorView, event: ClipboardEvent, cut: boolean): boolean => {
      if (view.state.selection.empty || (cut && !view.editable) || !event.clipboardData)
        return false
      const slice = view.state.selection.content()
      let containsImage = false
      slice.content.descendants((node) => {
        if (node.type.name === 'image') containsImage = true
        return !containsImage
      })
      if (!containsImage) return false
      const { dom, text } = view.serializeForClipboard(slice)
      const copyId = crypto.randomUUID()
      dom.firstElementChild!.setAttribute(CLIPBOARD_COPY_ID_ATTRIBUTE, copyId)
      // Copy the full Slice immediately; image embedding is an optional upgrade.
      // A failed image must never leave yesterday's text on the clipboard.
      event.clipboardData.setData('text/plain', text)
      event.clipboardData.setData('text/html', dom.innerHTML)
      event.preventDefault()
      const single = isSingleImageSlice(slice)
      const workspace = appStore.get(workspacePathAtom) ?? ''
      // Match native cut timing once the full Slice is on clipboardData. Waiting
      // for optional image embedding turns an immediate cut/paste into a copy.
      if (cut)
        view.dispatch(view.state.tr.deleteSelection().scrollIntoView().setMeta('uiEvent', 'cut'))
      const fallbackMessage = cut
        ? 'editor.imagesCutAsReferences'
        : 'editor.imagesCopiedAsReferences'
      void writeImageClipboard(dom, text, workspace, {
        type: 'selection',
        singleImage: single,
        copyId,
      })
        .then(({ fallbackImages }) => {
          if (fallbackImages) toast(i18n.t(fallbackMessage))
        })
        .catch(() => toast(i18n.t(fallbackMessage)))
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
