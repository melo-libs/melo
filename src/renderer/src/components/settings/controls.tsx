import type { ReactNode } from 'react'
import * as Switch from '@radix-ui/react-switch'
import * as ToggleGroup from '@radix-ui/react-toggle-group'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Icon } from '../Icon'
import { cn } from '../../lib/cn'

/* ============================================================
   Settings control primitives — ported from the design's
   settings/controls.jsx, rebuilt on Radix (house UI layer).
   Visual values come from settings.scss / app tokens.
   ============================================================ */

export const Section = ({ title, children }: { title?: string; children: ReactNode }) => (
  <div className="s-section">
    {title && <div className="s-section-title">{title}</div>}
    <div className="s-card">{children}</div>
  </div>
)

export const Row = ({
  label,
  desc,
  control,
  block,
  children,
}: {
  label?: string
  desc?: string
  control?: ReactNode
  block?: boolean
  children?: ReactNode
}) => (
  <div className={cn('s-row', block && 'block')}>
    {(label || desc) && (
      <div className="s-row-text">
        <div className="s-row-label">{label}</div>
        {desc && <div className="s-row-desc">{desc}</div>}
      </div>
    )}
    {control && <div className="s-row-control">{control}</div>}
    {block && children}
  </div>
)

export const Toggle = ({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) => (
  <Switch.Root className="sw" checked={on} onCheckedChange={onChange}>
    <Switch.Thumb className="sw-thumb" />
  </Switch.Root>
)

export interface Option<T extends string> {
  value: T
  label: string
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: Option<T>[]
  onChange: (v: T) => void
}) {
  return (
    <ToggleGroup.Root
      type="single"
      className="seg"
      value={value}
      onValueChange={(v) => {
        // Radix reports '' when the active item is re-clicked — a segmented
        // control always has a selection, so ignore that.
        if (v) onChange(v as T)
      }}
    >
      {options.map((o) => (
        <ToggleGroup.Item key={o.value} value={o.value} className="seg-opt">
          {o.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  )
}

export function Select<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: Option<T>[]
  onChange: (v: T) => void
}) {
  const current = options.find((o) => o.value === value) ?? options[0]
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="sel-btn">
        <span>{current?.label ?? ''}</span>
        <span className="sel-chev">
          <Icon name="chev" size={12} />
        </span>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="sel-pop" align="end" sideOffset={5} collisionPadding={12}>
          {options.map((o) => (
            <DropdownMenu.Item
              key={o.value}
              className={cn('sel-opt', o.value === value && 'sel-active')}
              onSelect={() => onChange(o.value)}
            >
              <span>{o.label}</span>
              <span className="sel-ck">
                <Icon name="tick" size={13} />
              </span>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
