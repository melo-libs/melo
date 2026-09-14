import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { IpcChannels } from '@shared/types/ipc'
import {
  getDocument,
  GlobalWorkerOptions,
  TextLayer,
  type PDFDocumentProxy,
  type PDFPageProxy,
  type RenderTask,
} from 'pdfjs-dist/legacy/build/pdf.mjs'
import PdfWorker from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker'

/* ============================================================
   PdfViewer — pdf.js-rendered PDF reading surface. Replaces the
   Chromium <iframe> viewer so the background, page chrome and
   typographic surroundings belong to the app (the built-in
   viewer's dark backdrop is hardcoded in the plugin). Pages
   render lazily into canvases with a selectable text layer.
   ============================================================ */

// The legacy build ships its own polyfills — the modern build assumes
// newer Chromium (Promise.try, Uint8Array.toHex) than Electron 31 has.
// The worker is a bundled same-origin asset (local-first; a blob: inline
// worker would violate the renderer's script-src 'self' CSP). One port
// serves the whole renderer; documents attach sequentially.
if (!GlobalWorkerOptions.workerPort) GlobalWorkerOptions.workerPort = new PdfWorker()

export interface PdfViewerProps {
  path: string
  name: string
}

/** Horizontal inset between the pane edge and the page — must match the
    .pdf-pages side padding so fit-to-width actually fills the pane. */
const PANE_PADDING = 16
/** Extra viewport margin (px) around the visible area that keeps pages
    rendered — scrolling reaches them before they blank. */
const RENDER_MARGIN = 800
const MIN_ZOOM = 0.4
const MAX_ZOOM = 4

interface PageSlot {
  el: HTMLDivElement
  page: PDFPageProxy | null
  canvas: HTMLCanvasElement | null
  textLayerDiv: HTMLDivElement | null
  renderTask: RenderTask | null
  textLayer: TextLayer | null
  renderedScale: number | null
}

