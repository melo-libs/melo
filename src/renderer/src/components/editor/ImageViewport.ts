import i18n from '../../i18n'
import { openImageView } from './ImageLightbox'
import './image-viewport.scss'

export interface ImageTransform {
  scale: number
  x: number
  y: number
}

export function imageDisplaySize(
  image: Pick<HTMLImageElement, 'naturalWidth' | 'naturalHeight' | 'getAttribute'>,
) {
  const width = Number(image.getAttribute('width'))
  const height = Number(image.getAttribute('height'))
  const hasWidth = Number.isFinite(width) && width > 0
  const hasHeight = Number.isFinite(height) && height > 0
  return {
    width: hasWidth
      ? width
      : hasHeight
        ? (image.naturalWidth * height) / image.naturalHeight
        : image.naturalWidth,
    height: hasHeight
      ? height
      : hasWidth
        ? (image.naturalHeight * width) / image.naturalWidth
        : image.naturalHeight,
  }
}

/** Keep the diagram point beneath the cursor stationary while zooming. */
export function zoomImage(
  view: ImageTransform,
  point: { x: number; y: number },
  factor: number,
  minimum: number,
): ImageTransform {
  const scale = Math.min(8, Math.max(minimum, view.scale * factor))
  return {
    scale,
    x: point.x - ((point.x - view.x) * scale) / view.scale,
    y: point.y - ((point.y - view.y) * scale) / view.scale,
  }
}

