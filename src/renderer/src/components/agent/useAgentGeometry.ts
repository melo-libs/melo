import {
  useCallback,
  useLayoutEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react'

export function useAgentGeometry(
  open: boolean,
  anchor: { x: number; y: number } | null,
  collapsed: boolean,
) {
  const panel = useRef<HTMLDivElement>(null)
  const position = useRef<{ x: number; y: number } | null>(null)
  const dockPosition = useRef<{ x: number; y: number } | null>(null)
  const dragged = useRef(false)
  const size = useRef<{ width: number; height: number } | null>(null)
  const cleanup = useRef<(() => void) | null>(null)
  const previousAnchor = useRef(anchor)
  const place = useCallback(
    (x: number, y: number) => {
      const element = panel.current!
      const next = {
        x: Math.round(Math.max(12, Math.min(x, window.innerWidth - element.offsetWidth - 12))),
        y: Math.round(Math.max(48, Math.min(y, window.innerHeight - element.offsetHeight - 12))),
      }
      if (collapsed) dockPosition.current = next
      else position.current = next
      element.style.left = `${next.x}px`
      element.style.top = `${next.y}px`
    },
    [collapsed],
  )
  useLayoutEffect(() => {
    if (!open) return
    const element = panel.current!
    const dock = () => {
      if (dockPosition.current) {
        place(dockPosition.current.x, dockPosition.current.y)
        return
      }
      element.style.left = `${Math.max(12, window.innerWidth - element.offsetWidth - 20)}px`
      element.style.top = `${Math.max(48, window.innerHeight - element.offsetHeight - 20)}px`
    }
    if (collapsed) {
      element.style.removeProperty('width')
      element.style.removeProperty('height')
      dock()
    } else {
      if (size.current) {
        element.style.width = `${size.current.width}px`
        element.style.height = `${size.current.height}px`
      } else {
        element.style.removeProperty('width')
        element.style.removeProperty('height')
      }
      const next =
        anchor && (anchor !== previousAnchor.current || !position.current)
          ? anchor
          : (position.current ?? { x: window.innerWidth - element.offsetWidth - 32, y: 92 })
      place(next.x, next.y)
      previousAnchor.current = anchor
    }
    const clamp = () => {
      if (collapsed) dock()
      else if (position.current) place(position.current.x, position.current.y)
    }
    const observer = new ResizeObserver(clamp)
    observer.observe(element)
    window.addEventListener('resize', clamp)
    return () => {
      cleanup.current?.()
      observer.disconnect()
      window.removeEventListener('resize', clamp)
    }
  }, [open, anchor, collapsed, place])

  const start = (event: ReactPointerEvent<HTMLElement>, resize: boolean) => {
    if (
      event.button !== 0 ||
      (!resize && !collapsed && (event.target as HTMLElement).closest('button'))
    )
      return
    event.preventDefault()
    cleanup.current?.()
    dragged.current = false
    const element = panel.current!
    const origin = {
      x: event.clientX,
      y: event.clientY,
      left: element.offsetLeft,
      top: element.offsetTop,
      width: element.offsetWidth,
      height: element.offsetHeight,
    }
    let pointer = { x: event.clientX, y: event.clientY }
    let frame = 0
    const update = () => {
      frame = 0
      if (resize) {
        const width = Math.round(
          Math.min(
            window.innerWidth - origin.left - 12,
            Math.max(360, origin.width + pointer.x - origin.x),
          ),
        )
        const height = Math.round(
          Math.min(
            window.innerHeight - origin.top - 12,
            Math.max(
              element.querySelector('.agent-permission[data-pending] .agent-edit-diff')
                ? 640
                : element.querySelector('.agent-permission[data-pending]')
                  ? 520
                  : 360,
              origin.height + pointer.y - origin.y,
            ),
          ),
        )
        size.current = { width, height }
        element.style.width = `${width}px`
        element.style.height = `${height}px`
      } else place(origin.left + pointer.x - origin.x, origin.top + pointer.y - origin.y)
    }
    const move = (next: PointerEvent) => {
      if (next.pointerId !== event.pointerId) return
      pointer = { x: next.clientX, y: next.clientY }
      // Small pointer jitter must remain a click on the minimized button.
      if (
        collapsed &&
        !dragged.current &&
        Math.hypot(pointer.x - origin.x, pointer.y - origin.y) < 4
      )
        return
      dragged.current = true
      element.setAttribute('data-dragging', '')
      if (!frame) frame = requestAnimationFrame(update)
    }
    const stop = (event?: Event) => {
      if (frame) {
        cancelAnimationFrame(frame)
        // Only pointer release commits the last frame. On unmount the panel
        // ref is already detached, so cleanup must cancel without measuring.
        if (event?.type === 'pointerup') update()
        frame = 0
      }
      element.removeAttribute('data-dragging')
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
      window.removeEventListener('blur', stop)
      cleanup.current = null
    }
    if (!collapsed) element.setAttribute('data-dragging', '')
    cleanup.current = stop
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop, { once: true })
    window.addEventListener('pointercancel', stop, { once: true })
    window.addEventListener('blur', stop, { once: true })
  }
  return {
    panel,
    drag: (event: ReactPointerEvent<HTMLDivElement>) => start(event, false),
    captureClick: (event: ReactMouseEvent<HTMLDivElement>) => {
      if (collapsed && dragged.current && event.detail > 0) {
        event.preventDefault()
        event.stopPropagation()
      }
      dragged.current = false
    },
    resize: (event: ReactPointerEvent<HTMLButtonElement>) => start(event, true),
  }
}
