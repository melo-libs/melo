import { Extension } from '@tiptap/core'
import { Mark } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection, type Selection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import type { ResolvedPos } from '@tiptap/pm/model'

/**
 * Smooth (virtual) caret — a 2px accent bar with a breathing blink.
 *
 * Ported from `prosemirror-virtual-cursor`, with one deliberate change: the
 * caret element is appended to the editor's DOM parent instead of rendered as
 * a `Decoration.widget` at position 0. The upstream widget becomes
 * `.ProseMirror`'s `firstElementChild`, which breaks anything keying off the
 * first content block — notably `@tiptap/extension-drag-handle`, whose
 * `clampToContent` uses `firstElementChild.getBoundingClientRect()` as the
 * top-of-content reference. With an absolutely-positioned caret sitting there,
 * block-under-cursor detection fails and dragging silently no-ops. Keeping the
 * caret out of the content flow fixes the drag handle and removes the
 * `:first-child` CSS workarounds this widget used to force.
 */

const key = new PluginKey('smoothCaret')

function getCursorRect(
  view: EditorView,
  toStart: boolean,
): { left: number; top: number; bottom: number } | null {
  const selection = window.getSelection()
  if (!selection || !selection.rangeCount) return null
  const range = selection.getRangeAt(0)?.cloneRange()
  if (!range) return null
  range.collapse(toStart)
  const rects = range.getClientRects()
  const rect = rects?.length ? rects[rects.length - 1] : null
  if (rect?.height) return rect
  // Fallback for positions the DOM range can't measure (e.g. empty blocks).
  return view.coordsAtPos(view.state.selection.head)
}

function getMarksAround(
  $pos: ResolvedPos,
): [readonly Mark[] | undefined, readonly Mark[] | undefined] {
  const index = $pos.index()
  const after = $pos.parent.maybeChild(index)
  let before = $pos.textOffset ? after : null
  if (!before && index > 0) before = $pos.parent.maybeChild(index - 1)
  return [before?.marks, after?.marks]
}

function isTextSelection(selection: Selection): selection is TextSelection {
  return selection instanceof TextSelection
}

function restartAnimation(element: HTMLElement, className: string) {
  element.classList.remove(className)
  void element.offsetWidth
  element.classList.add(className)
}

function updateCursor(view: EditorView, cursor: HTMLElement) {
  if (!view || !view.dom || view.isDestroyed) return
  const { state } = view
  const { selection } = state
  // Only show while ProseMirror itself holds focus and the caret is a
  // collapsed text selection. `hasFocus()` (not the wrapper's :focus-within)
  // avoids lighting up when focus is on an adjacent control, and keeps the
  // measured DOM range meaningfully inside the editor.
  if (!view.hasFocus() || !isTextSelection(selection) || !selection.empty) {
    cursor.style.display = 'none'
    return
  }
  const cursorRect = getCursorRect(view, selection.$head === selection.$from)
  if (!cursorRect) {
    cursor.style.display = 'none'
    return
  }
  const parent = cursor.parentElement
  if (!parent) return
  const parentRect = parent.getBoundingClientRect()

  let className = 'prosemirror-virtual-cursor'
  const $pos = selection.$head
  const [marksBefore, marksAfter] = getMarksAround($pos)
  const marks = state.storedMarks || $pos.marks()
  if (
    selection.$cursor &&
    marksBefore &&
    marksAfter &&
    marks &&
    !Mark.sameSet(marksBefore, marksAfter)
  ) {
    if (Mark.sameSet(marksBefore, marks)) className += ' prosemirror-virtual-cursor-left'
    else if (Mark.sameSet(marksAfter, marks)) className += ' prosemirror-virtual-cursor-right'
  }
  cursor.className = className
  cursor.style.display = ''
  restartAnimation(cursor, 'prosemirror-virtual-cursor-animation')
  cursor.style.height = `${cursorRect.bottom - cursorRect.top}px`
  cursor.style.left = `${cursorRect.left - parentRect.left}px`
  cursor.style.top = `${cursorRect.top - parentRect.top}px`
}

export const SmoothCaret = Extension.create({
  name: 'smoothCaret',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key,
        view: (view) => {
          const cursor = document.createElement('div')
          cursor.className = 'prosemirror-virtual-cursor'
          cursor.style.display = 'none'
          const host = view.dom.parentElement
          host?.appendChild(cursor)

          const doc = view.dom.ownerDocument
          const update = () => updateCursor(view, cursor)

          let observer: ResizeObserver | undefined
          if (window.ResizeObserver) {
            observer = new window.ResizeObserver(() => update())
            observer.observe(view.dom)
          }
          doc.addEventListener('selectionchange', update)
          // Focus/blur don't emit a transaction, so track them to show/hide
          // the caret in step with editor focus.
          view.dom.addEventListener('focus', update)
          view.dom.addEventListener('blur', update)

          return {
            update: () => update(),
            destroy: () => {
              doc.removeEventListener('selectionchange', update)
              view.dom.removeEventListener('focus', update)
              view.dom.removeEventListener('blur', update)
              observer?.unobserve(view.dom)
              cursor.remove()
            },
          }
        },
        props: {
          // Move the caret across a mark boundary before crossing the
          // character, so storedMarks track which side the caret sits on.
          handleKeyDown: (view, event) => {
            const { selection } = view.state
            if (
              event.altKey ||
              event.ctrlKey ||
              event.metaKey ||
              event.shiftKey ||
              event.isComposing ||
              !['ArrowLeft', 'ArrowRight'].includes(event.key) ||
              !isTextSelection(selection) ||
              !selection.empty
            )
              return false
            const $pos = selection.$head
            const [marksBefore, marksAfter] = getMarksAround($pos)
            const marks = view.state.storedMarks || $pos.marks()
            if (marksBefore && marksAfter && !Mark.sameSet(marksBefore, marksAfter)) {
              if (event.key === 'ArrowLeft' && !Mark.sameSet(marksBefore, marks)) {
                view.dispatch(view.state.tr.setStoredMarks(marksBefore))
                return true
              }
              if (event.key === 'ArrowRight' && !Mark.sameSet(marksAfter, marks)) {
                view.dispatch(view.state.tr.setStoredMarks(marksAfter))
                return true
              }
            }
            if (event.key === 'ArrowLeft' && $pos.textOffset === 1) {
              view.dispatch(
                view.state.tr
                  .setSelection(TextSelection.create(view.state.doc, $pos.pos - 1))
                  .setStoredMarks($pos.marks()),
              )
              return true
            }
            if (
              event.key === 'ArrowRight' &&
              $pos.textOffset + 1 === $pos.parent.maybeChild($pos.index())?.nodeSize
            ) {
              view.dispatch(
                view.state.tr
                  .setSelection(TextSelection.create(view.state.doc, $pos.pos + 1))
                  .setStoredMarks($pos.marks()),
              )
              return true
            }
            return false
          },
          attributes: {
            class: 'virtual-cursor-enabled',
          },
        },
      }),
    ]
  },
})
