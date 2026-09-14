import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Icon, type IconName } from '../Icon'
import { toast } from '../Toaster'
import i18n from '../../i18n'
import { copyText } from '../../lib/clipboard'
import { FORMAT_OPTIONS, blockName } from './overlayData'
import {
  turnBlockInto,
  duplicateBlock,
  deleteBlock,
  blockTypeOf,
  canTurnBlock,
  blockMarkdown,
} from './blockCommands'

export interface BlockMenuProps {
  editor: Editor
  node: PMNode
  pos: number
  anchor: { x: number; y: number }
  onClose: () => void
}

type MenuItem = {
  key: string
  label: string
  run: () => void
  /** Type chip (turn-into rows): text face ("H2" / "Aa") or block icon. */
  sample?: string
  chipIcon?: IconName
  /** Icon name (action rows). */
  icon?: string
  shortcut?: string
  active?: boolean
  danger?: boolean
}

/** Turn-into rows carry a type chip (text or icon); action rows don't. */
const isTurn = (i: MenuItem) => i.sample !== undefined || i.chipIcon !== undefined

/** Drag-handle block menu — converts / duplicates / copies / deletes the
 *  block. Fully keyboard-operable: ↑↓ + Enter, ⌫ deletes, Esc closes. */
export const BlockMenu = ({ editor, node, pos, anchor, onClose }: BlockMenuProps) => {
  useTranslation()
  const canTurn = canTurnBlock(node)
  const activeType = blockTypeOf(node)

  const items: MenuItem[] = [
    ...(canTurn
      ? FORMAT_OPTIONS.map((o) => ({
          key: o.id,
          label: blockName(o.id),
          sample: o.sample,
          chipIcon: o.icon,
          active: o.id === activeType,
          run: () => {
            turnBlockInto(editor, pos, node, o.id)
            onClose()
          },
        }))
      : []),
    {
      key: 'duplicate',
      label: i18n.t('blocks.duplicate'),
      icon: 'copy',
      shortcut: '⌘D',
      run: () => {
        duplicateBlock(editor, pos, node)
        onClose()
      },
    },
    {
      key: 'copy-md',
      label: i18n.t('blocks.copyAsMarkdown'),
      icon: 'fileMd',
      run: () => {
        void copyText(blockMarkdown(editor, node)).then((ok) => {
          if (ok) toast(i18n.t('blocks.copied'))
        })
        onClose()
      },
    },
    {
      key: 'delete',
      label: i18n.t('blocks.delete'),
      icon: 'trash',
      shortcut: '⌫',
      danger: true,
      run: () => {
        deleteBlock(editor, pos, node)
        onClose()
      },
    },
  ]
  const itemsRef = useRef(items)
  itemsRef.current = items

  // Keyboard: ↑↓ moves focus, Enter runs, ⌫ deletes the block, Esc closes.
  // Focus lives in a ref (source of truth for the handler — running actions
  // inside a setState updater would double-fire under StrictMode) and is
  // mirrored into state for rendering.
  const [focus, setFocusState] = useState(-1)
  const focusRef = useRef(-1)
  const setFocus = (v: number) => {
    focusRef.current = v
    setFocusState(v)
  }
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.block-menu')) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      const list = itemsRef.current
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const delta = e.key === 'ArrowDown' ? 1 : -1
        setFocus((focusRef.current + delta + list.length) % list.length)
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        list[focusRef.current]?.run()
        return
      }
      if (e.key === 'Backspace') {
        e.preventDefault()
        list.find((i) => i.key === 'delete')?.run()
      }
    }
    const t = setTimeout(() => document.addEventListener('mousedown', onDown), 0)
    document.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(t)
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  // Keep the menu inside the viewport (blocks near the bottom edge).
  const ref = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState(anchor)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const pad = 8
    setPlace({
      x: Math.max(pad, Math.min(anchor.x, window.innerWidth - pad - r.width)),
      y: Math.max(pad, Math.min(anchor.y, window.innerHeight - pad - r.height)),
    })
  }, [anchor])

  const renderItem = (item: MenuItem, idx: number) => (
    <div
      key={item.key}
      className={[
        'bm-item',
        item.danger && 'danger',
        item.active && 'active',
        idx === focus && 'focused',
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={item.run}
    >
      {isTurn(item) ? (
        <span className="bm-sample">
          {item.chipIcon ? <Icon name={item.chipIcon} size={14} /> : item.sample}
        </span>
      ) : (
        item.icon && <Icon name={item.icon} size={14} />
      )}
      {item.label}
      {item.active && (
        // Plain tick, same glyph as the bubble dropdown's — the `check`
        // icon in the set is the task-list composite, not a checkmark.
        <svg
          viewBox="0 0 18 18"
          width="13"
          height="13"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="bm-check"
        >
          <path d="M4 9.5l3.2 3.2L14 6" />
        </svg>
      )}
      {item.shortcut && <span className="bm-shortcut">{item.shortcut}</span>}
    </div>
  )

  const turnItems = items.filter(isTurn)
  const actionItems = items.filter((i) => !isTurn(i) && !i.danger)
  const dangerItems = items.filter((i) => i.danger)
  const indexOf = (item: MenuItem) => items.indexOf(item)

  return (
    <div ref={ref} className="block-menu" style={{ left: place.x, top: place.y }}>
      {turnItems.length > 0 && (
        <>
          <div className="bm-section">{i18n.t('editor.turnInto')}</div>
          {turnItems.map((i) => renderItem(i, indexOf(i)))}
          <div className="bm-sep" />
        </>
      )}
      {actionItems.map((i) => renderItem(i, indexOf(i)))}
      <div className="bm-sep" />
      {dangerItems.map((i) => renderItem(i, indexOf(i)))}
    </div>
  )
}
