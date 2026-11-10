import type { NodeViewRenderer } from '@tiptap/core'
import i18n from '../../i18n'
import { createImageViewport } from './ImageViewport'
import { openImageView } from './ImageLightbox'

function isEditorKey(event: KeyboardEvent): boolean {
  return (
    ((event.metaKey || event.ctrlKey) &&
      ['a', 'c', 'x', 'v', 'z', 'y'].includes(event.key.toLowerCase())) ||
    ['Backspace', 'Delete'].includes(event.key)
  )
}

export const imageNodeView: NodeViewRenderer = ({ node, editor, getPos, decorations }) => {
  const dom = document.createElement('span')
  dom.className = 'img-wrap'
  const image = document.createElement('img')
  image.draggable = false
  const caption = document.createElement('span')
  caption.className = 'img-alt'
  caption.contentEditable = 'false'
  const preview = document.createElement('span')
  preview.className = 'image-viewport image-viewport-photo'
  preview.contentEditable = 'false'
  const status = document.createElement('span')
  status.className = 'image-viewport-status'
  status.setAttribute('role', 'status')
  let viewport: ReturnType<typeof createImageViewport> | null = null
  let loadedSource: string | null = null
  const select = () => {
    const pos = getPos()
    if (pos !== undefined) editor.commands.setNodeSelection(pos)
  }
  status.addEventListener('mousedown', (event) => {
    event.preventDefault()
    select()
    editor.view.focus()
  })
  image.addEventListener('dblclick', () => {
    if (!viewport && image.src) openImageView(image.src)
  })
  // Clipboard/edit shortcuts keep using the editor's existing image pipeline.
  dom.addEventListener('keydown', (event) => {
    if (isEditorKey(event)) editor.view.focus()
  })
  const sync = (current: typeof node, standalone: boolean) => {
    const source = (current.attrs.src as string | null) ?? ''
    const url = source && !/^[a-z][a-z0-9+.-]*:/i.test(source) ? `app://${source}` : source
    image.alt = (current.attrs.alt as string | null) ?? ''
    const dimensions = image.getAttribute('width') + ':' + image.getAttribute('height')
    for (const attr of ['title', 'width', 'height'] as const) {
      const value = current.attrs[attr] as string | number | null
      if (value != null && value !== '') image.setAttribute(attr, String(value))
      else image.removeAttribute(attr)
    }
    caption.textContent = image.alt
    const resized = dimensions !== image.getAttribute('width') + ':' + image.getAttribute('height')
    if (standalone) {
      if (!viewport) {
        preview.replaceChildren(status)
        dom.replaceChildren(preview, caption)
        viewport = createImageViewport(preview, image, status, select, 'natural')
        loadedSource = null
      }
      viewport.labels()
      if (url !== loadedSource) {
        loadedSource = url
        viewport.hide()
        status.hidden = false
        status.textContent = i18n.t(url ? 'imageViewport.loading' : 'imageViewport.invalid')
        if (url) viewport.show(url)
      } else if (resized) viewport.resize()
    } else {
      viewport?.destroy()
      viewport = null
      loadedSource = null
      image.hidden = false
      image.style.removeProperty('transform')
      image.style.removeProperty('width')
      image.style.removeProperty('height')
      if (image.getAttribute('src') !== url) image.src = url
      dom.replaceChildren(image, caption)
    }
  }
  sync(
    node,
    decorations.some((decoration) => decoration.spec.meloImageBlock),
  )
  const translate = () => viewport?.labels()
  i18n.on('languageChanged', translate)
  return {
    dom,
    update(current, nextDecorations) {
      if (current.type !== node.type) return false
      sync(
        current,
        nextDecorations.some((decoration) => decoration.spec.meloImageBlock),
      )
      return true
    },
    stopEvent(event) {
      if (['copy', 'cut', 'paste'].includes(event.type)) return false
      if (event.type === 'keydown' && isEditorKey(event as KeyboardEvent)) return false
      return viewport !== null && preview.contains(event.target as globalThis.Node)
    },
    ignoreMutation: (mutation) => mutation.type !== 'selection',
    destroy() {
      viewport?.destroy()
      i18n.off('languageChanged', translate)
    },
  }
}
