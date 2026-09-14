import i18n from '../../i18n'
import { Icon } from '../Icon'
import { FileTypeIcon, fileTypeLabel } from '../FileTypeIcon'
import { FileContextMenu, type ContextAction } from './FileContextMenu'
import { NameInput } from './NameInput'
import { cn } from '../../lib/cn'
import type { FileNode } from './types'
import { sortNodes, type TreeSortRule } from './treeOps'

const EXT_RE =
  /\.(md|markdown|txt|rtf|html?|pdf|epub|png|jpe?g|gif|webp|svg|heic|mp3|wav|m4a|aac|flac|mp4|mov|mkv|webm|js|jsx|ts|tsx|py|rb|go|rs|sh|css|scss|csv|tsv|json|yaml|yml|xml|toml|zip|tar|gz|7z)$/i

export interface TreeNodeProps {
  node: FileNode
  /** File currently open in the editor. */
  activeId: string | null
  /** Last-clicked tree row (file or folder) — may differ from activeId. */
  selectedId: string | null
  expanded: Record<string, boolean>
  recentIds: string[]
  sortRule: TreeSortRule
  /** Row currently in inline-rename mode (absolute path id). */
  renameId?: string | null
  onRenameCommit?: (id: string, name: string | null) => void
  /** Inline create input — when folderId matches this folder, render the input. */
  inlineCreate?: { folderId: string; type: 'note' | 'folder' } | null
  onInlineCreateCommit?: (name: string | null) => void
  /** Node currently being dragged (absolute path id). */
  draggingId?: string | null
  onDragNode?: (id: string | null) => void
  /** Folder row currently hovered by a compatible drag. */
  dropId?: string | null
  onDropHint?: (id: string | null) => void
  onMoveNode?: (sourceId: string, folderId: string) => void
  onActivate: (id: string) => void
  onSelectFolder: (id: string) => void
  onToggle: (id: string) => void
  onAction: (action: ContextAction, node: FileNode) => void
}

