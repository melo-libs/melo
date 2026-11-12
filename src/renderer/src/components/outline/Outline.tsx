import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { useAtomValue } from 'jotai'
import { tocAtom } from '../../store/toc'
import './outline.scss'

function ContentsCard({ children, onMouseEnter }: { children: ReactNode; onMouseEnter(): void }) {
  const present = useIsPresent()
  const reducedMotion = useReducedMotion()
  return (
    <motion.div
      className="doc-outline-card"
      data-floating-obstacle
      aria-hidden={!present || undefined}
      ref={(element) => {
        // Exit animation keeps the card mounted after it stops being interactive.
        if (element) element.inert = !present
      }}
      initial={{ opacity: 0, x: reducedMotion ? 0 : 6 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: reducedMotion ? 0 : 6 }}
      transition={{ duration: reducedMotion ? 0 : 0.16, ease: 'easeOut' }}
      onMouseEnter={onMouseEnter}
    >
      {children}
    </motion.div>
  )
}

export const Outline = () => {
  const { t } = useTranslation()
  const toc = useAtomValue(tocAtom)
  const [mode, setMode] = useState<'hover' | 'keyboard' | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const [edges, setEdges] = useState({ above: false, below: false })
  const root = useRef<HTMLElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)
  const restoreOnClose = useRef(false)
  const hoverClose = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dense = toc.length > 20
  const hasHeadings = toc.length > 0
  const activeIndex = Math.max(
    0,
    toc.findIndex((item) => item.active),
  )
  const activeId = toc[activeIndex]?.id
  const marks = toc.filter((item) => !dense || item.level <= 2)
  const activeMark = toc
    .slice(0, activeIndex + 1)
    .reverse()
    .find((item) => !dense || item.level <= 2)?.id

  const cancelHoverClose = useCallback(() => {
    if (hoverClose.current !== null) clearTimeout(hoverClose.current)
    hoverClose.current = null
  }, [])
  useEffect(() => cancelHoverClose, [cancelHoverClose])
  const openHover = useCallback(() => {
    cancelHoverClose()
    if (!root.current?.contains(document.activeElement))
      previousFocus.current = document.activeElement as HTMLElement | null
    setMode((current) => current ?? 'hover')
  }, [cancelHoverClose])
  const openKeyboard = useCallback(() => {
    cancelHoverClose()
    if (!list.current?.contains(document.activeElement))
      previousFocus.current = document.activeElement as HTMLElement | null
    setCursor(null)
    setMode('keyboard')
  }, [cancelHoverClose])
  const close = useCallback(
    (restoreFocus: boolean) => {
      cancelHoverClose()
      restoreOnClose.current = restoreFocus
      setCursor(null)
      setMode(null)
    },
    [cancelHoverClose],
  )
  const updateEdges = useCallback(() => {
    const element = list.current
    if (!element) return
    const above = element.scrollTop > 1
    const below = element.scrollTop + element.clientHeight < element.scrollHeight - 1
    setEdges((previous) =>
      previous.above === above && previous.below === below ? previous : { above, below },
    )
  }, [])
  useEffect(() => {
    if (!toc.length) close(false)
  }, [toc.length, close])

  useEffect(() => {
    if (!toc.length) return
    const onKey = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        !(event.metaKey || event.ctrlKey) ||
        !event.altKey ||
        event.shiftKey ||
        event.code !== 'KeyO'
      )
        return
      const target = event.target as Element | null
      if (target?.closest('.agent-window, [role="dialog"], [role="menu"]')) return
      event.preventDefault()
      openKeyboard()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toc.length, openKeyboard])

  useLayoutEffect(() => {
    if (!mode) {
      if (restoreOnClose.current) previousFocus.current?.focus({ preventScroll: true })
      restoreOnClose.current = false
      return
    }
    if (!toc.length) return
    if (mode === 'keyboard' && cursor !== null) return
    const current =
      list.current?.querySelector<HTMLElement>('[aria-current="location"]') ??
      list.current?.querySelector<HTMLElement>('button')
    current?.scrollIntoView({ block: 'center' })
    if (mode === 'keyboard') current?.focus({ preventScroll: true })
    updateEdges()
  }, [mode, toc.length, activeId, cursor, updateEdges])

  useLayoutEffect(() => {
    if (!mode || !hasHeadings) return
    const observer = new ResizeObserver(updateEdges)
    observer.observe(list.current!)
    return () => observer.disconnect()
  }, [mode, hasHeadings, updateEdges])

  useEffect(() => {
    if (!mode) return
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [mode, close])

  if (!toc.length) return null
  return (
    <nav
      ref={root}
      className="doc-outline"
      aria-label={t('outline.outline')}
      data-open={mode !== null || undefined}
      data-dense={dense || undefined}
      onFocus={cancelHoverClose}
      onMouseLeave={() => {
        if (mode !== 'hover' || list.current?.contains(document.activeElement)) return
        cancelHoverClose()
        hoverClose.current = setTimeout(() => close(false), 120)
      }}
      onBlur={(event) => {
        if (mode && !event.currentTarget.contains(event.relatedTarget)) close(false)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && mode) {
          event.preventDefault()
          event.stopPropagation()
          close(true)
          return
        }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        if (!mode) {
          openKeyboard()
          return
        }
        cancelHoverClose()
        setMode('keyboard')
        const buttons = Array.from(list.current!.querySelectorAll<HTMLButtonElement>('button'))
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? buttons.length - 1
              : Math.max(
                  0,
                  Math.min(buttons.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)),
                )
        setCursor(toc[next].id)
        buttons[next].focus({ preventScroll: true })
        buttons[next].scrollIntoView({ block: 'nearest' })
      }}
    >
      <button
        className="doc-outline-trigger"
        style={{ '--mark-count': marks.length } as CSSProperties}
        aria-label={t('outline.open')}
        title={t('outline.shortcut')}
        aria-expanded={mode !== null}
        aria-hidden={mode !== null || undefined}
        tabIndex={mode !== null ? -1 : 0}
        onMouseEnter={openHover}
        onClick={openKeyboard}
      >
        {marks.map((item) => (
          <span
            key={item.id}
            data-level={item.level}
            data-active={item.id === activeMark || undefined}
          />
        ))}
      </button>
      <AnimatePresence initial={false}>
        {mode && (
          <ContentsCard key="contents" onMouseEnter={openHover}>
            <div
              className="doc-outline-list"
              ref={list}
              onScroll={updateEdges}
              data-above={edges.above || undefined}
              data-below={edges.below || undefined}
            >
              {toc.map((item, index) => (
                <button
                  key={item.id}
                  className="doc-outline-item"
                  data-level={Math.min(item.level, 6)}
                  aria-current={index === activeIndex ? 'location' : undefined}
                  tabIndex={item.id === (cursor ?? toc[activeIndex].id) ? 0 : -1}
                  title={item.text || t('outline.untitled')}
                  onClick={() => {
                    const heading = root
                      .current!.closest('.ed-reading')!
                      .querySelector<HTMLElement>(`[data-toc-id="${CSS.escape(item.id)}"]`)
                    heading?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                    close(mode === 'keyboard')
                  }}
                >
                  {item.text || t('outline.untitled')}
                </button>
              ))}
            </div>
          </ContentsCard>
        )}
      </AnimatePresence>
    </nav>
  )
}
