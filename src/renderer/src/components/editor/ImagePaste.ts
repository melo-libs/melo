import { Extension } from '@tiptap/core'
import { Fragment, Slice, type Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, Selection } from '@tiptap/pm/state'
import { dropPoint } from '@tiptap/pm/transform'
import type { EditorView } from '@tiptap/pm/view'
import { IpcChannels } from '@shared/types/ipc'
import { toast } from '../Toaster'
import i18n from '../../i18n'
import { hasProseMirrorSlice } from './clipboard'
import { appStore } from '../../store/appStore'
import { workspacePathAtom } from '../../store/workspace'

const imageFiles = (list: FileList | undefined | null): File[] =>
  Array.from(list ?? []).filter((file) => file.type.startsWith('image/'))

function hasEmbeddedImages(slice: Slice): boolean {
  let found = false
  slice.content.descendants((node) => {
    if (node.type.name === 'image' && /^data:image\//i.test(node.attrs.src as string)) found = true
    return !found
  })
  return found
}

async function saveImage(blob: Blob, workspaceRoot: string): Promise<string> {
  if (!blob.type.startsWith('image/') || blob.size > 20 * 1024 * 1024)
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

async function saveEmbeddedImages(slice: Slice, workspace: string): Promise<Slice> {
  const replace = async (fragment: Fragment): Promise<Fragment> => {
    const nodes: PMNode[] = []
    for (let index = 0; index < fragment.childCount; index++) {
      let node = fragment.child(index)
      if (node.type.name === 'image' && /^data:image\//i.test(node.attrs.src as string)) {
        const blob = await (await fetch(node.attrs.src as string)).blob()
        const src = await saveImage(blob, workspace)
        node = node.type.create({ ...node.attrs, src }, node.content, node.marks)
      } else if (node.childCount) {
        node = node.copy(await replace(node.content))
      }
      nodes.push(node)
    }
    return Fragment.fromArray(nodes)
  }
  return new Slice(await replace(slice.content), slice.openStart, slice.openEnd)
}

/** All image sources share the same asynchronous document/selection lock. */
async function importImages(
  view: EditorView,
  prepare: (workspace: string) => Promise<Slice>,
  dropPos?: number,
): Promise<void> {
  if (!view.editable) return
  const snapshot = view.state
  const workspace = appStore.get(workspacePathAtom)
  const document = view.dom.ownerDocument
  const focusedBefore = document.activeElement
  try {
    if (!workspace) throw new Error('No workspace open')
    const slice = await prepare(workspace)
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
    if (dropPos !== undefined && document.hasFocus() && document.activeElement === focusedBefore)
      view.focus()
  } catch {
    toast(i18n.t('editor.imageSaveFailed'))
  }
}

function importFiles(view: EditorView, files: File[], dropPos?: number): void {
  void importImages(
    view,
    async (workspace) => {
      const nodes: PMNode[] = []
      for (const file of files) {
        const src = await saveImage(file, workspace)
        nodes.push(view.state.schema.nodes.image.create({ src }))
      }
      return new Slice(Fragment.fromArray(nodes), 0, 0)
    },
    dropPos,
  )
}

export const ImagePaste = Extension.create({
  name: 'imagePaste',
  addProseMirrorPlugins() {
    let shiftDown = false
    return [
      new Plugin({
        key: new PluginKey('imagePaste'),
        props: {
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
            if (shiftDown || view.state.selection.$from.parent.type.spec.code) return false
            if (hasEmbeddedImages(slice)) {
              event.preventDefault()
              void importImages(view, (workspace) => saveEmbeddedImages(slice, workspace))
              return true
            }
            // A copied image can carry both HTML and a bitmap. Native Slice paste
            // has already restored the same-workspace asset; do not insert it twice.
            if (hasProseMirrorSlice(event.clipboardData?.getData('text/html') ?? '')) return false
            const files = imageFiles(event.clipboardData?.files)
            if (!files.length) return false
            event.preventDefault()
            importFiles(view, files)
            return true
          },
          handleDrop: (view, event, slice, moved) => {
            if (moved) return false
            const files = imageFiles(event.dataTransfer?.files)
            const embedded = hasEmbeddedImages(slice)
            if (!embedded && !files.length) return false
            const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })
            if (!pos) return false
            event.preventDefault()
            if (embedded) {
              void importImages(view, (workspace) => saveEmbeddedImages(slice, workspace), pos.pos)
            } else {
              importFiles(view, files, pos.pos)
            }
            return true
          },
        },
      }),
    ]
  },
})