export const TreeNode = ({
  node,
  activeId,
  selectedId,
  expanded,
  recentIds,
  sortRule,
  renameId,
  onRenameCommit,
  inlineCreate,
  onInlineCreateCommit,
  draggingId,
  onDragNode,
  dropId,
  onDropHint,
  onMoveNode,
  onActivate,
  onSelectFolder,
  onToggle,
  onAction,
}: TreeNodeProps) => {
  const isFolder = node.kind === 'folder'
  const isOpen = expanded[node.id] ?? node.open ?? false
  const isRenaming = node.id === renameId

  // Drag-and-drop moves nodes into folders — real directories have no
  // custom order, so no reorder. Only the system Inbox is pinned in place.
  const canDrag = !isRenaming && node.system !== 'inbox'
  const dragHandlers = {
    draggable: canDrag,
    onDragStart: (e: React.DragEvent) => {
      if (!canDrag) {
        e.preventDefault()
        return
      }
      e.stopPropagation()
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('application/x-melo-node', node.id)
      e.dataTransfer.setData('text/plain', node.name)
      onDragNode?.(node.id)
    },
    onDragEnd: () => {
      onDragNode?.(null)
      onDropHint?.(null)
    },
    onDragOver: (e: React.DragEvent) => {
      if (!isFolder) {
        // Swallow drags over file rows: without stopping propagation the
        // tree container would treat a drop here as a workspace-top drop.
        e.stopPropagation()
        return
      }
      const types = Array.from(e.dataTransfer.types || [])
      if (!types.includes('application/x-melo-node')) return
      if (draggingId === node.id) return
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = 'move'
      onDropHint?.(node.id)
    },
    onDragLeave: () => {
      if (isFolder && dropId === node.id) onDropHint?.(null)
    },
    onDrop: (e: React.DragEvent) => {
      if (!isFolder) {
        e.stopPropagation()
        return
      }
      const nodeId = e.dataTransfer.getData('application/x-melo-node')
      if (nodeId) {
        e.preventDefault()
        e.stopPropagation()
        onDropHint?.(null)
        onDragNode?.(null)
        onMoveNode?.(nodeId, node.id)
      }
    },
  }
  const isActive = activeId === node.id
  const isSelected = selectedId === node.id
  const isInbox = node.system === 'inbox'
  const recent = recentIds.includes(node.id)
  const clipHost = !isFolder ? node.source?.host : undefined

  // Per the design call: every file shows its extension as a dimmed suffix
  // after the base name — quieter than chips when name lengths vary. No
  // known extension (e.g. bookmarks) → no suffix.
  const extMatch = !isFolder ? node.name.match(EXT_RE) : null
  const fileExt = extMatch ? extMatch[0] : ''
  const baseName = fileExt ? node.name.slice(0, -fileExt.length) : node.name

  return (
    <div className="tree-node">
      <FileContextMenu node={node} onAction={onAction}>
        <div
          className={cn(
            'tree-row',
            isActive && 'active',
            isSelected && 'selected',
            isInbox && 'inbox-row',
            recent && 'recent',
            isRenaming && 'renaming',
            draggingId === node.id && 'dragging',
            dropId === node.id && 'drop-inside',
          )}
          onClick={() => {
            if (isRenaming) return
            if (isFolder) {
              onSelectFolder(node.id)
              onToggle(node.id)
            } else {
              onActivate(node.id)
            }
          }}
          {...dragHandlers}
        >
          <span className={cn('tree-chev', isFolder ? isOpen && 'open' : 'leaf')}>
            {isFolder && <Icon name="chev" size={11} />}
          </span>

          {isFolder ? (
            <span className={cn('tree-folder-icon', isInbox && 'inbox')}>
              <Icon name={isInbox ? 'inboxFill' : isOpen ? 'folderOpen' : 'folder'} size={14} />
            </span>
          ) : (
            <FileTypeIcon
              kind={clipHost ? 'clip' : node.kind}
              size={14}
              className="tree-file-icon"
              title={clipHost ? `${fileTypeLabel('clip')} · ${clipHost}` : undefined}
            />
          )}

          {node.id === renameId && onRenameCommit ? (
            <NameInput
              defaultValue={node.name}
              onCommit={(name) => onRenameCommit(node.id, name)}
            />
          ) : (
            <span className="tree-label">
              <span className="tree-name">{baseName}</span>
              {fileExt && <span className="tree-ext">{fileExt}</span>}
            </span>
          )}

          {!isFolder && node.starred && (
            <span className="tree-star">
              <Icon name="starFill" size={10} />
            </span>
          )}

          {isInbox && <span className="sb-count">{node.children?.length ?? 0}</span>}
        </div>
      </FileContextMenu>

      {isFolder && (isOpen || inlineCreate?.folderId === node.id) && (
        <div className="tree-children">
          {inlineCreate?.folderId === node.id && onInlineCreateCommit && (
            <div className="tree-row tree-create-row">
              <span className="tree-chev leaf" />
              <FileTypeIcon
                kind={inlineCreate.type === 'folder' ? 'folder' : 'md'}
                size={14}
                className="tree-file-icon"
              />
              <NameInput
                placeholder={
                  inlineCreate.type === 'folder'
                    ? i18n.t('sidebar.folderNamePlaceholder')
                    : i18n.t('sidebar.noteNamePlaceholder')
                }
                onCommit={onInlineCreateCommit}
              />
            </div>
          )}
          {sortNodes(node.children ?? [], sortRule).map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              activeId={activeId}
              selectedId={selectedId}
              expanded={expanded}
              recentIds={recentIds}
              sortRule={sortRule}
              renameId={renameId}
              onRenameCommit={onRenameCommit}
              inlineCreate={inlineCreate}
              onInlineCreateCommit={onInlineCreateCommit}
              draggingId={draggingId}
              onDragNode={onDragNode}
              dropId={dropId}
              onDropHint={onDropHint}
              onMoveNode={onMoveNode}
              onActivate={onActivate}
              onSelectFolder={onSelectFolder}
              onToggle={onToggle}
              onAction={onAction}
            />
          ))}
        </div>
      )}
    </div>
  )
}
