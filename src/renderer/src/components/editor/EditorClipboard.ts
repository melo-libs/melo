import { Extension, type Editor } from '@tiptap/core'
import { IpcChannels } from '@shared/types/ipc'
import { NodeSelection, Plugin, TextSelection } from '@tiptap/pm/state'
import { Fragment, Slice } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'
import { appStore } from '../../store/appStore'
import { workspacePathAtom } from '../../store/workspace'
import { copyText } from '../../lib/clipboard'
import { toast } from '../Toaster'
import i18n from '../../i18n'
import { isSingleImageSlice, sliceToMarkdown, sliceToPlainText } from './clipboard'

export function canCopyEditorSelection(editor: Editor): boolean {
  if (editor.state.selection.empty) return false
  const { dom } = editor.view
  const document = dom.ownerDocument
  if (document.activeElement === dom) return true
  const active = document.activeElement
  if (
    active &&
    editor.state.selection instanceof NodeSelection &&
    !active.matches('input, textarea, [contenteditable="true"]') &&
    editor.view.nodeDOM(editor.state.selection.from)?.contains(active)
  )
    return true
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

function writeImageContent(dom: HTMLElement, text: string, singleImage: boolean) {
  const result = window.api.copyEditorClipboard({
    html: dom.innerHTML,
    text,
    singleImage,
    workspaceRoot: appStore.get(workspacePathAtom) ?? '',
  })
  if (!result.success || !result.data) throw new Error(result.error || 'Could not copy')
  return result.data
}

export function copyImageNode(editor: Editor, pos: number): void {
  const node = editor.state.doc.nodeAt(pos)
  if (node?.type.name !== 'image') return
  const slice = new Slice(Fragment.from(node), 0, 0)
  const { dom } = editor.view.serializeForClipboard(slice)
  try {
    const result = writeImageContent(dom, sliceToPlainText(slice), true)
    if (result.bitmap !== 'pending')
      toast(
        i18n.t(
          result.fallbackImages
            ? 'editor.imagesCopiedAsReferences'
            : result.bitmap === 'unavailable'
              ? 'editor.imageBitmapUnavailable'
              : 'editor.imageCopied',
        ),
      )
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
      const slice = view.state.selection.content()
      let containsImage = false
      slice.content.descendants((node) => {
        if (node.type.name === 'image') containsImage = true
        return !containsImage
      })
      if (!containsImage) return false
      const { dom, text } = view.serializeForClipboard(slice)
      // Keep clipboardData empty: Chromium would otherwise commit a second
      // payload after this event and overwrite the main-process bitmap.
      event.preventDefault()
      try {
        const result = writeImageContent(dom, text, isSingleImageSlice(slice))
        // The synchronous reply confirms the full payload (or its reference
        // fallback) was written. A failed write must never delete the source.
        if (cut)
          view.dispatch(view.state.tr.deleteSelection().scrollIntoView().setMeta('uiEvent', 'cut'))
        if (result.fallbackImages)
          toast(i18n.t(cut ? 'editor.imagesCutAsReferences' : 'editor.imagesCopiedAsReferences'))
        else if (result.bitmap === 'unavailable') toast(i18n.t('editor.imageBitmapUnavailable'))
      } catch {
        toast(i18n.t('editor.copyFailed'))
      }
      return true
    }
    return [
      new Plugin({
        view: () => {
          const off = window.api.on(IpcChannels.OnClipboardImageCopy, (status) => {
            const message =
              status === 'copying'
                ? 'editor.copyingImage'
                : status === 'copied'
                  ? 'editor.imageCopied'
                  : 'editor.imageBitmapUnavailable'
            toast(i18n.t(message))
          })
          return { destroy: off }
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
