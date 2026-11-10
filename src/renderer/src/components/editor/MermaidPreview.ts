import type { Editor } from '@tiptap/core'
import { MAX_CLIPBOARD_IMAGE_BYTES, MAX_CLIPBOARD_IMAGE_PIXELS } from '@shared/clipboard'
import i18n from '../../i18n'
import { copyText } from '../../lib/clipboard'
import { appStore } from '../../store/appStore'
import { workspacePathAtom } from '../../store/workspace'
import { toast } from '../Toaster'
import { renderMermaid } from './mermaid'
import { createImageViewport } from './ImageViewport'

/** View-only controls: the editable code remains the code block's contentDOM. */
export function createMermaidPreview(
  dom: HTMLElement,
  chrome: HTMLElement,
  editor: Editor,
  getPos: () => number | undefined,
) {
  const preview = document.createElement('span')
  preview.className = 'mermaid-preview image-viewport'
  preview.contentEditable = 'false'
  const image = document.createElement('img')
  image.draggable = false
  const status = document.createElement('span')
  status.className = 'mermaid-status'
  status.setAttribute('role', 'status')
  preview.append(image, status)
  const viewport = createImageViewport(
    preview,
    image,
    status,
    () => {
      const pos = getPos()
      if (pos !== undefined) editor.commands.setNodeSelection(pos)
    },
    'bounded',
  )
  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.className = 'mermaid-toggle'
  toggle.addEventListener('mousedown', (event) => event.preventDefault())
  const copy = document.createElement('button')
  copy.type = 'button'
  copy.className = 'mermaid-copy'
  const copyIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  copyIcon.setAttribute('viewBox', '0 0 18 18')
  copyIcon.setAttribute('width', '14')
  copyIcon.setAttribute('height', '14')
  copyIcon.setAttribute('fill', 'none')
  copyIcon.setAttribute('stroke', 'currentColor')
  copyIcon.setAttribute('stroke-width', '1.3')
  copyIcon.setAttribute('aria-hidden', 'true')
  const copyLabel = document.createElement('span')
  copy.append(copyIcon, copyLabel)
  copy.addEventListener('mousedown', (event) => event.preventDefault())
  copy.addEventListener('click', async () => {
    const asCode = editing
    try {
      if (asCode) {
        if (!(await copyText(source))) throw new Error('Could not copy code')
      } else {
        // Copy the full rendered diagram; viewport transforms never affect its pixels.
        const width = image.naturalWidth
        const height = image.naturalHeight
        if (!width || !height || width * height > MAX_CLIPBOARD_IMAGE_PIXELS)
          throw new Error('Diagram is too large to copy')
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const context = canvas.getContext('2d')!
        context.fillStyle = getComputedStyle(preview).getPropertyValue('--paper').trim()
        context.fillRect(0, 0, width, height)
        context.drawImage(image, 0, 0, width, height)
        const png = canvas.toDataURL('image/png')
        if (png.length > Math.ceil(MAX_CLIPBOARD_IMAGE_BYTES / 3) * 4 + 22)
          throw new Error('Diagram is too large to copy')
        const copiedImage = document.createElement('img')
        copiedImage.src = png
        copiedImage.alt = image.alt
        const result = window.api.copyEditorClipboard({
          html: copiedImage.outerHTML,
          text: image.alt,
          workspaceRoot: appStore.get(workspacePathAtom) ?? '',
          singleImage: true,
        })
        if (!result.success || result.data?.bitmap !== 'ready')
          throw new Error('Could not copy diagram image')
      }
      toast(i18n.t(asCode ? 'editor.codeCopied' : 'editor.imageCopied'))
    } catch {
      toast(i18n.t('editor.copyFailed'))
    }
  })
  chrome.prepend(toggle, copy)
  dom.append(preview)
  dom.classList.add('has-mermaid')
  let source = ''
  let editing = false
  let revision = 0
  let destroyed = false

  const refresh = () => {
    const version = ++revision
    dom.classList.toggle('mermaid-source', editing)
    dom.classList.toggle('mermaid-rendered', !editing)
    toggle.textContent = i18n.t(editing ? 'mermaid.preview' : 'mermaid.edit')
    toggle.setAttribute('aria-label', toggle.textContent)
    toggle.disabled = !editing && !editor.isEditable
    copyLabel.textContent = i18n.t(editing ? 'editor.copyCode' : 'editor.copyImage')
    copy.title = i18n.t(editing ? 'mermaid.copyCodeHint' : 'mermaid.copyImageHint')
    copy.disabled = !editing
    copyIcon.innerHTML = editing
      ? '<rect x="3" y="5" width="9" height="10" rx="1"/><path d="M5.5 5V3.5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H12"/>'
      : '<rect x="2.5" y="2.5" width="13" height="13" rx="2"/><circle cx="6.5" cy="6.5" r="1.5"/><path d="m3 13 4-4 3 3 2-2 3 3"/>'
    image.alt = i18n.t('mermaid.diagram')
    viewport.labels()
    viewport.hide()
    if (editing) return
    image.hidden = true
    status.hidden = false
    status.textContent = i18n.t(source.trim() ? 'mermaid.loading' : 'mermaid.empty')
    status.removeAttribute('title')
    preview.classList.remove('has-error')
    if (!source.trim()) return
    const dark = document.documentElement.dataset.theme === 'dark'
    void renderMermaid(source, dark).then(
      async (url) => {
        if (destroyed || version !== revision) return
        const ready = await viewport.show(url)
        if (!destroyed && version === revision) copy.disabled = !ready
      },
      (error: unknown) => {
        if (destroyed || version !== revision) return
        preview.classList.add('has-error')
        status.textContent = i18n.t('mermaid.invalid')
        status.title = error instanceof Error ? error.message : String(error)
      },
    )
  }
  toggle.addEventListener('click', () => {
    const pos = getPos()
    if (pos === undefined) return
    editing = !editing
    refresh()
    if (editing) editor.commands.focus(pos + 1)
    else {
      editor.commands.setNodeSelection(pos)
      editor.view.focus()
    }
  })
  const onSelection = () => {
    const { selection } = editor.state
    if (
      !editing &&
      editor.isFocused &&
      editor.isEditable &&
      selection.empty &&
      selection.$from.parent.type.name === 'codeBlock' &&
      selection.$from.before() === getPos()
    ) {
      editing = true
      refresh()
    }
  }
  const themeObserver = new MutationObserver(() => refresh())
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  })
  editor.on('selectionUpdate', onSelection)
  editor.on('focus', onSelection)
  // A document swap can preserve the numeric caret position without emitting
  // selectionUpdate. Reveal its source before keyboard input reaches hidden code.
  editor.view.dom.addEventListener('keydown', onSelection)
  editor.view.dom.addEventListener('beforeinput', onSelection)
  editor.on('transaction', onEditableChange)
  function onEditableChange() {
    toggle.disabled = !editing && !editor.isEditable
  }
  i18n.on('languageChanged', refresh)
  return {
    update(text: string) {
      if (text === source && dom.classList.contains('mermaid-rendered')) return
      const initial = source === ''
      source = text
      if (initial && !source.trim() && editor.isEditable) editing = true
      refresh()
    },
    stopEvent(event: Event) {
      const target = event.target as Node
      return preview.contains(target) || toggle.contains(target) || copy.contains(target)
    },
    destroy() {
      destroyed = true
      themeObserver.disconnect()
      editor.off('selectionUpdate', onSelection)
      editor.off('focus', onSelection)
      editor.view.dom.removeEventListener('keydown', onSelection)
      editor.view.dom.removeEventListener('beforeinput', onSelection)
      editor.off('transaction', onEditableChange)
      i18n.off('languageChanged', refresh)
      viewport.destroy()
      preview.remove()
      toggle.remove()
      copy.remove()
      dom.classList.remove('has-mermaid', 'mermaid-source', 'mermaid-rendered')
    },
  }
}
