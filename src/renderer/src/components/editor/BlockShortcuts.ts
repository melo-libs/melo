import { Extension } from '@tiptap/core'
import { duplicateCurrentBlock } from './blockCommands'

/** Block-level keyboard shortcuts. The block menu advertises ⌘D next to
 *  Duplicate, so it has to actually exist. */
export const BlockShortcuts = Extension.create({
  name: 'blockShortcuts',

  addKeyboardShortcuts() {
    return {
      'Mod-d': ({ editor }) => duplicateCurrentBlock(editor),
    }
  },
})
