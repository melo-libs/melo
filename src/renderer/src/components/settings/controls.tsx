import type { ReactNode } from 'react'
import * as Switch from '@radix-ui/react-switch'
import * as ToggleGroup from '@radix-ui/react-toggle-group'
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
  disabled = false,
}: {
  value: T
  options: Option<T>[]
  onChange: (v: T) => void
  disabled?: boolean
}) {
  return (
    <ToggleGroup.Root
      type="single"
      className="seg"
      disabled={disabled}
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

export { Select } from '../ui/Select'
