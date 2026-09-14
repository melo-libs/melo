import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Icon } from '../Icon'
import './overlays.scss'

/* ============================================================
   ImageLightbox — full-window overlay viewer for document images.
   Opened via the 'melo:image-view' event (double-click on an image,
   or the View button in the image bubble). Never touches the page
   layout: the image floats over a dark scrim with cursor-anchored
   wheel zoom, drag panning, Fit / 1:1 and Esc / scrim-click close.
   ============================================================ */

const ZOOM_MIN = 0.1
const ZOOM_MAX = 8
/** Fit leaves air around the image and room for the bottom toolbar. */
const FIT_PAD_X = 80
const FIT_PAD_Y = 120

interface ViewTransform {
  s: number
  tx: number
  ty: number
}

export function openImageView(src: string): void {
  window.dispatchEvent(new CustomEvent('melo:image-view', { detail: { src } }))
}

const fitScale = (w: number, h: number): number =>
  Math.min((window.innerWidth - FIT_PAD_X) / w, (window.innerHeight - FIT_PAD_Y) / h, 1)

const centered = (w: number, h: number, s: number): ViewTransform => ({
  s,
  tx: (window.innerWidth - w * s) / 2,
  ty: (window.innerHeight - h * s) / 2,
})

export const ImageLightbox = () => {
  const { t } = useTranslation()
  const [src, setSrc] = useState<string | null>(null)
  const [view, setView] = useState<ViewTransform | null>(null)
  const nat = useRef({ w: 0, h: 0 })
  const overlayRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<ViewTransform | null>(null)
  viewRef.current = view

  useEffect(() => {
    const onView = (e: Event) => {
      setSrc((e as CustomEvent<{ src: string }>).detail.src)
      setView(null)
    }
    window.addEventListener('melo:image-view', onView)
    return () => window.removeEventListener('melo:image-view', onView)
  }, [])

  const close = useCallback(() => {
    setSrc(null)
    setView(null)
  }, [])

  const toFit = useCallback(() => {
    const { w, h } = nat.current
    if (w) setView(centered(w, h, fitScale(w, h)))
  }, [])

  const onLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget
    nat.current = { w: img.naturalWidth || 1, h: img.naturalHeight || 1 }
    toFit()
  }

  /** Zoom anchored at a viewport point: that point stays put on screen. */
  const zoomAt = useCallback((cx: number, cy: number, factor: number) => {
    setView((v) => {
      if (!v) return v
      const s = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v.s * factor))
      if (s === v.s) return v
      return { s, tx: cx - ((cx - v.tx) * s) / v.s, ty: cy - ((cy - v.ty) * s) / v.s }
    })
  }, [])

  // Wheel zoom must preventDefault (page behind would scroll), so the
  // listener has to be non-passive — attached manually.
  useEffect(() => {
    if (!src) return
    const el = overlayRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.002))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [src, zoomAt])

  useEffect(() => {
    if (!src) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
      else if (e.key === '+' || e.key === '=')
        zoomAt(window.innerWidth / 2, window.innerHeight / 2, 1.25)
      else if (e.key === '-') zoomAt(window.innerWidth / 2, window.innerHeight / 2, 1 / 1.25)
      else if (e.key === '0') toFit()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [src, close, zoomAt, toFit])

  const onImgPointerDown = (e: React.PointerEvent<HTMLImageElement>) => {
    e.preventDefault()
    const start = viewRef.current
    if (!start) return
    const sx = e.clientX
    const sy = e.clientY
    const img = e.currentTarget
    img.setPointerCapture(e.pointerId)
    img.classList.add('dragging')
    const move = (ev: PointerEvent) => {
      setView({ s: start.s, tx: start.tx + ev.clientX - sx, ty: start.ty + ev.clientY - sy })
    }
    const up = () => {
      img.classList.remove('dragging')
      img.removeEventListener('pointermove', move)
      img.removeEventListener('pointerup', up)
    }
    img.addEventListener('pointermove', move)
    img.addEventListener('pointerup', up)
  }

  if (!src) return null

  const fit = nat.current.w ? fitScale(nat.current.w, nat.current.h) : 1
  const atFit = view != null && Math.abs(view.s - fit) < 0.001
  return (
    <div
      ref={overlayRef}
      className="ilb-scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <img
        className="ilb-img"
        src={src}
        draggable={false}
        onLoad={onLoad}
        onPointerDown={onImgPointerDown}
        onDoubleClick={() => {
          if (atFit) setView(centered(nat.current.w, nat.current.h, 1))
          else toFit()
        }}
        style={
          view
            ? {
                transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.s})`,
                visibility: 'visible',
              }
            : { visibility: 'hidden' }
        }
      />
      <div className="ilb-bar" onMouseDown={(e) => e.stopPropagation()}>
        <button
          className="ilb-btn"
          title={t('editor.zoomOut')}
          onClick={() => zoomAt(window.innerWidth / 2, window.innerHeight / 2, 1 / 1.25)}
        >
          <svg
            viewBox="0 0 18 18"
            width="14"
            height="14"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            fill="none"
          >
            <path d="M4 9h10" />
          </svg>
        </button>
        <span className="ilb-pct">{view ? Math.round(view.s * 100) : 100}%</span>
        <button
          className="ilb-btn"
          title={t('editor.zoomIn')}
          onClick={() => zoomAt(window.innerWidth / 2, window.innerHeight / 2, 1.25)}
        >
          <Icon name="plus" size={14} />
        </button>
        <span className="ilb-sep" />
        <button className="ilb-btn ilb-text" title={t('editor.fitToWindow')} onClick={toFit}>
          Fit
        </button>
        <button
          className="ilb-btn ilb-text"
          title={t('editor.actualSize')}
          onClick={() => setView(centered(nat.current.w, nat.current.h, 1))}
        >
          1:1
        </button>
        <span className="ilb-sep" />
        <button className="ilb-btn" title={t('editor.closeEsc')} onClick={close}>
          <Icon name="x" size={14} />
        </button>
      </div>
    </div>
  )
}
