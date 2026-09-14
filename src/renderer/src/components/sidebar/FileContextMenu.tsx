import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import * as ContextMenu from '@radix-ui/react-context-menu'
import { IpcChannels } from '@shared/types/ipc'
import { Icon, type IconName } from '../Icon'
import { FileTypeIcon } from '../FileTypeIcon'
import { cn } from '../../lib/cn'
import type { FileNode } from './types'

export type ContextAction = string // 'open' | 'rename' | 'move:<id>' | 'export:pdf' | ...

interface ItemProps {
  icon: IconName
  label: string
  kbd?: string
  danger?: boolean
  onSelect: () => void
}
const Item = ({ icon, label, kbd, danger, onSelect }: ItemProps) => (
  <ContextMenu.Item className={cn('ctx-item', danger && 'danger')} onSelect={onSelect}>
    <span className="ctx-ic">
      <Icon name={icon} size={14} />
    </span>
    <span className="ctx-lbl">{label}</span>
    {kbd && <span className="ctx-kbd">{kbd}</span>}
  </ContextMenu.Item>
)

export interface FileContextMenuProps {
  node: FileNode
  onAction: (action: ContextAction, node: FileNode) => void
  children: ReactNode
}

/** Right-click menu for a file-tree row (Radix ContextMenu). */
export const FileContextMenu = ({ node, onAction, children }: FileContextMenuProps) => {
  const { t } = useTranslation()
  const isFolder = node.kind === 'folder'
  const isClip = !!node.source?.url
  const act = (a: ContextAction) => () => onAction(a, node)

  // Probed when the menu opens — Paste is only offered when the OS
  // clipboard actually carries files (Finder copy).
  const [menuOpen, setMenuOpen] = useState(false)
  const [clipboardHasFiles, setClipboardHasFiles] = useState(false)
  const probeClipboard = (open: boolean) => {
    if (!open || !isFolder) return
    window.api.invoke(IpcChannels.InvokeCheckClipboardHasFiles, undefined).then((res) => {
      setClipboardHasFiles(res.success && res.data ? res.data.hasFiles : false)
    })
  }

  return (
    <ContextMenu.Root
      onOpenChange={(open) => {
        setMenuOpen(open)
        probeClipboard(open)
      }}
    >
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      {menuOpen && (
        <ContextMenu.Portal>
          <ContextMenu.Content
            className="ctx-menu"
            // Closing would refocus the trigger row, stealing focus from the
            // inline rename input that an item may have just opened.
            onCloseAutoFocus={(e) => e.preventDefault()}
          >
            <div className="ctx-head">
              <FileTypeIcon kind={node.kind} size={14} />
              <span className="ctx-head-name">{node.name}</span>
            </div>
            <ContextMenu.Separator className="ctx-sep" />

            {/* Folders hide the whole Open group — its separator goes with it,
              otherwise the header's divider doubles up. */}
            {!isFolder && (
              <>
                <Item icon="arrowRight" label={t('ctx.open')} kbd="↵" onSelect={act('open')} />
                <ContextMenu.Separator className="ctx-sep" />
              </>
            )}

            {isFolder && (
              <>
                <Item
                  icon="plus"
                  label={t('ctx.newNoteHere')}
                  kbd="⌘N"
                  onSelect={act('new-note-in')}
                />
                <Item
                  icon="folder"
                  label={t('ctx.newFolderHere')}
                  onSelect={act('new-folder-in')}
                />
                <ContextMenu.Item
                  className="ctx-item"
                  disabled={!clipboardHasFiles}
                  onSelect={act('paste')}
                >
                  <span className="ctx-ic">
                    <Icon name="paperclip" size={14} />
                  </span>
                  <span className="ctx-lbl">{t('ctx.pasteFiles')}</span>
                  <span className="ctx-kbd">⌘V</span>
                </ContextMenu.Item>
                <ContextMenu.Separator className="ctx-sep" />
              </>
            )}

            <Item icon="pencil" label={t('ctx.rename')} kbd="F2" onSelect={act('rename')} />
            <Item
              icon="duplicate"
              label={t('ctx.duplicate')}
              kbd="⌘D"
              onSelect={act('duplicate')}
            />

            <Item icon="folderArrow" label={t('ctx.moveTo')} onSelect={act('move-picker')} />

            <ContextMenu.Separator className="ctx-sep" />

            <Item icon="link" label={t('ctx.copyLink')} kbd="⌘L" onSelect={act('copy-link')} />
            <Item icon="copy" label={t('ctx.copyPath')} onSelect={act('copy-path')} />
            <Item icon="folderOpen" label={t('ctx.revealInFinder')} onSelect={act('reveal')} />
            <ContextMenu.Separator className="ctx-sep" />

            <Item icon="info" label={t('ctx.properties')} kbd="⌘I" onSelect={act('info')} />
            {isClip && (
              <Item icon="globe" label={t('ctx.openSourceUrl')} onSelect={act('open-source')} />
            )}
            <ContextMenu.Separator className="ctx-sep" />

            <Item
              icon="trash"
              label={t('ctx.moveToTrash')}
              kbd="⌫"
              danger
              onSelect={act('delete')}
            />
          </ContextMenu.Content>
        </ContextMenu.Portal>
      )}
    </ContextMenu.Root>
  )
}
