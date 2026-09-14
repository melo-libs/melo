import type { AutoUpdateOptions, UseDismissProps, UseFloatingOptions } from '@floating-ui/react'
import {
  autoUpdate,
  useDismiss,
  useFloating,
  useInteractions,
  useTransitionStyles,
} from '@floating-ui/react'
import { useEffect, useMemo, type CSSProperties, type HTMLProps } from 'react'

interface FloatingElementReturn {
  /** Whether the floating element is currently mounted in the DOM. */
  isMounted: boolean
  /** Ref function to attach to the floating element DOM node. */
  ref: (node: HTMLElement | null) => void
  /** Combined styles for positioning, transitions, and z-index. */
  style: CSSProperties
  /** Props to spread onto the floating element. */
  getFloatingProps: (userProps?: HTMLProps<HTMLElement>) => Record<string, unknown>
  /** Props to spread onto the reference element. */
  getReferenceProps: (userProps?: HTMLProps<Element>) => Record<string, unknown>
}

/**
 * Position a floating element relative to a reference. The reference may be a
 * real DOM element, a DOMRect, a function returning a DOMRect, or null.
 *
 * Note: the transition styles come from `useTransitionStyles` with NO config
 * (opacity-only) and `floatingStyles` is spread AFTER them — floating-ui owns
 * the positioning `transform`, so the transition must never set its own.
 */
export function useFloatingElement(
  show: boolean,
  reference: HTMLElement | DOMRect | (() => DOMRect | null) | null,
  zIndex: number,
  options?: Partial<UseFloatingOptions & { dismissOptions?: UseDismissProps }>,
  autoUpdateOptions?: AutoUpdateOptions,
): FloatingElementReturn {
  const { dismissOptions, ...floatingOptions } = options || {}

  const { refs, context, floatingStyles } = useFloating({
    open: show,
    whileElementsMounted(referenceEl, floatingEl, update) {
      return autoUpdate(referenceEl, floatingEl, update, autoUpdateOptions)
    },
    ...floatingOptions,
  })

  const { isMounted, styles } = useTransitionStyles(context)
  const dismiss = useDismiss(context, dismissOptions)
  const { getReferenceProps, getFloatingProps } = useInteractions([dismiss])

  useEffect(() => {
    if (reference === null) {
      refs.setReference(null)
      return
    }
    // A real DOM element is used directly; autoUpdate observes it.
    if (reference instanceof HTMLElement) {
      refs.setReference(reference)
      return
    }
    const getBoundingClientRect = () => {
      const rect = typeof reference === 'function' ? reference() : reference
      return rect || new DOMRect()
    }
    refs.setReference({ getBoundingClientRect })
  }, [reference, refs])

  return useMemo(
    () => ({
      isMounted,
      ref: refs.setFloating,
      style: { ...styles, ...floatingStyles, zIndex },
      getFloatingProps,
      getReferenceProps,
    }),
    [
      floatingStyles,
      isMounted,
      refs.setFloating,
      styles,
      zIndex,
      getFloatingProps,
      getReferenceProps,
    ],
  )
}
