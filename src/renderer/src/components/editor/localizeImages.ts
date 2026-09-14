import type { Editor } from '@tiptap/react'
import { IpcChannels } from '@shared/types/ipc'
import { toast } from '../Toaster'
import i18n from '../../i18n'
import { appStore } from '../../store/appStore'
import { activeTabIdAtom } from '../../store/editor'

/* ============================================================
   Download every remote image in the document into .assets and
   rewrite the nodes to relative paths — the local-first repair
   for old clips that kept hotlinked URLs. All rewrites land in
   ONE transaction so undo is a single step; failures keep their
   remote URL.
   ============================================================ */

const isRemote = (src: unknown): src is string =>
  typeof src === 'string' && /^https?:\/\//i.test(src)

export async function downloadRemoteImages(editor: Editor): Promise<void> {
  // Read-only means limbo or a failed load — never rewrite those.
  if (!editor.isEditable) {
    toast(i18n.t('editor.openNoteFirst'))
    return
  }
  const tabAtStart = appStore.get(activeTabIdAtom)

  const urls = new Set<string>()
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'image' && isRemote(node.attrs.src)) urls.add(node.attrs.src)
  })
  if (urls.size === 0) {
    toast(i18n.t('editor.noRemoteImages'))
    return
  }
  toast(i18n.t('editor.downloadingImages', { count: urls.size }))

  const localized = new Map<string, string>()
  let failed = 0
  for (const url of urls) {
    const res = await window.api.invoke(IpcChannels.InvokeDownloadRemoteImage, { url })
    if (res.success && res.data) localized.set(url, res.data.filePath)
    else failed++
  }

  // The shared editor may show a different document by now — rewriting it
  // by URL match would edit the wrong note.
  if (appStore.get(activeTabIdAtom) !== tabAtStart || !editor.isEditable) {
    toast(i18n.t('editor.docChangedNothingRewritten'))
    return
  }

  if (localized.size > 0) {
    // Re-read the doc after the awaits — the user may have kept typing.
    const { state } = editor
    const tr = state.tr
    state.doc.descendants((node, pos) => {
      if (node.type.name === 'image') {
        const rel = localized.get(node.attrs.src as string)
        if (rel) tr.setNodeMarkup(pos, undefined, { ...node.attrs, src: rel })
      }
    })
    editor.view.dispatch(tr)
  }

  toast(
    failed === 0
      ? i18n.t('editor.imagesDownloaded', { count: localized.size })
      : i18n.t('editor.imagesPartial', { count: localized.size, failed }),
  )
}
