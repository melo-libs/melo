import { Fragment, Slice, type Node as PMNode } from '@tiptap/pm/model'
import { Selection } from '@tiptap/pm/state'
import { dropPoint } from '@tiptap/pm/transform'
import type { EditorView } from '@tiptap/pm/view'
import { IpcChannels } from '@shared/types/ipc'
import { toast } from '../Toaster'
import i18n from '../../i18n'
import { appStore } from '../../store/appStore'
import { workspacePathAtom } from '../../store/workspace'
import { MAX_CLIPBOARD_IMAGE_BYTES } from '@shared/clipboard'

type ImageImportResult = { slice: Slice; failedImages: number }

function imagePlaceholder(
  schema: PMNode['type']['schema'],
  label: string,
  marks: PMNode['marks'] = [],
) {
  const message = i18n.t('editor.imageUnavailable')
  return schema.text(`[${message}${label ? `: ${label}` : ''}]`, marks)
}

async function saveImage(blob: Blob, workspaceRoot: string): Promise<string> {
  if (!blob.type.startsWith('image/') || blob.size > MAX_CLIPBOARD_IMAGE_BYTES)
    throw new Error('Invalid clipboard image')
  const result = await window.api.invoke(IpcChannels.InvokeSavePastedImage, {
    imageBuffer: new Uint8Array(await blob.arrayBuffer()),
    mimeType: blob.type,
    workspaceRoot,
  })
  if (!result.success || !result.data || result.data.isBase64)
    throw new Error('Could not save clipboard image')
  return result.data.filePath
}

async function saveEmbeddedImages(slice: Slice, workspace: string): Promise<ImageImportResult> {
  let failedImages = 0
  const replace = async (fragment: Fragment): Promise<Fragment> => {
    const nodes: PMNode[] = []
    for (let index = 0; index < fragment.childCount; index++) {
      let node = fragment.child(index)
      if (node.type.name === 'image' && /^data:image\//i.test(node.attrs.src as string)) {
        try {
          const blob = await (await fetch(node.attrs.src as string)).blob()
          const src = await saveImage(blob, workspace)
          node = node.type.create({ ...node.attrs, src }, node.content, node.marks)
        } catch {
          failedImages++
          node = imagePlaceholder(
            node.type.schema,
            (node.attrs.alt as string | null) ?? '',
            node.marks,
          )
        }
      } else if (node.childCount) {
        node = node.copy(await replace(node.content))
      }
      nodes.push(node)
    }
    return Fragment.fromArray(nodes)
  }
  return {
    slice: new Slice(await replace(slice.content), slice.openStart, slice.openEnd),
    failedImages,
  }
}

/** All image sources share the same asynchronous document/selection lock. */
async function importImages(
  view: EditorView,
  prepare: (workspace: string) => Promise<ImageImportResult>,
  dropPos?: number,
): Promise<void> {
  if (!view.editable) return
  const snapshot = view.state
  const workspace = appStore.get(workspacePathAtom)
  const document = view.dom.ownerDocument
  const focusedBefore = document.activeElement
  try {
    if (!workspace) throw new Error('No workspace open')
    const { slice, failedImages } = await prepare(workspace)
    if (
      view.isDestroyed ||
      !view.editable ||
      appStore.get(workspacePathAtom) !== workspace ||
      view.state.doc !== snapshot.doc ||
      !view.state.selection.eq(snapshot.selection)
    ) {
      toast(i18n.t('editor.imagePasteCancelled'))
      return
    }
    const tr = view.state.tr
    if (dropPos !== undefined) {
      const pos = dropPoint(tr.doc, dropPos, slice) ?? dropPos
      tr.replaceRange(pos, pos, slice)
      tr.setSelection(Selection.near(tr.doc.resolve(tr.mapping.map(pos, 1)), -1))
      tr.setMeta('uiEvent', 'drop')
    } else {
      const single = slice.openStart === 0 && slice.openEnd === 0 && slice.content.childCount === 1
      if (single) tr.replaceSelectionWith(slice.content.firstChild!, false)
      else tr.replaceSelection(slice)
      tr.setMeta('paste', true).setMeta('uiEvent', 'paste')
    }
    view.dispatch(tr.scrollIntoView())
    if (failedImages) toast(i18n.t('editor.imagesPartiallyImported'))
    if (dropPos !== undefined && document.hasFocus() && document.activeElement === focusedBefore)
      view.focus()
  } catch {
    toast(i18n.t('editor.imageSaveFailed'))
  }
}

export function importImageFiles(view: EditorView, files: File[], dropPos?: number): void {
  void importImages(
    view,
    async (workspace) => {
      const nodes: PMNode[] = []
      let failedImages = 0
      for (const file of files) {
        try {
          const src = await saveImage(file, workspace)
          nodes.push(view.state.schema.nodes.image.create({ src }))
        } catch {
          failedImages++
          nodes.push(imagePlaceholder(view.state.schema, file.name))
        }
      }
      return { slice: new Slice(Fragment.fromArray(nodes), 0, 0), failedImages }
    },
    dropPos,
  )
}

export function importEmbeddedImages(view: EditorView, slice: Slice, dropPos?: number): void {
  void importImages(view, (workspace) => saveEmbeddedImages(slice, workspace), dropPos)
}
