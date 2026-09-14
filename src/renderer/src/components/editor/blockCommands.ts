import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Selection, TextSelection } from '@tiptap/pm/state'
import type { BlockType } from './sampleDoc'

/* ============================================================
   Shared block-level commands used by the bubble menu (acts on the
   selection) and the block / drag-handle menu (acts on a position).
   ============================================================ */

/** Block type at the current selection. */
export function currentBlockType(editor: Editor): BlockType {
  if (editor.isActive('heading', { level: 1 })) return 'h1'
  if (editor.isActive('heading', { level: 2 })) return 'h2'
  if (editor.isActive('heading', { level: 3 })) return 'h3'
  if (editor.isActive('taskList')) return 'task'
  if (editor.isActive('bulletList')) return 'bullet'
  if (editor.isActive('orderedList')) return 'num'
  if (editor.isActive('blockquote')) return 'quote'
  if (editor.isActive('codeBlock')) return 'code'
  return 'p'
}

/**
 * Convert the block at the current selection to `type`. clearNodes() first
 * lifts out of any list / quote / code wrapper (e.g. setHeading is invalid
 * directly inside a list item). No-op when already that type.
 */
export function turnInto(editor: Editor, type: BlockType) {
  if (currentBlockType(editor) === type) return
  const c = editor.chain().focus().clearNodes()
  switch (type) {
    case 'p':
      c.setParagraph().run()
      break
    case 'h1':
      c.setHeading({ level: 1 }).run()
      break
    case 'h2':
      c.setHeading({ level: 2 }).run()
      break
    case 'h3':
      c.setHeading({ level: 3 }).run()
      break
    case 'bullet':
      c.toggleBulletList().run()
      break
    case 'num':
      c.toggleOrderedList().run()
      break
    case 'task':
      c.toggleTaskList().run()
      break
    case 'quote':
      c.toggleBlockquote().run()
      break
    case 'code':
      c.toggleCodeBlock().run()
      break
    default:
      break
  }
}

/* ---- Position-based ops for the block / drag-handle menu ---- */

/** Block type of a top-level node (block-menu active state). */
export function blockTypeOf(node: PMNode): BlockType | null {
  switch (node.type.name) {
    case 'paragraph':
      return 'p'
    case 'heading':
      // h4–h6 have no BlockType id; the menu just shows no active row.
      return ((['h1', 'h2', 'h3'] as const)[(node.attrs.level as number) - 1] ??
        null) as BlockType | null
    case 'bulletList':
      return 'bullet'
    case 'orderedList':
      return 'num'
    case 'taskList':
      return 'task'
    case 'blockquote':
      return 'quote'
    case 'codeBlock':
      return 'code'
    default:
      return null
  }
}

const TURNABLE_WRAPPERS = new Set(['bulletList', 'orderedList', 'taskList', 'blockquote'])

/** Whether the block-menu "turn into" section applies to this block.
 *  Text blocks and list/quote wrappers convert; leaves (hr, math) and
 *  tables don't. */
export function canTurnBlock(node: PMNode): boolean {
  return node.isTextblock || TURNABLE_WRAPPERS.has(node.type.name)
}

/** Convert the block at `pos` to `type`. Selects the block's whole content
 *  first so wrapper blocks (multi-item lists, quotes) convert wholly, not
 *  just the line the caret happens to land on. */
export function turnBlockInto(editor: Editor, pos: number, node: PMNode, type: BlockType) {
  const { state, view } = editor
  view.focus()
  // TextSelection.between (not setTextSelection, which doesn't snap): for
  // wrapper blocks pos+1 sits on the ul/blockquote boundary, not in inline
  // content, and a TextSelection endpoint there is invalid.
  view.dispatch(
    state.tr.setSelection(
      TextSelection.between(state.doc.resolve(pos + 1), state.doc.resolve(pos + node.nodeSize - 1)),
    ),
  )
  turnInto(editor, type)
  // Collapse the working selection to a caret — leaving the block's content
  // selected would pop the bubble menu over the freshly converted block.
  const after = editor.state
  view.dispatch(after.tr.setSelection(Selection.near(after.doc.resolve(after.selection.from))))
}

/** Insert a copy of the block right after itself. */
export function duplicateBlock(editor: Editor, pos: number, node: PMNode) {
  editor
    .chain()
    .focus()
    .insertContentAt(pos + node.nodeSize, node.toJSON())
    .run()
}

/** Remove the block at `pos`. */
export function deleteBlock(editor: Editor, pos: number, node: PMNode) {
  editor
    .chain()
    .focus()
    .deleteRange({ from: pos, to: pos + node.nodeSize })
    .run()
}

/** Duplicate the top-level block containing the selection (⌘D). */
export function duplicateCurrentBlock(editor: Editor): boolean {
  const { selection, doc } = editor.state
  const pos = selection.$from.depth ? selection.$from.before(1) : selection.from
  const node = doc.nodeAt(pos)
  if (!node) return false
  duplicateBlock(editor, pos, node)
  return true
}

/** Serialize one block to Markdown (block-menu "Copy as Markdown"). */
export function blockMarkdown(editor: Editor, node: PMNode): string {
  const manager = editor.storage.markdown?.manager
  const md = manager?.serialize(node.toJSON())
  return md?.trim() || node.textContent
}