export const PdfViewer = ({ path, name }: PdfViewerProps) => {
  const { t } = useTranslation()
  const scrollRef = useRef<HTMLDivElement>(null)
  const pagesRef = useRef<HTMLDivElement>(null)
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Base page sizes at scale 1; index 0 doubles as the estimate for
  // pages whose real size hasn't been discovered yet.
  const sizesRef = useRef<({ w: number; h: number } | null)[]>([])
  const [fitScale, setFitScale] = useState(1)
  const [zoom, setZoom] = useState(1)
  const scale = fitScale * zoom

  // ---- load the document ----
  useEffect(() => {
    let alive = true
    let loaded: PDFDocumentProxy | null = null
    setDoc(null)
    setError(null)
    ;(async () => {
      const res = await window.api.invoke(IpcChannels.InvokeReadFileBinary, { filePath: path })
      if (!alive) return
      if (!res.success || !res.data) {
        setError(res.error ?? t('viewer.couldNotReadFile'))
        return
      }
      try {
        const task = getDocument({
          data: res.data.data,
          // CJK character maps + fallback fonts, copied next to the bundle
          // (vite-plugin-static-copy); resolves under file:// and dev http.
          cMapUrl: new URL('pdfjs/cmaps/', document.baseURI).href,
          standardFontDataUrl: new URL('pdfjs/standard_fonts/', document.baseURI).href,
        })
        loaded = await task.promise
        if (!alive) {
          void task.destroy()
          return
        }
        const first = await loaded.getPage(1)
        if (!alive) return
        const vp = first.getViewport({ scale: 1 })
        sizesRef.current = new Array(loaded.numPages).fill(null)
        sizesRef.current[0] = { w: vp.width, h: vp.height }
        setDoc(loaded)
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : t('viewer.couldNotOpenPdf'))
      }
    })()
    return () => {
      alive = false
      if (loaded) void loaded.loadingTask.destroy()
    }
  }, [path])

  // ---- fit-to-width against the pane ----
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !doc) return
    const compute = () => {
      const base = sizesRef.current[0]
      if (!base) return
      const avail = el.clientWidth - PANE_PADDING * 2
      setFitScale(Math.max(0.1, avail / base.w))
    }
    compute()
    const ro = new ResizeObserver(compute)
    ro.observe(el)
    return () => ro.disconnect()
  }, [doc])

  // ---- lazy page rendering ----
  const slotsRef = useRef<Map<number, PageSlot>>(new Map())

  const teardownSlot = useCallback((slot: PageSlot) => {
    slot.renderTask?.cancel()
    slot.renderTask = null
    slot.textLayer?.cancel()
    slot.textLayer = null
    slot.canvas?.remove()
    slot.canvas = null
    slot.textLayerDiv?.remove()
    slot.textLayerDiv = null
    slot.renderedScale = null
    try {
      // Drop the page's operator-list/object caches — without this an
      // image-heavy document grows document-level memory as you scroll.
      slot.page?.cleanup()
    } catch {
      // A render was still winding down; the caches go with the document.
    }
    slot.page = null
  }, [])

  const renderPage = useCallback(
    async (pdf: PDFDocumentProxy, index: number, slot: PageSlot, atScale: number) => {
      if (slot.renderedScale === atScale || slot.renderTask) return
      let page: PDFPageProxy
      try {
        page = await pdf.getPage(index + 1)
      } catch {
        return // document destroyed mid-scroll
      }
      const vp1 = page.getViewport({ scale: 1 })
      sizesRef.current[index] = { w: vp1.width, h: vp1.height }
      const viewport = page.getViewport({ scale: atScale })
      const dpr = window.devicePixelRatio || 1

      teardownSlot(slot)
      slot.page = page
      const canvas = document.createElement('canvas')
      canvas.className = 'pdf-canvas'
      canvas.width = Math.floor(viewport.width * dpr)
      canvas.height = Math.floor(viewport.height * dpr)
      slot.canvas = canvas
      slot.el.appendChild(canvas)

      slot.renderTask = page.render({
        canvas,
        viewport,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
      })
      try {
        await slot.renderTask.promise
        slot.renderTask = null
        slot.renderedScale = atScale

        const textDiv = document.createElement('div')
        textDiv.className = 'pdf-textlayer'
        slot.el.style.setProperty('--total-scale-factor', String(atScale))
        slot.textLayerDiv = textDiv
        slot.el.appendChild(textDiv)
        slot.textLayer = new TextLayer({
          textContentSource: page.streamTextContent(),
          container: textDiv,
          viewport,
        })
        await slot.textLayer.render()
      } catch {
        slot.renderTask = null // cancelled — a newer render owns the slot
      }
    },
    [teardownSlot],
  )

  // (Re)build page placeholders when the document or scale changes.
  useEffect(() => {
    const host = pagesRef.current
    const scrollEl = scrollRef.current
    if (!host || !scrollEl || !doc) return
    const slots = slotsRef.current

    // Keep the reading position through zoom changes: same proportional
    // offset into the (rescaled) document.
    const prevRange = scrollEl.scrollHeight - scrollEl.clientHeight
    const anchor = prevRange > 0 ? scrollEl.scrollTop / prevRange : 0

    for (const slot of slots.values()) teardownSlot(slot)
    slots.clear()
    host.textContent = ''

    for (let i = 0; i < doc.numPages; i++) {
      const size = sizesRef.current[i] ?? sizesRef.current[0]!
      const el = document.createElement('div')
      el.className = 'pdf-page'
      el.style.width = `${size.w * scale}px`
      el.style.height = `${size.h * scale}px`
      el.dataset.page = String(i)
      host.appendChild(el)
      slots.set(i, {
        el,
        page: null,
        canvas: null,
        textLayerDiv: null,
        renderTask: null,
        textLayer: null,
        renderedScale: null,
      })
    }

    scrollEl.scrollTop = anchor * Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight)

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const index = Number((entry.target as HTMLElement).dataset.page)
          const slot = slots.get(index)
          if (!slot) continue
          if (entry.isIntersecting) {
            void renderPage(doc, index, slot, scale).then(() => {
              // First discovery of a non-uniform page size: fix the placeholder.
              const size = sizesRef.current[index]
              if (size && slot.el.clientWidth !== Math.round(size.w * scale)) {
                slot.el.style.width = `${size.w * scale}px`
                slot.el.style.height = `${size.h * scale}px`
              }
            })
          } else {
            teardownSlot(slot) // free canvas memory for far-away pages
          }
        }
      },
      { root: scrollEl, rootMargin: `${RENDER_MARGIN}px 0px` },
    )
    for (const slot of slots.values()) io.observe(slot.el)

    return () => {
      io.disconnect()
      for (const slot of slots.values()) teardownSlot(slot)
      slots.clear()
    }
  }, [doc, scale, renderPage, teardownSlot])

  // ---- zoom: buttons + pinch / cmd+wheel ----
  const zoomBy = useCallback((factor: number) => {
    setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * factor)))
  }, [])
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomBy])

  if (error) {
    return (
      <div className="viewer-page">
        <div className="viewer-card">
          <div className="viewer-card-name">{name}</div>
          <div className="viewer-card-note">{error}</div>
          <div className="viewer-card-actions">
            <button
              className="viewer-btn primary"
              onClick={() => void window.api.invoke(IpcChannels.InvokeOpenPath, { path })}
            >
              {t('viewer.openInDefaultApp')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="viewer-page">
      <div className="pdf-scroll" ref={scrollRef}>
        <div className="pdf-pages" ref={pagesRef} />
      </div>
      {doc && (
        <div className="pdf-zoom">
          <button aria-label={t('editor.zoomOut')} onClick={() => zoomBy(1 / 1.2)}>
            −
          </button>
          <button className="pdf-zoom-reset" onClick={() => setZoom(1)}>
            {Math.round(zoom * 100)}%
          </button>
          <button aria-label={t('editor.zoomIn')} onClick={() => zoomBy(1.2)}>
            +
          </button>
        </div>
      )}
    </div>
  )
}
