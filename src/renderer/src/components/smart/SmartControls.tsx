import { useEffect, useState, type ReactNode } from 'react'
import { cn } from '../../lib/cn'
import type { SmartVocab } from '@shared/types/smart'
import { SIcon } from './SmartIcon'
import { useTranslation } from 'react-i18next'
import { RULE_META, RULE_KEY_LIST, newRule, smartLabel, type Rule } from './smartData'

/* ============================================================
   Small interactive pieces of the Smart Folders view — generic
   dropdown, editable rule chip, add-rule + sort menus, and the
   builder's select button. Port of design smart-ui.jsx.
   ============================================================ */

/** Generic dropdown: trigger render-prop + popover children render-prop. */
export function Menu({
  trigger,
  children,
  align = 'left',
  minWidth = 184,
}: {
  trigger: (p: { open: boolean; toggle: () => void }) => ReactNode
  children: (close: () => void) => ReactNode
  align?: 'left' | 'right'
  minWidth?: number
}) {
  const [open, setOpen] = useState(false)

  // Esc closes the popover and nothing else — capture phase so the
  // drawer / builder Esc handlers (bubble on window) never see it.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setOpen(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open])

  return (
    <span className="menu-wrap" style={{ position: 'relative', display: 'inline-flex' }}>
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 55 }} />
          <div
            className="pop"
            style={{ top: 'calc(100% + 6px)', [align]: 0, minWidth }}
            onClick={(e) => e.stopPropagation()}
          >
            {children(() => setOpen(false))}
          </div>
        </>
      )}
    </span>
  )
}

export function AddRuleMenu({ vocab, onAdd }: { vocab: SmartVocab; onAdd: (r: Rule) => void }) {
  const { t } = useTranslation()
  return (
    <Menu
      trigger={({ toggle }) => (
        <button className="rule-add" onClick={toggle}>
          <SIcon n="plus" s={12} />
          {t('smart.addRule')}
        </button>
      )}
    >
      {(close) => (
        <>
          <div className="pop-label">{t('smart.addCondition')}</div>
          {RULE_KEY_LIST.map((k) => (
            <button
              key={k}
              className="pop-opt"
              onClick={() => {
                onAdd(newRule(k, vocab))
                close()
              }}
            >
              <SIcon n={RULE_META[k].ico} s={14} />
              {smartLabel(k)}
            </button>
          ))}
        </>
      )}
    </Menu>
  )
}

export const SORTS = ['Newest first', 'Oldest first', 'Name A–Z', 'Source']

export function SortMenu({
  sort,
  sorts,
  onSort,
}: {
  sort: string
  sorts: string[]
  onSort: (s: string) => void
}) {
  const { t } = useTranslation()
  return (
    <Menu
      align="right"
      minWidth={172}
      trigger={({ toggle }) => (
        <button className="sf-sort" onClick={toggle}>
          <SIcon n="sort" s={13} />
          {t('smart.sortPrefix')} <b>{smartLabel(sort)}</b>
        </button>
      )}
    >
      {(close) => (
        <>
          <div className="pop-label">{t('smart.sortBy')}</div>
          {sorts.map((s) => (
            <button
              key={s}
              className={cn('pop-opt', s === sort && 'sel')}
              onClick={() => {
                onSort(s)
                close()
              }}
            >
              {smartLabel(s)}
              {s === sort && <SIcon n="check" s={14} cls="tick" />}
            </button>
          ))}
        </>
      )}
    </Menu>
  )
}

/** Builder's key / op / value select button. */
export function SelBtn({
  cls,
  value,
  options,
  onPick,
}: {
  cls: string
  value: string
  options: string[]
  onPick: (v: string) => void
}) {
  return (
    <Menu
      minWidth={170}
      trigger={({ toggle }) => (
        <button className={'sel-btn ' + cls} onClick={toggle}>
          <span>{smartLabel(value)}</span>
          <SIcon n="caret" s={13} cls="rc-caret" />
        </button>
      )}
    >
      {(close) => (
        <>
          {options.map((o) => (
            <button
              key={o}
              className={cn('pop-opt', o === value && 'sel')}
              onClick={() => {
                onPick(o)
                close()
              }}
            >
              {smartLabel(o)}
              {o === value && <SIcon n="check" s={14} cls="tick" />}
            </button>
          ))}
        </>
      )}
    </Menu>
  )
}
