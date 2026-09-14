import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'
import './button.scss'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary'
}

/** Shared desktop action button built on Melo's design tokens. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'secondary', className, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn('ui-button', `ui-button-${variant}`, className)}
      {...props}
    />
  ),
)

Button.displayName = 'Button'
