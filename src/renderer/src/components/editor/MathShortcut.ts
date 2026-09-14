import { Extension, InputRule } from '@tiptap/core'

/* ============================================================
   Typing `$$` on an otherwise-empty line turns it into a block
   equation and opens the equation editor — the same entry point
   as the `/equation` slash command. (A `$$…$$` mid-sentence still
   becomes inline math via the mathematics extension's own rule;
   this only fires when the line holds nothing but `$$`.)
   ============================================================ */

export const MathShortcut = Extension.create({
  name: 'mathShortcut',

  addInputRules() {
    return [
      new InputRule({
        find: /^\$\$$/,
        handler: ({ state, range }) => {
          const type = state.schema.nodes.blockMath
          if (!type) return

          const $from = state.doc.resolve(range.from)
          // Fire only when the line is exactly "$$". Tiptap matches the text
          // *before* the caret, so without this a "$$" typed ahead of other text
          // on the line would split the paragraph and misplace the node — so
          // require the whole host textblock to be replaceable by a block node.
          const consumesHostTextblock =
            $from.depth > 0 &&
            $from.parent.isTextblock &&
            range.from === $from.start() &&
            range.to === $from.end()
          const canReplaceHost =
            consumesHostTextblock &&
            $from.node(-1).canReplaceWith($from.index(-1), $from.indexAfter(-1), type)
          if (!canReplaceHost) return

          // Swap the whole paragraph for the block node; it then starts at
          // $from.before(), where we open the editor once the tx has committed
          // and the NodeView is mounted.
          const { tr } = state
          const pos = $from.before()
          tr.replaceWith(pos, $from.after(), type.create({ latex: '' }))
          requestAnimationFrame(() => {
            window.dispatchEvent(
              new CustomEvent('melo:math-edit', {
                detail: { pos, latex: '', block: true, fresh: true },
              }),
            )
          })
        },
      }),
    ]
  },
})
