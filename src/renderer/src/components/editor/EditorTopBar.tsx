import { useMemo } from 'react'
import i18n from '../../i18n'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { useTranslation } from 'react-i18next'
import { useAtomValue } from 'jotai'
import { Icon } from '../Icon'
import type { IconName } from '../Icon'
import { workspacePathAtom } from '../../store/workspace'
import { activeTabAtom } from '../../store/editor'
import { stripMarkdownExtension } from '@shared/fileKinds'

export interface EditorTopBarProps {
  filePath: string
  theme: 'light' | 'dark'
  empty?: boolean
  /** Active tab is a viewer (pdf/image/…) — document export doesn't apply. */
  viewerActive?: boolean
  sidebarAvailable?: boolean
  onToggleSidebar: () => void
  onToggleOutline: () => void
  onToggleTheme: () => void
}

/** A row inside the Export / More dropdowns. */
/** Route a document action to the sidebar's single implementation. */
const docAction = (action: string) => () =>
  window.dispatchEvent(new CustomEvent('melo:doc-action', { detail: { action } }))

/** Route an export to the editor page (owner of the live Tiptap doc). */
const exportAction = (format: 'md' | 'html' | 'pdf') => () =>
  window.dispatchEvent(new CustomEvent('melo:export', { detail: { format } }))

const MenuItem = ({
  icon,
  label,
  meta,
  shortcut,
  danger,
  onSelect,
  disabled,
}: {
  icon: IconName
  label: string
  meta?: string
  shortcut?: string
  danger?: boolean
  onSelect?: () => void
  disabled?: boolean
}) => (
  <DropdownMenu.Item
    className={'tm-item' + (danger ? ' danger' : '')}
    onSelect={onSelect}
    disabled={disabled}
  >
    <Icon name={icon} size={14} />
    <span className="tm-label">{label}</span>
    {meta && <span className="tm-meta">{meta}</span>}
    {shortcut && <span className="tm-shortcut">{shortcut}</span>}
  </DropdownMenu.Item>
)

/* Time-of-day alone lied for older saves — "00:40" with no date read as
   today when the save was days ago (lastSavedAt opens as the file's
   mtime). Same-day saves show the clock; anything older shows the date. */
const formatTime = (ts: number) => {
  const d = new Date(ts)
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  if (sameDay)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return d.toLocaleDateString(i18n.language, {
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  })
}

