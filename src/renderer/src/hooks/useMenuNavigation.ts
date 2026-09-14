import { useEffect, useState } from 'react'
import type { Editor } from '@tiptap/core'

type Orientation = 'horizontal' | 'vertical' | 'both'

interface MenuNavigationOptions<T> {
  /** The Tiptap editor instance whose DOM receives the key events. */
  editor?: Editor | null
  /** Container element to attach key events to, when not using an editor. */
  containerRef?: React.RefObject<HTMLElement | null>
  /** Search query — changing it resets the selection. */
  query?: string
  /** Items to navigate through. */
  items: T[]
  /** Fired on Enter. */
  onSelect?: (item: T) => void
  /** Fired on Escape. */
  onClose?: () => void
  /** Navigation orientation. @default "vertical" */
  orientation?: Orientation
  /** Auto-select the first item when the menu opens. @default true */
  autoSelectFirstItem?: boolean
}

/**
 * Keyboard navigation for dropdown menus / command palettes. Handles arrows,
 * Tab, Home/End, Enter (with IME `isComposing` guard) and Escape via a
 * capture-phase listener, so it wins over the editor's own keymap.
 *
 * Note: handled keys also `stopImmediatePropagation`.
 * ProseMirror registers its keydown handler in the bubble phase and does NOT
 * honour `defaultPrevented`, so a bare `preventDefault` still lets the keymap
 * run (Enter → splitBlock). Stopping propagation in capture is what actually
 * keeps the key from reaching the editor.
 */
export function useMenuNavigation<T>({
  editor,
  containerRef,
  query,
  items,
  onSelect,
  onClose,
  orientation = 'vertical',
  autoSelectFirstItem = true,
}: MenuNavigationOptions<T>) {
  const [selectedIndex, setSelectedIndex] = useState<number>(autoSelectFirstItem ? 0 : -1)

  useEffect(() => {
    const handleKeyboardNavigation = (event: KeyboardEvent) => {
      if (!items.length) return false

      const moveNext = () =>
        setSelectedIndex((currentIndex) => {
          if (currentIndex === -1) return 0
          return (currentIndex + 1) % items.length
        })

      const movePrev = () =>
        setSelectedIndex((currentIndex) => {
          if (currentIndex === -1) return items.length - 1
          return (currentIndex - 1 + items.length) % items.length
        })

      switch (event.key) {
        case 'ArrowUp': {
          if (orientation === 'horizontal') return false
          event.preventDefault()
          event.stopImmediatePropagation()
          movePrev()
          return true
        }
        case 'ArrowDown': {
          if (orientation === 'horizontal') return false
          event.preventDefault()
          event.stopImmediatePropagation()
          moveNext()
          return true
        }
        case 'ArrowLeft': {
          if (orientation === 'vertical') return false
          event.preventDefault()
          event.stopImmediatePropagation()
          movePrev()
          return true
        }
        case 'ArrowRight': {
          if (orientation === 'vertical') return false
          event.preventDefault()
          event.stopImmediatePropagation()
          moveNext()
          return true
        }
        case 'Tab': {
          event.preventDefault()
          event.stopImmediatePropagation()
          if (event.shiftKey) movePrev()
          else moveNext()
          return true
        }
        case 'Home': {
          event.preventDefault()
          event.stopImmediatePropagation()
          setSelectedIndex(0)
          return true
        }
        case 'End': {
          event.preventDefault()
          event.stopImmediatePropagation()
          setSelectedIndex(items.length - 1)
          return true
        }
        case 'Enter': {
          if (event.isComposing) return false
          event.preventDefault()
          event.stopImmediatePropagation()
          if (selectedIndex !== -1 && items[selectedIndex]) {
            onSelect?.(items[selectedIndex])
          }
          return true
        }
        case 'Escape': {
          event.preventDefault()
          event.stopImmediatePropagation()
          onClose?.()
          return true
        }
        default:
          return false
      }
    }

    let targetElement: HTMLElement | null = null
    if (editor) {
      targetElement = editor.view.dom as HTMLElement
    } else if (containerRef?.current) {
      targetElement = containerRef.current
    }

    if (targetElement) {
      targetElement.addEventListener('keydown', handleKeyboardNavigation, true)
      return () => {
        targetElement?.removeEventListener('keydown', handleKeyboardNavigation, true)
      }
    }
    return undefined
  }, [editor, containerRef, items, selectedIndex, onSelect, onClose, orientation])

  useEffect(() => {
    if (query) {
      setSelectedIndex(autoSelectFirstItem ? 0 : -1)
    }
  }, [query, autoSelectFirstItem])

  return {
    selectedIndex: items.length ? selectedIndex : undefined,
    setSelectedIndex,
  }
}
