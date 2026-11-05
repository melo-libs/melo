import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { FloatingPortal, autoUpdate, flip, offset, shift, useFloating } from '@floating-ui/react'
import { useTranslation } from 'react-i18next'
import { useAtomValue, useSetAtom } from 'jotai'
import { normalizeTags, readDocumentTags } from '@shared/documentTags'
import { IpcChannels } from '@shared/types/ipc'
import { getSessionTagEditor } from '../../store/documentSession'
import { searchOpenAtom, searchPrefillAtom, workspacePathAtom } from '../../store/workspace'
import { tagSearchQuery } from '../search/searchTokens'
import { Icon } from '../Icon'
import './document-tags.scss'

export function DocumentTags({ id, frontmatter }: { id: string; frontmatter: string }) {
  const { t } = useTranslation()
  const workspace = useAtomValue(workspacePathAtom)
  const inWorkspace = !!workspace && id.startsWith(workspace + '/')
  const setSearchOpen = useSetAtom(searchOpenAtom)
  const setSearchPrefill = useSetAtom(searchPrefillAtom)
  const parsed = useMemo(() => {
    try {
      return { tags: readDocumentTags(frontmatter), invalid: false }
    } catch {
      return { tags: [], invalid: true }
    }
  }, [frontmatter])
  const [editor] = useState(() => getSessionTagEditor(id, { frontmatter, tags: parsed.tags }))
  const state = useSyncExternalStore(editor.subscribe, editor.getSnapshot)
  const [editing, setEditing] = useState(false)
  const [input, setInput] = useState('')
  const [selectedTag, setSelectedTag] = useState<string | null>(null)
  const [active, setActive] = useState(0)
  const [validationError, setValidationError] = useState('')
  const [vocabulary, setVocabulary] = useState<{ tag: string; count: number }[]>([])
  const [vocabularyFailed, setVocabularyFailed] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const rowRef = useRef<HTMLDivElement | null>(null)
  const addRef = useRef<HTMLButtonElement>(null)
  const restoreFocus = useRef(false)
  const listId = useId()
  const query = normalizeTags([input])[0] ?? ''
  const candidates = useMemo(() => {
    const known = new Map(vocabulary.map((item) => [item.tag, item.count]))
    state.tags.forEach((tag) => {
      if (!known.has(tag)) known.set(tag, 0)
    })
    const items = [...known]
      .filter(([tag]) => (query ? tag.includes(query) : !state.tags.includes(tag)))
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 6)
      .map(([tag, count]) => ({ tag, count, create: false }))
    if (query && !known.has(query)) items.push({ tag: query, count: 0, create: true })
    return items
  }, [vocabulary, state.tags, query])
  const available = candidates
    .map((item, index) => (!state.tags.includes(item.tag) ? index : -1))
    .filter((index) => index >= 0)
  const activeIndex = available.includes(active) ? active : available[0]
  const showSuggestions = editing && !selectedTag && !parsed.invalid && candidates.length > 0
  const { refs, floatingStyles } = useFloating({
    open: showSuggestions,
    placement: 'bottom-start',
    middleware: [offset(8), flip(), shift({ padding: 12 })],
    whileElementsMounted: autoUpdate,
  })
  const finish = () => {
    setEditing(false)
    setInput('')
    setSelectedTag(null)
    setValidationError('')
  }
  const begin = () => {
    setEditing(true)
    setSelectedTag(null)
  }

  useEffect(() => {
    editor.sync({ frontmatter, tags: parsed.tags })
  }, [editor, frontmatter, parsed.tags, state.saving])
  useEffect(() => {
    window.addEventListener('melo:edit-tags', begin)
    return () => window.removeEventListener('melo:edit-tags', begin)
  }, [])
  useEffect(() => {
    if (editing) inputRef.current?.focus()
    else if (restoreFocus.current) {
      restoreFocus.current = false
      addRef.current?.focus()
    }
  }, [editing])
  useEffect(() => {
    if (!editing || !inWorkspace) return
    let alive = true
    setVocabularyFailed(false)
    window.api
      .invoke(IpcChannels.InvokeGetAllTags, undefined)
      .then((result) => {
        if (!alive) return
        if (result.success && result.data) setVocabulary(result.data.tags)
        else setVocabularyFailed(true)
      })
      .catch(() => {
        if (alive) setVocabularyFailed(true)
      })
    return () => {
      alive = false
    }
  }, [editing, inWorkspace, workspace])
  useEffect(() => {
    if (!editing) return
    const outside = (event: PointerEvent | FocusEvent) => {
      const target = event.target as Node
      if (!rowRef.current?.contains(target) && !refs.floating.current?.contains(target)) finish()
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('focusin', outside)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('focusin', outside)
    }
  }, [editing, refs.floating])

  const add = (tag: string) => {
    if (parsed.invalid) return
    if (
      tag.length > 100 ||
      /[\r\n]/.test(tag) ||
      (state.tags.length >= 100 && !state.tags.includes(tag))
    ) {
      setValidationError(t('documentTags.invalidTag'))
      return
    }
    if (tag) editor.setTags(normalizeTags([...state.tags, tag]))
    setInput('')
    setActive(0)
    setSelectedTag(null)
    setValidationError('')
    inputRef.current?.focus()
  }
  const remove = (tag: string) => {
    if (parsed.invalid) return
    editor.setTags(state.tags.filter((item) => item !== tag))
    setSelectedTag(null)
    if (editing) inputRef.current?.focus()
    else addRef.current?.focus()
  }
  const error = parsed.invalid
    ? t('documentTags.invalidMetadata')
    : state.error
      ? t(state.error === 'conflict' ? 'documentTags.changed' : 'documentTags.saveFailed')
      : validationError

  return (
    <div
      className="document-tags"
      data-empty={!state.tags.length || undefined}
      data-editing={editing || undefined}
      aria-busy={state.saving}
    >
      <div
        className="document-tags-row"
        ref={(element) => {
          rowRef.current = element
          refs.setReference(element)
        }}
        onClick={(event) => {
          if (editing && event.target === event.currentTarget) inputRef.current?.focus()
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && !input) {
            event.stopPropagation()
            event.preventDefault()
            if (parsed.invalid) return
            if (event.shiftKey) editor.redo()
            else editor.undo()
            setSelectedTag(null)
          } else if (editing && event.key === 'Escape') {
            event.stopPropagation()
            event.preventDefault()
            restoreFocus.current = true
            finish()
          }
        }}
      >
        {state.tags.map((tag) => (
          <span className="document-tag" data-selected={selectedTag === tag || undefined} key={tag}>
            {editing ? (
              <span>#{tag}</span>
            ) : (
              <button
                className="document-tag-label"
                disabled={!inWorkspace}
                title={t('documentTags.find', { tag })}
                onClick={() => {
                  setSearchPrefill(tagSearchQuery(tag) + ' ')
                  setSearchOpen(true)
                }}
              >
                #{tag}
              </button>
            )}
            <button
              className="document-tag-remove"
              type="button"
              disabled={parsed.invalid}
              aria-label={t('documentTags.remove', { tag })}
              onClick={() => remove(tag)}
            >
              <Icon name="x" size={12} />
            </button>
          </span>
        ))}
        {editing && (
          <input
            ref={inputRef}
            value={input}
            readOnly={parsed.invalid}
            maxLength={101}
            aria-label={t('documentTags.add')}
            placeholder={t('documentTags.placeholder')}
            role="combobox"
            aria-expanded={showSuggestions}
            aria-controls={showSuggestions ? listId : undefined}
            aria-activedescendant={
              showSuggestions && activeIndex !== undefined ? `${listId}-${activeIndex}` : undefined
            }
            aria-autocomplete="list"
            onChange={(event) => {
              setInput(event.target.value)
              setSelectedTag(null)
              setActive(0)
              setValidationError('')
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.keyCode === 229) return
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault()
                setSelectedTag(null)
                if (available.length) {
                  const position = available.indexOf(activeIndex)
                  setActive(
                    available[
                      (position + (event.key === 'ArrowDown' ? 1 : -1) + available.length) %
                        available.length
                    ],
                  )
                }
              } else if (event.key === 'Enter') {
                event.preventDefault()
                if (activeIndex !== undefined && !selectedTag) add(candidates[activeIndex].tag)
                else if (query) add(query)
              } else if (event.key === 'Backspace' && !input) {
                event.preventDefault()
                if (event.repeat) return
                if (selectedTag) remove(selectedTag)
                else setSelectedTag(state.tags.at(-1) ?? null)
              } else if (
                event.key !== 'Backspace' &&
                event.key !== 'Shift' &&
                event.key !== 'Meta' &&
                event.key !== 'Control'
              ) {
                setSelectedTag(null)
              }
            }}
          />
        )}
        <button
          className="document-tags-add"
          ref={addRef}
          hidden={editing}
          type="button"
          onClick={begin}
          aria-label={t('documentTags.edit')}
        >
          <Icon name="plus" size={12} /> {!state.tags.length && t('documentTags.label')}
        </button>
      </div>
      {(error || (editing && (selectedTag || vocabularyFailed))) && (
        <div className="document-tags-hint" role={error ? 'alert' : 'status'}>
          {error ||
            (selectedTag
              ? t('documentTags.deleteHint', { tag: selectedTag })
              : t('documentTags.suggestionsFailed'))}
          {editing && selectedTag && (
            <span>
              <kbd>esc</kbd> {t('documentTags.done')}
            </span>
          )}
        </div>
      )}
      {showSuggestions && (
        <FloatingPortal>
          <div
            className="document-tags-suggestions"
            ref={refs.setFloating}
            style={floatingStyles}
            role="listbox"
            id={listId}
            aria-label={t('documentTags.suggestions')}
          >
            {candidates.map((item, index) => {
              const added = state.tags.includes(item.tag)
              return (
                <div
                  key={item.tag}
                  id={`${listId}-${index}`}
                  className="document-tags-option"
                  data-active={index === activeIndex || undefined}
                  data-create={item.create || undefined}
                  role="option"
                  aria-selected={index === activeIndex}
                  aria-disabled={added}
                  onPointerDown={(event) => {
                    event.preventDefault()
                    if (!added) add(item.tag)
                  }}
                  onPointerMove={() => {
                    if (!added) setActive(index)
                  }}
                >
                  <span>
                    {item.create ? t('documentTags.create', { tag: item.tag }) : `#${item.tag}`}
                  </span>
                  <span className="document-tags-option-detail">
                    {added ? (
                      <>
                        <Icon name="tick" size={12} /> {t('documentTags.added')}
                      </>
                    ) : item.create ? (
                      <kbd>↵</kbd>
                    ) : (
                      item.count
                    )}
                  </span>
                </div>
              )
            })}
          </div>
        </FloatingPortal>
      )}
    </div>
  )
}