export const EditorTopBar = ({
  filePath,
  theme,
  empty,
  viewerActive,
  sidebarAvailable = true,
  onToggleSidebar,
  onToggleOutline,
  onToggleTheme,
}: EditorTopBarProps) => {
  const { t } = useTranslation()
  const wsPath = useAtomValue(workspacePathAtom)
  const activeTab = useAtomValue(activeTabAtom)
  const saveStatus = activeTab?.saveStatus ?? 'saved'
  const lastSavedAt = activeTab?.lastSavedAt ?? null
  const dirty = activeTab?.dirty ?? false
  const isUntitled = activeTab?.id.startsWith('untitled-') ?? false

  const crumbs = useMemo(() => {
    if (!filePath || !wsPath) return []
    const rel = filePath.startsWith(wsPath) ? filePath.slice(wsPath.length + 1) : filePath
    const parts = rel.split('/')
    return parts.map((part, index) =>
      index === parts.length - 1 ? stripMarkdownExtension(part) : part,
    )
  }, [filePath, wsPath])

  const showUnsaved = !isUntitled && dirty && saveStatus !== 'saving'

  const statusLabel = isUntitled
    ? null
    : saveStatus === 'error'
      ? t('topBar.saveFailed')
      : saveStatus === 'saving'
        ? t('topBar.saving')
        : lastSavedAt
          ? t('topBar.lastModified', { when: formatTime(lastSavedAt) })
          : null

  return (
    <div className="ed-top" data-empty={empty || undefined}>
      {sidebarAvailable && (
        <button
          className="ed-iconbtn"
          onClick={onToggleSidebar}
          aria-label={t('topBar.toggleFiles')}
        >
          <Icon name="panelL" size={16} />
          <span className="tooltip">{t('topBar.toggleFiles')}</span>
        </button>
      )}

      <div className="ed-breadcrumb">
        {crumbs.map((c, i) => [
          i > 0 && (
            <span key={`s${i}`} className="sep">
              ›
            </span>
          ),
          <span key={i} className={i === crumbs.length - 1 ? 'crumb cur' : 'crumb'}>
            {c}
          </span>,
        ])}
        {showUnsaved && <span className="ed-unsaved">{t('topBar.unsaved')}</span>}
      </div>

      {statusLabel && (
        <div className="ed-status" data-status={saveStatus === 'error' ? 'error' : undefined}>
          <span>{statusLabel}</span>
        </div>
      )}

      <div className="ed-top-actions">
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button className="ed-iconbtn" aria-label={t('topBar.export')}>
              <Icon name="download" size={15} />
              <span className="tooltip">{t('topBar.export')}</span>
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="top-menu" align="end" sideOffset={4}>
              <div className="tm-section">{t('topBar.exportSection')}</div>
              <MenuItem
                icon="download"
                label={t('topBar.exportPdf')}
                meta={t('topBar.exportPdfMeta')}
                onSelect={exportAction('pdf')}
                disabled={empty || viewerActive}
              />
              <MenuItem
                icon="fileMd"
                label={t('topBar.exportMd')}
                meta={t('topBar.exportMdMeta')}
                onSelect={exportAction('md')}
                disabled={empty || viewerActive}
              />
              <MenuItem
                icon="fileGeneric"
                label={t('topBar.exportHtml')}
                meta={t('topBar.exportHtmlMeta')}
                onSelect={exportAction('html')}
                disabled={empty || viewerActive}
              />
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>

        <button
          className="ed-iconbtn"
          onClick={onToggleTheme}
          aria-label={theme === 'dark' ? t('topBar.lightMode') : t('topBar.darkMode')}
        >
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={15} />
          <span className="tooltip">
            {theme === 'dark' ? t('topBar.lightMode') : t('topBar.darkMode')}
          </span>
        </button>

        <button
          className="ed-iconbtn"
          onClick={onToggleOutline}
          aria-label={t('topBar.toggleOutline')}
        >
          <Icon name="panelR" size={16} />
          <span className="tooltip">{t('topBar.toggleOutline')}</span>
        </button>

        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button className="ed-iconbtn" aria-label={t('topBar.moreActions')}>
              <Icon name="moreH" size={16} />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="top-menu" align="end" sideOffset={4}>
              {/* Workspace-only actions delegate to the sidebar's context-menu
                  flows. Reveal is direct so it also works for a standalone file. */}
              {wsPath && (
                <MenuItem
                  icon="link"
                  label={t('topBar.copyDocLink')}
                  onSelect={docAction('copy-link')}
                />
              )}
              <MenuItem
                icon="folder"
                label={t('common.revealInFinder')}
                onSelect={() =>
                  void window.api.invoke(window.api.channels.InvokeRevealInFinder, {
                    path: filePath,
                  })
                }
                disabled={!filePath}
              />
              <MenuItem
                icon="download"
                label={t('topBar.downloadRemoteImages')}
                onSelect={() =>
                  window.dispatchEvent(new CustomEvent('melo:download-remote-images'))
                }
              />
              {wsPath && (
                <>
                  <DropdownMenu.Separator className="tm-sep" />
                  <MenuItem
                    icon="info"
                    label={t('topBar.documentInfo')}
                    onSelect={docAction('info')}
                  />
                  <DropdownMenu.Separator className="tm-sep" />
                  <MenuItem
                    icon="trash"
                    label={t('common.moveToTrash')}
                    danger
                    onSelect={docAction('delete')}
                  />
                </>
              )}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </div>
  )
}
