import { useEffect, useRef } from 'react'

/* ============================================================
   NameInput — the inline name editor used for renaming a tree
   row and for creating a new note. Enter commits, Esc / blur
   cancels; on mount the base name (sans extension) is selected.
   ============================================================ */

export const NameInput = ({
  defaultValue = '',
  placeholder,
  onCommit,
}: {
  defaultValue?: string
  placeholder?: string
  /** Called once with the typed name, or null when cancelled. */
  onCommit: (name: string | null) => void
}) => {
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)

  const commit = (value: string | null) => {
    if (done.current) return
    done.current = true
    onCommit(value)
  }

  useEffect(() => {
    const place = () => {
      const el = ref.current
      if (!el) return
      el.focus()
      // Select the base name so typing replaces it but the extension survives.
      const dot = defaultValue.lastIndexOf('.')
      el.setSelectionRange(0, dot > 0 ? dot : defaultValue.length)
    }
    place()
    // The context menu that opened us restores focus while closing — claim
    // it once more on the next frame so the caret actually lands here.
    const raf = requestAnimationFrame(place)

    // Clicking anywhere outside cancels, independent of focus/blur.
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) commit(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('mousedown', onDown)
    }
    // Mount-only on purpose: select once, then leave the user's caret alone.
  }, []) // eslint-disable-line

  return (
    <input
      ref={ref}
      className="tree-name-input"
      defaultValue={defaultValue}
      placeholder={placeholder}
      spellCheck={false}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') commit(ref.current?.value.trim() || null)
        else if (e.key === 'Escape') commit(null)
      }}
      onBlur={() => commit(null)}
    />
  )
}