/** View transforms never enter the ProseMirror document or exported Markdown. */
export function createImageViewport(
  preview: HTMLElement,
  image: HTMLImageElement,
  status: HTMLElement,
  onSelect: () => void,
  sizing: 'bounded' | 'natural',
) {
  const canvas = document.createElement('span')
  canvas.className = 'image-viewport-canvas'
  canvas.tabIndex = 0
  canvas.setAttribute('role', 'group')
  const controls = document.createElement('span')
  controls.className = 'image-viewport-controls'
  controls.contentEditable = 'false'
  controls.setAttribute('role', 'group')
  const percentage = document.createElement('span')
  percentage.className = 'image-viewport-percentage'
  let view: ImageTransform = { scale: 1, x: 0, y: 0 }
  let fit = 1
  let ready = false
  let imageVersion = 0
  let lastWidth = 0
  let drag: { id: number; x: number; y: number; view: ImageTransform } | null = null
  let panned = false

  const button = (path: string, action: () => void) => {
    const element = document.createElement('button')
    element.type = 'button'
    element.className = 'image-viewport-button'
    element.innerHTML = `<svg viewBox="0 0 18 18" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`
    element.addEventListener('mousedown', (event) => event.preventDefault())
    element.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      action()
    })
    return element
  }
  const apply = () => {
    image.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`
    percentage.textContent = `${Math.round(view.scale * 100)}%`
    zoomOut.disabled = view.scale <= Math.min(fit, 0.1)
    zoomIn.disabled = view.scale >= 8
  }
  const reset = () => {
    if (!ready) return
    const size =
      sizing === 'natural'
        ? imageDisplaySize(image)
        : { width: image.naturalWidth, height: image.naturalHeight }
    if (sizing === 'natural') {
      image.style.width = `${size.width}px`
      image.style.height = `${size.height}px`
    }
    if (!canvas.clientWidth) return
    const width = canvas.clientWidth
    const padding = sizing === 'bounded' ? 16 : 0
    const availableWidth = Math.max(1, width - padding * 2)
    const naturalHeight = size.height * Math.min(1, availableWidth / size.width)
    const height = Math.max(
      // Leave room for the overlaid controls even on a very short image.
      sizing === 'natural' ? 56 : 1,
      Math.round(
        sizing === 'natural'
          ? naturalHeight
          : Math.max(140, Math.min(420, naturalHeight + padding * 2)),
      ),
    )
    canvas.style.height = `${height}px`
    fit = Math.min(1, availableWidth / size.width, (height - padding * 2) / size.height)
    view = {
      scale: fit,
      x: (width - size.width * fit) / 2,
      y: (height - size.height * fit) / 2,
    }
    apply()
  }
  const zoom = (
    factor: number,
    point = { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 },
  ) => {
    if (!ready) return
    view = zoomImage(view, point, factor, Math.min(fit, 0.1))
    apply()
  }
  const expand = () => {
    if (ready)
      openImageView(image.src, getComputedStyle(preview).getPropertyValue('--paper').trim())
  }
  const zoomOut = button('<path d="M4 9h10"/>', () => zoom(1 / 1.25))
  const zoomIn = button('<path d="M4 9h10M9 4v10"/>', () => zoom(1.25))
  const resetButton = button('<path d="M3 4v4h4M3.5 7a6 6 0 1 1-.2 4"/>', reset)
  const expandButton = button('<path d="M3 7V3h4M11 3h4v4M15 11v4h-4M7 15H3v-4"/>', expand)
  controls.append(zoomOut, percentage, zoomIn, resetButton, expandButton)
  canvas.append(image)
  preview.append(canvas, controls)
  // Tab navigation must select the same node that pointer interaction selects.
  preview.addEventListener('focusin', onSelect)

  const endDrag = () => {
    const pointer = drag?.id
    drag = null
    canvas.classList.remove('is-dragging')
    if (pointer !== undefined && canvas.hasPointerCapture(pointer))
      canvas.releasePointerCapture(pointer)
  }
  canvas.addEventListener('pointerdown', (event) => {
    if (!ready || event.button !== 0) return
    event.preventDefault()
    panned = false
    onSelect()
    canvas.focus({ preventScroll: true })
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, view }
    canvas.setPointerCapture(event.pointerId)
    canvas.classList.add('is-dragging')
  })
  canvas.addEventListener('pointermove', (event) => {
    if (!drag || drag.id !== event.pointerId) return
    if (Math.abs(event.clientX - drag.x) + Math.abs(event.clientY - drag.y) > 3) panned = true
    view = {
      scale: drag.view.scale,
      x: drag.view.x + event.clientX - drag.x,
      y: drag.view.y + event.clientY - drag.y,
    }
    apply()
  })
  canvas.addEventListener('pointerup', endDrag)
  canvas.addEventListener('pointercancel', endDrag)
  canvas.addEventListener('lostpointercapture', endDrag)
  canvas.addEventListener('click', (event) => {
    if (!panned) return
    event.preventDefault()
    event.stopPropagation()
    panned = false
  })
  canvas.addEventListener('dblclick', expand)
  canvas.addEventListener(
    'wheel',
    (event) => {
      if (!ready || (!event.ctrlKey && !event.metaKey)) return
      event.preventDefault()
      const rect = canvas.getBoundingClientRect()
      zoom(Math.exp(-event.deltaY * 0.002), {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      })
    },
    { passive: false },
  )
  canvas.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey || !ready) return
    const step = event.shiftKey ? 120 : 40
    switch (event.key) {
      case '+':
      case '=':
        zoom(1.25)
        break
      case '-':
        zoom(1 / 1.25)
        break
      case '0':
        reset()
        break
      case 'Enter':
        expand()
        break
      case 'ArrowLeft':
        view = { ...view, x: view.x - step }
        apply()
        break
      case 'ArrowRight':
        view = { ...view, x: view.x + step }
        apply()
        break
      case 'ArrowUp':
        view = { ...view, y: view.y - step }
        apply()
        break
      case 'ArrowDown':
        view = { ...view, y: view.y + step }
        apply()
        break
      default:
        return
    }
    event.preventDefault()
    event.stopPropagation()
  })
  const resize = new ResizeObserver(() => {
    if (!ready || canvas.clientWidth === lastWidth) return
    lastWidth = canvas.clientWidth
    reset()
  })
  resize.observe(canvas)
  const hide = () => {
    imageVersion++
    ready = false
    endDrag()
    canvas.hidden = true
    controls.hidden = true
    image.hidden = true
  }
  const onLoad = () => {
    ready = true
    canvas.hidden = false
    controls.hidden = false
    image.hidden = false
    status.hidden = true
    reset()
  }
  hide()
  return {
    hide,
    resize: reset,
    show(url: string) {
      const version = ++imageVersion
      image.src = url
      return image.decode().then(
        () => {
          if (version !== imageVersion) return false
          onLoad()
          return true
        },
        () => {
          if (version === imageVersion) {
            status.hidden = false
            status.textContent = i18n.t('imageViewport.invalid')
          }
          return false
        },
      )
    },
    labels() {
      const labels = [
        i18n.t('editor.zoomOut'),
        i18n.t('editor.zoomIn'),
        i18n.t('imageViewport.resetView'),
        i18n.t('imageViewport.expand'),
      ]
      for (const [index, element] of [zoomOut, zoomIn, resetButton, expandButton].entries()) {
        element.title = labels[index]
        element.setAttribute('aria-label', labels[index])
      }
      canvas.title = i18n.t('imageViewport.navigationHint')
      canvas.setAttribute('aria-label', image.alt || i18n.t('imageViewport.label'))
      controls.setAttribute('aria-label', i18n.t('imageViewport.controls'))
    },
    destroy() {
      hide()
      preview.removeEventListener('focusin', onSelect)
      resize.disconnect()
      canvas.remove()
      controls.remove()
    },
  }
}
