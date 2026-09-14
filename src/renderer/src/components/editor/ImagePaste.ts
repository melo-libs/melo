import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { IpcChannels } from '@shared/types/ipc'
import { toast } from '../Toaster'
import i18n from '../../i18n'

/* ============================================================
   ImagePaste — pasting or dropping image files saves them into the
   workspace (.assets/YYYY/MM/uuid.ext via InvokeSavePastedImage) and
   inserts image nodes with the relative path. Covers clipboard
   bitmaps (screenshots), copied image files, and OS drag-drop.
   Remote images inside pasted rich text stay remote URLs.
   ============================================================ */

const imageFiles = (list: FileList | undefined | null): File[] =>
  Array.from(list ?? []).filter((f) => f.type.startsWith('image/'))

async function saveAndInsert(view: EditorView, files: File[], dropPos?: number): Promise<void> {
  if (dropPos != null) {
    const tr = view.state.tr
    tr.setSelection(TextSelection.near(tr.doc.resolve(dropPos)))
    view.dispatch(tr)
  }
  for (const file of files) {
    try {
      const buffer = new Uint8Array(await file.arrayBuffer())
      const res = await window.api.invoke(IpcChannels.InvokeSavePastedImage, {
        imageBuffer: buffer,
        mimeType: file.type,
      })
      // isBase64 = no workspace open; the editor only exists inside one,
      // so treat it as a failure rather than embedding a data: URL.
      if (!res.success || !res.data || res.data.isBase64) {
        toast(i18n.t('editor.imageSaveFailed'))
        continue
      }
      // Re-read state per file so sequential inserts land in order.
      const node = view.state.schema.nodes.image.create({ src: res.data.filePath })
      view.dispatch(view.state.tr.replaceSelectionWith(node).scrollIntoView())
    } catch {
      toast(i18n.t('editor.imageSaveFailed'))
    }
  }
}

export const ImagePaste = Extension.create({
  name: 'imagePaste',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('imagePaste'),
        props: {
          handlePaste: (view, event) => {
            const files = imageFiles(event.clipboardData?.files)
            if (files.length === 0) return false
            event.preventDefault()
            void saveAndInsert(view, files)
            return true
          },
          handleDrop: (view, event, _slice, moved) => {
            // moved = a drag that started inside the editor (block drag);
            // that's ProseMirror's business, not ours.
            if (moved) return false
            const files = imageFiles(event.dataTransfer?.files)
            if (files.length === 0) return false
            event.preventDefault()
            const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })
            void saveAndInsert(view, files, pos?.pos ?? view.state.selection.from)
            return true
          },
        },
      }),
    ]
  },
})
