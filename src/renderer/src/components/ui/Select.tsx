import type { ReactNode } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import * as Tooltip from '@radix-ui/react-tooltip'
import { Icon } from '../Icon'
import { cn } from '../../lib/cn'
import './select.scss'

export interface Option<T extends string> {
  value: T
  label: string
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  onOpenChange,
  disabled = false,
  label,
  icon,
  className,
  contentClassName,
  side,
  align = 'end',
  description,
  descriptionLabel,
  action,
  loading = false,
  placeholder,
  emptyText,
  displayValue,
}: {
  value: T
  options: Option<T>[]
  onOpenChange?: (open: boolean) => void
  onChange?: (v: T) => void
  disabled?: boolean
  label?: string
  icon?: ReactNode
  className?: string
  contentClassName?: string
  side?: DropdownMenu.DropdownMenuContentProps['side']
  align?: DropdownMenu.DropdownMenuContentProps['align']
  description?: string
  descriptionLabel?: string
  action?: { label: string; onSelect(): void; closeOnSelect?: boolean }
  loading?: boolean
  placeholder?: string
  emptyText?: string
  displayValue?: string
}) {
  const current = options.find((o) => o.value === value) ?? options[0]
  return (
    <DropdownMenu.Root onOpenChange={onOpenChange}>
      <DropdownMenu.Trigger
        className={cn('sel-btn', className)}
        disabled={disabled}
        aria-label={label}
        title={displayValue ?? current?.label ?? placeholder}
      >
        {icon && <span className="sel-icon">{icon}</span>}
        <span className="sel-value">{displayValue ?? current?.label ?? placeholder ?? ''}</span>
        <span className="sel-chev">
          <Icon name="chev" size={12} />
        </span>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className={cn('sel-pop', contentClassName)}
          side={side}
          align={align}
          sideOffset={5}
          collisionPadding={12}
          aria-busy={loading || undefined}
        >
          {(label || description) && (
            <DropdownMenu.Label className={cn('sel-label', description && 'sel-label-help')}>
              {label}
            </DropdownMenu.Label>
          )}
          {loading && (
            <div className="sel-loading" role="status">
              <span className="sel-spinner" aria-hidden="true" />
              {emptyText}
            </div>
          )}
          {!loading && !options.length && emptyText && (
            <div className="sel-description" role="status">
              {emptyText}
            </div>
          )}
          {!loading &&
            options.map((o) => (
              <DropdownMenu.Item
                key={o.value}
                className={cn('sel-opt', o.value === value && 'sel-active')}
                onSelect={() => onChange?.(o.value)}
              >
                <span>{o.label}</span>
                <span className="sel-ck">
                  <Icon name="tick" size={14} />
                </span>
              </DropdownMenu.Item>
            ))}
          {!loading && action && (
            <>
              <DropdownMenu.Separator className="sel-separator" />
              <DropdownMenu.Item
                className="sel-opt"
                onSelect={(event) => {
                  if (action.closeOnSelect === false) event.preventDefault()
                  action.onSelect()
                }}
              >
                {action.label}
              </DropdownMenu.Item>
            </>
          )}
          {/* Keep help last in keyboard order so opening the menu focuses an option. */}
          {description && (
            <Tooltip.Provider delayDuration={300}>
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <DropdownMenu.Item
                    className="sel-help"
                    aria-label={descriptionLabel ?? description}
                    onSelect={(event) => event.preventDefault()}
                  >
                    <Icon name="info" size={14} />
                  </DropdownMenu.Item>
                </Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Content
                    className="sel-help-tooltip"
                    side="top"
                    align="end"
                    sideOffset={8}
                    collisionPadding={12}
                  >
                    {description}
                  </Tooltip.Content>
                </Tooltip.Portal>
              </Tooltip.Root>
            </Tooltip.Provider>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
