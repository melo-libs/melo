import { useEffect, useMemo, useRef, useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import type { Editor, EditorEvents } from '@tiptap/react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/cn'
import { Icon } from '../Icon'
import { CODE_LANGUAGES } from './CodeBlock'

/* ============================================================
   CodeLangPicker — combobox for a code block's fence language.
   Opened by the block's chip via 'melo:code-lang'; Radix Popover
   owns layering / outside-press / Esc, the filter input owns the
   keyboard (↑↓ move, Enter picks the focused row). "plain" is row
   zero of the unfiltered list, and the current language starts
   focused, so a stray Enter re-commits the status quo instead of
   silently picking the alphabetically first language.
   ============================================================ */

interface PickerState {
  pos: number
  rect: DOMRect
  language: string
}

export const CodeLangPicker = ({ editor }: { editor: Editor }) => {
  const { t } = useTranslation()
  const [state, setState] = useState<PickerState | null>(null)
  const [query, setQuery] = useState('')
  const [focus, setFocus] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  // '' renders as "plain" (no fence language).
  const items = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? CODE_LANGUAGES.filter((l) => l.includes(q)) : ['', ...CODE_LANGUAGES]
  }, [query])

  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<PickerState>).detail
      setState(detail)
      setQuery('')
      const initial = ['', ...CODE_LANGUAGES].indexOf(detail.language)
      setFocus(initial === -1 ? 0 : initial)
    }
    window.addEventListener('melo:code-lang', onOpen)
    return () => window.removeEventListener('melo:code-lang', onOpen)
  }, [])

  // The snapshot pos goes stale the moment the doc changes underneath —
  // close instead of committing into the wrong block.
  useEffect(() => {
    if (!state) return
    const onUpdate = ({ transaction }: EditorEvents['update']) => {
      if (transaction.docChanged) setState(null)
    }
    editor.on('update', onUpdate)
    return () => {
      editor.off('update', onUpdate)
    }
  }, [state, editor])

  useEffect(() => {
    // Keep the focused row visible while arrowing through the list.
    listRef.current?.querySelector('[data-focus="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [focus])

  if (!state) return null

  const close = (refocusEditor: boolean) => {
    setState(null)
    // Only deliberate exits hand focus back — an outside click chose a
    // new focus target already; yanking it away would fight the user.
    if (refocusEditor) editor.commands.focus()
  }

  const commit = (language: string) => {
    const node = editor.state.doc.nodeAt(state.pos)
    if (node?.type.name === 'codeBlock' && (node.attrs.language ?? '') !== language) {
      editor.view.dispatch(
        editor.state.tr.setNodeMarkup(state.pos, undefined, { ...node.attrs, language }),
      )
    }
    close(true)
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setFocus((f) => Math.min(f + 1, items.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setFocus((f) => Math.max(f - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (items.length > 0) commit(items[Math.min(focus, items.length - 1)])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close(true)
    }
  }

  return (
    <Popover.Root open onOpenChange={(o) => !o && close(false)}>
      <Popover.Anchor asChild>
        <span
          style={{
            position: 'fixed',
            left: state.rect.left,
            top: state.rect.top,
            width: state.rect.width,
            height: state.rect.height,
            pointerEvents: 'none',
          }}
        />
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          className="lang-picker"
          side="bottom"
          align="end"
          sideOffset={4}
          onOpenAutoFocus={(e) => {
            // Focus the filter input, not the content wrapper.
            e.preventDefault()
            ;(e.currentTarget as HTMLElement | null)
              ?.querySelector<HTMLInputElement>('input')
              ?.focus()
          }}
        >
          <input
            className="lang-picker-input"
            placeholder={t('editor.searchLanguage')}
            value={query}
            spellCheck={false}
            onChange={(e) => {
              setQuery(e.target.value)
              setFocus(0)
            }}
            onKeyDown={onKey}
          />
          <div className="lang-picker-list" ref={listRef}>
            {items.map((l, i) => (
              <button
                key={l || 'plain'}
                className={cn('lang-picker-item', l === state.language && 'current')}
                data-focus={i === focus || undefined}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => commit(l)}
              >
                {l || t('editor.plainLanguage')}
                {l === state.language && <Icon name="tick" size={13} className="tick" />}
              </button>
            ))}
            {items.length === 0 && <div className="lang-picker-empty">{t('editor.noMatches')}</div>}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
