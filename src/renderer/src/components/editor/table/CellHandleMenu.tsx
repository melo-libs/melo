import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import i18n from '../../../i18n'
import type { Editor } from '@tiptap/react'
import { CellSelection, cellAround } from '@tiptap/pm/tables'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'

import { setCellAttr } from './tableUtils'
import { Icon, type IconName } from '../../Icon'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CellHandleMenuProps {
  editor: Editor
  onOpenChange?: (open: boolean) => void
}

interface ActionItem {
  icon: IconName
  label: string
  action: () => void
  disabled?: boolean
}

// ---------------------------------------------------------------------------
// Actions hook
// ---------------------------------------------------------------------------

// Merge/split is deliberately absent: documents persist as GFM pipe
// tables, which cannot express col/rowspan — a merge would silently
// shred on save (same "UI must not lie" call as multicolor highlight).
function useCellActions(editor: Editor) {
  const { i18n: i18nSub } = useTranslation()
  const clearAction = useMemo((): ActionItem => {
    return {
      icon: 'eraser',
      label: i18n.t('table.clearContent'),
      action: () => {
        const { state: s } = editor
        const { selection } = s
        const tr = s.tr

        if (selection instanceof CellSelection) {
          selection.forEachCell((cell, pos) => {
            const emptyParagraph = s.schema.nodes.paragraph.create()
            tr.replaceWith(pos + 1, pos + cell.nodeSize - 1, emptyParagraph)
          })
        } else {
          const cell = cellAround(selection.$anchor)
          if (cell) {
            const cellNode = s.doc.nodeAt(cell.pos)
            if (cellNode) {
              const emptyParagraph = s.schema.nodes.paragraph.create()
              tr.replaceWith(cell.pos + 1, cell.pos + cellNode.nodeSize - 1, emptyParagraph)
            }
          }
        }

        if (tr.docChanged) editor.view.dispatch(tr)
      },
    }
  }, [editor, i18nSub.language])

  const alignActions = useMemo((): ActionItem[] => {
    return [
      {
        icon: 'alignLeft',
        label: i18n.t('table.alignLeft'),
        action: () => setCellAttr('align', 'left')(editor.state, editor.view.dispatch),
      },
      {
        icon: 'alignCenter',
        label: i18n.t('table.alignCenter'),
        action: () => setCellAttr('align', 'center')(editor.state, editor.view.dispatch),
      },
      {
        icon: 'alignRight',
        label: i18n.t('table.alignRight'),
        action: () => setCellAttr('align', 'right')(editor.state, editor.view.dispatch),
      },
    ]
  }, [editor, i18nSub.language])

  return { clearAction, alignActions }
}

// ---------------------------------------------------------------------------
// CellHandleMenu component
// ---------------------------------------------------------------------------

export function CellHandleMenu({ editor, onOpenChange }: CellHandleMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const actions = useCellActions(editor)

  const handleOpenChange = useCallback(
    (open: boolean) => {
      setIsOpen(open)
      onOpenChange?.(open)
      if (open) {
        editor.commands.freezeHandles()
      } else {
        editor.commands.unfreezeHandles()
      }
    },
    [editor, onOpenChange],
  )

  return (
    <DropdownMenu.Root open={isOpen} onOpenChange={handleOpenChange}>
      <DropdownMenu.Trigger asChild>
        <button
          className={`expandable-menu-button${isOpen ? ' menu-opened' : ''}`}
          aria-label={i18n.t('table.cellOptions')}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <Icon name="grip4" size={10} />
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="table-handle-dropdown"
          side="bottom"
          align="start"
          sideOffset={4}
        >
          {/* Alignment */}
          {actions.alignActions.map((item) => (
            <DropdownMenu.Item key={item.label} onSelect={item.action}>
              <Icon name={item.icon} size={15} />
              <span>{item.label}</span>
            </DropdownMenu.Item>
          ))}
          <DropdownMenu.Separator />

          {/* Clear */}
          <DropdownMenu.Item onSelect={actions.clearAction.action}>
            <Icon name={actions.clearAction.icon} size={15} />
            <span>{actions.clearAction.label}</span>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
