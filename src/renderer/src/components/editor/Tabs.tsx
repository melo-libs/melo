import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import i18n from '../../i18n'
import { Icon } from '../Icon'
import type { EditorTab } from '../../store/editor'

export interface TabsProps {
  tabs: EditorTab[]
  activeId: string
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onCloseOthers: (id: string) => void
  onCloseToRight: (id: string) => void
  onNew: () => void
}

type CtxMenu = { tabId: string; x: number; y: number }

export const Tabs = ({
  tabs,
  activeId,
  onSelect,
  onClose,
  onCloseOthers,
  onCloseToRight,
  onNew,
}: TabsProps) => {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLDivElement>(null)
  const [ctx, setCtx] = useState<CtxMenu | null>(null)

  // Scroll active tab into view when it changes
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeId])

  // Horizontal scroll with mouse wheel
  const onWheel = useCallback((e: React.WheelEvent) => {
    if (!containerRef.current) return
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      containerRef.current.scrollLeft += e.deltaY
    }
  }, [])

  const onContextMenu = useCallback((e: React.MouseEvent, tabId: string) => {
    e.preventDefault()
    const menuW = 200
    const menuH = 220
    const x = Math.min(e.clientX, window.innerWidth - menuW)
    const y = Math.min(e.clientY, window.innerHeight - menuH)
    setCtx({ tabId, x, y })
  }, [])

  // Close context menu on any click or Escape
  useEffect(() => {
    if (!ctx) return
    const close = () => setCtx(null)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [ctx])

  const ctxTab = ctx ? tabs.find((t) => t.id === ctx.tabId) : null
  const ctxIdx = ctx ? tabs.findIndex((t) => t.id === ctx.tabId) : -1
  const isFile = ctxTab ? !ctxTab.id.startsWith('untitled-') : false
  const hasRight = ctxIdx >= 0 && ctxIdx < tabs.length - 1

  const handleCtxAction = useCallback(
    (action: string) => {
      if (!ctx) return
      const { tabId } = ctx
      setCtx(null)
      switch (action) {
        case 'close':
          onClose(tabId)
          break
        case 'closeOthers':
          onCloseOthers(tabId)
          break
        case 'closeRight':
          onCloseToRight(tabId)
          break
        case 'copyPath': {
          const tab = tabs.find((t) => t.id === tabId)
          if (tab?.path) navigator.clipboard.writeText(tab.path)
          break
        }
        case 'reveal': {
          const tab = tabs.find((t) => t.id === tabId)
          if (tab?.path) {
            window.api.invoke(window.api.channels.InvokeRevealInFinder, { path: tab.path })
          }
          break
        }
      }
    },
    [ctx, tabs, onClose, onCloseOthers, onCloseToRight],
  )

  return (
    <div className="ed-tabs" ref={containerRef} onWheel={onWheel}>
      {tabs.map((t) => (
        <div
          key={t.id}
          ref={t.id === activeId ? activeRef : undefined}
          className="ed-tab"
          data-active={t.id === activeId}
          data-dirty={t.dirty}
          onClick={() => onSelect(t.id)}
          onContextMenu={(e) => onContextMenu(e, t.id)}
          title={t.path || t.title}
        >
          <span className="ed-tab-icon">
            <Icon name="md" size={13} />
          </span>
          <span className="ed-tab-title">{t.title}</span>
          <span className="ed-tab-dot" />
          <button
            className="ed-tab-close"
            onClick={(e) => {
              e.stopPropagation()
              onClose(t.id)
            }}
            title={i18n.t('misc.close')}
          >
            <Icon name="x" size={11} />
          </button>
        </div>
      ))}
      <button className="ed-tab-new" onClick={onNew} title={t('misc.newTab')}>
        <Icon name="plus" size={13} />
      </button>
      <div className="ed-tabs-spacer" />

      {ctx && (
        <div
          className="ed-tab-ctx"
          style={{ left: ctx.x, top: ctx.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button className="ed-tab-ctx-item" onClick={() => handleCtxAction('close')}>
            {t('tabs.close')}
          </button>
          <button
            className="ed-tab-ctx-item"
            disabled={tabs.length <= 1}
            onClick={() => handleCtxAction('closeOthers')}
          >
            {t('tabs.closeOthers')}
          </button>
          <button
            className="ed-tab-ctx-item"
            disabled={!hasRight}
            onClick={() => handleCtxAction('closeRight')}
          >
            {t('tabs.closeRight')}
          </button>
          {isFile && (
            <>
              <div className="ed-tab-ctx-sep" />
              <button className="ed-tab-ctx-item" onClick={() => handleCtxAction('copyPath')}>
                {t('tabs.copyPath')}
              </button>
              <button className="ed-tab-ctx-item" onClick={() => handleCtxAction('reveal')}>
                {t('common.revealInFinder')}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
