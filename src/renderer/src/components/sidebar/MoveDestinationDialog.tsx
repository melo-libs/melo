import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import * as Dialog from '@radix-ui/react-dialog'
import { Icon } from '../Icon'
import { Button } from '../ui/Button'
import type { FileNode } from './types'
import type { FlatFolder } from './treeOps'
import {
  canBrowseMoveFolder,
  canMoveToFolder,
  moveFolderBreadcrumbs,
  parentFolderId,
  searchMoveFolders,
} from './moveDestination'

const ROW_HEIGHT = 36
const VIEWPORT_HEIGHT = 216
const OVERSCAN = 4

interface MoveDestinationDialogProps {
  source: FileNode
  folders: FlatFolder[]
  workspaceId: string
  onClose: () => void
  onMove: (folderId: string) => void
}

const parentDisplayPath = (folder: FlatFolder, workspaceLabel: string): string => {
  const parents = folder.path.split(' / ').slice(0, -1)
  return parents.length ? parents.join(' / ') : workspaceLabel
}

export const MoveDestinationDialog = ({
  source,
  folders,
  workspaceId,
  onClose,
  onMove,
}: MoveDestinationDialogProps) => {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const folderById = useMemo(() => new Map(folders.map((folder) => [folder.id, folder])), [folders])
  const sourceParent = parentFolderId(source.id)
  const initialFolder = folderById.has(sourceParent) ? sourceParent : workspaceId
  const [currentId, setCurrentId] = useState(initialFolder)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(-1)
  const [scrollTop, setScrollTop] = useState(0)

  const browsableFolders = useMemo(
    () => folders.filter((folder) => canBrowseMoveFolder(source, folder.id)),
    [folders, source],
  )
  const childFolders = useMemo(
    () => browsableFolders.filter((folder) => parentFolderId(folder.id) === currentId),
    [browsableFolders, currentId],
  )
  const searchResults = useMemo(
    () => searchMoveFolders(folders, source, query),
    [folders, source, query],
  )
  const searching = query.trim().length > 0
  const items = searching ? searchResults : childFolders
  const effectiveActiveIndex = searching ? Math.max(0, activeIndex) : activeIndex
  const selectedSearchResult = searching ? items[effectiveActiveIndex] : undefined
  const destinationId = selectedSearchResult?.id ?? currentId
  const breadcrumbs = useMemo(
    () => moveFolderBreadcrumbs(currentId, workspaceId, folderById),
    [currentId, workspaceId, folderById],
  )
  const canConfirm =
    (!searching || selectedSearchResult !== undefined) && canMoveToFolder(source, destinationId)
  const isCurrentFolder = !searching && !canMoveToFolder(source, currentId)

  useEffect(() => {
    setActiveIndex(query.trim() ? 0 : -1)
    setScrollTop(0)
    if (listRef.current) listRef.current.scrollTop = 0
  }, [query, currentId])

  const enterFolder = (folderId: string) => {
    setCurrentId(folderId)
    setQuery('')
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  const moveActive = (delta: number) => {
    if (!items.length) return
    const next = Math.max(0, Math.min(items.length - 1, activeIndex + delta))
    setActiveIndex(next)
    const viewport = listRef.current
    if (!viewport) return
    const rowTop = next * ROW_HEIGHT
    const rowBottom = rowTop + ROW_HEIGHT
    if (rowTop < viewport.scrollTop) viewport.scrollTop = rowTop
    else if (rowBottom > viewport.scrollTop + viewport.clientHeight) {
      viewport.scrollTop = rowBottom - viewport.clientHeight
    }
  }

  const firstVisible = Math.floor(scrollTop / ROW_HEIGHT)
  const startIndex = Math.max(0, firstVisible - OVERSCAN)
  const visibleCount = Math.ceil(VIEWPORT_HEIGHT / ROW_HEIGHT) + OVERSCAN * 2
  const endIndex = Math.min(items.length, startIndex + visibleCount)
  const visibleItems = items.slice(startIndex, endIndex)
  const listHeight = searching
    ? items.length
      ? Math.min(VIEWPORT_HEIGHT, items.length * ROW_HEIGHT)
      : 72
    : VIEWPORT_HEIGHT
  const listNeedsScroll = items.length * ROW_HEIGHT > listHeight

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="move-dialog-scrim" />
        <Dialog.Content
          className="move-dialog"
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            inputRef.current?.focus()
          }}
        >
          <header className="move-dialog-head">
            <div className="move-dialog-heading">
              <Dialog.Title>{t('moveDialog.title')}</Dialog.Title>
              <Dialog.Description title={source.name}>{source.name}</Dialog.Description>
            </div>
            <Dialog.Close className="move-dialog-close" aria-label={t('moveDialog.close')}>
              <Icon name="x" size={14} />
            </Dialog.Close>
          </header>

          <div className="move-dialog-search">
            <Icon name="search" size={14} />
            <input
              ref={inputRef}
              value={query}
              placeholder={t('moveDialog.searchPlaceholder')}
              aria-label={t('moveDialog.searchPlaceholder')}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && canConfirm) {
                  event.preventDefault()
                  onMove(destinationId)
                } else if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  moveActive(1)
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  moveActive(-1)
                } else if (event.key === 'Enter' && items[effectiveActiveIndex]) {
                  event.preventDefault()
                  if (searching) onMove(items[effectiveActiveIndex].id)
                  else enterFolder(items[effectiveActiveIndex].id)
                }
              }}
            />
            {query && (
              <button
                className="move-dialog-search-clear"
                aria-label={t('moveDialog.clearSearch')}
                onClick={() => setQuery('')}
              >
                <Icon name="x" size={12} />
              </button>
            )}
          </div>

          {searching ? (
            <div className="move-dialog-search-summary">
              {t(items.length === 1 ? 'moveDialog.resultOne' : 'moveDialog.results', {
                count: items.length,
              })}
            </div>
          ) : (
            <nav className="move-dialog-breadcrumbs" aria-label={t('moveDialog.location')}>
              {breadcrumbs.map((folder, index) => (
                <span key={folder.id} className="move-dialog-crumb-wrap">
                  {index > 0 && <Icon name="chev" size={10} />}
                  <button
                    className={folder.id === currentId ? 'current' : undefined}
                    onClick={() => setCurrentId(folder.id)}
                    title={folder.path}
                  >
                    {folder.name}
                  </button>
                </span>
              ))}
            </nav>
          )}

          <div
            ref={listRef}
            className={`move-dialog-list${searching ? ' searching' : ''}`}
            style={{ height: listHeight, overflowY: listNeedsScroll ? 'auto' : 'hidden' }}
            onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
          >
            {items.length === 0 ? (
              <div className="move-dialog-empty">
                {searching ? t('moveDialog.noResults') : t('moveDialog.noFolders')}
              </div>
            ) : (
              <div
                className="move-dialog-list-spacer"
                style={{ height: items.length * ROW_HEIGHT }}
              >
                {visibleItems.map((folder, offset) => {
                  const index = startIndex + offset
                  return (
                    <button
                      key={folder.id}
                      className={`move-dialog-row${index === effectiveActiveIndex ? ' active' : ''}`}
                      style={{ transform: `translateY(${index * ROW_HEIGHT}px)` }}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => (searching ? setActiveIndex(index) : enterFolder(folder.id))}
                      onDoubleClick={() => searching && onMove(folder.id)}
                      title={folder.path}
                    >
                      <span className="move-dialog-row-icon">
                        <Icon name={folder.system === 'inbox' ? 'inboxFill' : 'folder'} size={14} />
                      </span>
                      <span className="move-dialog-row-copy">
                        <span className="move-dialog-row-name">{folder.name}</span>
                        {searching && (
                          <span className="move-dialog-row-path">
                            {parentDisplayPath(folder, t('sidebar.workspace'))}
                          </span>
                        )}
                      </span>
                      {!searching && <Icon name="chev" size={12} />}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          <footer className="move-dialog-footer">
            <div
              className="move-dialog-destination"
              title={searching ? selectedSearchResult?.path : undefined}
            >
              {searching && selectedSearchResult ? (
                <strong>{selectedSearchResult.path}</strong>
              ) : isCurrentFolder ? (
                <span>{t('moveDialog.alreadyHere')}</span>
              ) : null}
            </div>
            <div className="move-dialog-actions">
              <Dialog.Close asChild>
                <Button variant="secondary">{t('common.cancel')}</Button>
              </Dialog.Close>
              <Button
                variant="primary"
                className="move-dialog-confirm"
                disabled={!canConfirm}
                onClick={() => onMove(destinationId)}
              >
                {t('moveDialog.move')}
              </Button>
            </div>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
