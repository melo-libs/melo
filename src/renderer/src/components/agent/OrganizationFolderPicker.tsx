import { useId, useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import * as Tooltip from '@radix-ui/react-tooltip'
import { useTranslation } from 'react-i18next'
import { Button } from '../ui/Button'
import { Icon } from '../Icon'
import { OrganizationFolderPath, NewFolderBadge } from './OrganizationFolderPath'
import {
  folderName,
  folderPrefixes,
  joinFolder,
  parentFolder,
  validOrganizationName,
} from './organizationFolders'

function Match({ text, query }: { text: string; query: string }) {
  const start = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase())
  return query && start >= 0 ? (
    <>
      {text.slice(0, start)}
      <mark>{text.slice(start, start + query.length)}</mark>
      {text.slice(start + query.length)}
    </>
  ) : (
    text
  )
}

export function OrganizationFolderPicker({
  folder,
  folders,
  locations,
  disabled,
  onChange,
  onRename,
}: {
  folder: string
  folders: string[]
  locations: string[]
  disabled: boolean
  onChange(folder: string): void
  onRename(folder: string, name: string): void
}) {
  const { t } = useTranslation()
  const editorFormId = useId()
  const [open, setOpen] = useState(false)
  const [browse, setBrowse] = useState(parentFolder(folder))
  const [query, setQuery] = useState('')
  const [editor, setEditor] = useState<{
    kind: 'create' | 'rename'
    folder: string
    name: string
  } | null>(null)
  const label = (path: string) => path || t('agent.organization.root')
  const prefixes = folderPrefixes(folder)
  const firstNew = prefixes.findIndex((path) => !locations.includes(path))
  const newCount = firstNew < 0 ? 0 : prefixes.length - firstNew
  const search = query.trim()
  const visible = folders.filter(
    (path) =>
      path &&
      (search
        ? path.toLocaleLowerCase().includes(search.toLocaleLowerCase())
        : parentFolder(path) === browse),
  )
  const editedPath =
    editor &&
    joinFolder(editor.kind === 'create' ? browse : parentFolder(editor.folder), editor.name.trim())
  const collision = !!editor && folders.includes(editedPath!) && editedPath !== editor.folder
  const valid = !!editor && validOrganizationName(editor.name) && !collision
  const select = (path: string) => {
    onChange(path)
    setOpen(false)
  }
  const edit = (kind: 'create' | 'rename', path: string, name: string) => {
    setEditor({ kind, folder: path, name })
    setQuery('')
  }
  return (
    <Popover.Root
      open={open}
      onOpenChange={(value) => {
        setOpen(value)
        if (value) {
          setBrowse(parentFolder(folder))
          setQuery('')
          setEditor(null)
        }
      }}
    >
      <Tooltip.Provider delayDuration={350}>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <Popover.Trigger asChild>
              <Button
                className="agent-organization-folder"
                size="small"
                disabled={disabled}
                aria-label={`${t('agent.organization.location')}: ${label(folder)}`}
              >
                <Icon name="folderFilled" size={18} />
                <OrganizationFolderPath path={folder} locations={locations} />
                <Icon name="chev" size={14} className="agent-folder-caret" />
              </Button>
            </Popover.Trigger>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content
              className="agent-folder-tooltip"
              side="top"
              sideOffset={6}
              collisionPadding={12}
            >
              <div>{label(folder).split('/').join(' › ')}</div>
              {!!newCount && (
                <small>
                  {t('agent.organization.newLevels', {
                    count: newCount,
                    parent: label(firstNew > 0 ? prefixes[firstNew - 1] : ''),
                  })}
                </small>
              )}
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
      </Tooltip.Provider>
      <Popover.Portal>
        <Popover.Content
          className="agent-folder-picker"
          align="start"
          sideOffset={6}
          collisionPadding={12}
          aria-label={t('agent.organization.location')}
        >
          {editor ? (
            <form
              id={editorFormId}
              className="agent-folder-form"
              onSubmit={(event) => {
                event.preventDefault()
                if (!valid) return
                if (editor.kind === 'rename') onRename(editor.folder, editor.name.trim())
                else onChange(editedPath!)
                setOpen(false)
              }}
            >
              <label>
                {t(
                  editor.kind === 'create'
                    ? 'agent.organization.createFolder'
                    : 'agent.organization.renameFolder',
                )}
                <input
                  autoFocus
                  aria-label={t('agent.organization.folderName')}
                  value={editor.name}
                  aria-invalid={!valid}
                  maxLength={200}
                  onChange={(event) => setEditor({ ...editor, name: event.target.value })}
                />
              </label>
              {editor.kind === 'rename' && (
                <small>{t('agent.organization.renameFolderHelp')}</small>
              )}
              {editor.kind === 'create' && <small>{t('agent.organization.chooseParent')}</small>}
              {collision && <small role="alert">{t('agent.organization.folderExists')}</small>}
              {!!editor.name && !validOrganizationName(editor.name) && (
                <small role="alert">{t('agent.organization.invalidName')}</small>
              )}
              {editor.kind === 'rename' && (
                <div className="agent-folder-form-actions">
                  <Button size="small" onClick={() => setEditor(null)}>
                    {t('common.cancel')}
                  </Button>
                  <Button type="submit" size="small" variant="primary" disabled={!valid}>
                    {t('agent.organization.done')}
                  </Button>
                </div>
              )}
            </form>
          ) : (
            <label className="agent-folder-search">
              <Icon name="search" size={16} />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-label={t('agent.organization.searchFolders')}
                placeholder={t('agent.organization.searchFolders')}
              />
            </label>
          )}
          {editor?.kind !== 'rename' && (
            <>
              {!search && (
                <nav
                  className="agent-folder-navigation"
                  aria-label={t('agent.organization.browseFolders')}
                >
                  <Button
                    size="small"
                    className="agent-folder-back"
                    disabled={!browse}
                    aria-label={t('agent.organization.parentFolder')}
                    onClick={() => setBrowse(parentFolder(browse))}
                  >
                    <Icon name="chev" size={14} />
                  </Button>
                  <div
                    ref={(element) => {
                      if (element) element.scrollLeft = element.scrollWidth
                    }}
                  >
                    {['', ...folderPrefixes(browse)].map((path, index) => (
                      <span key={path}>
                        {index > 0 && <Icon name="chev" size={12} />}
                        <Button
                          size="small"
                          aria-current={path === browse ? 'location' : undefined}
                          onClick={() => setBrowse(path)}
                        >
                          {path ? folderName(path) : t('agent.organization.root')}
                        </Button>
                      </span>
                    ))}
                  </div>
                </nav>
              )}
              {!!search && (
                <small className="agent-folder-count">
                  {t('agent.organization.folderCount', { count: visible.length })}
                </small>
              )}
              <div className="agent-folder-list">
                {visible.map((path) => {
                  const planned = !locations.includes(path)
                  return (
                    <div
                      className="agent-folder-row"
                      key={path}
                      data-selected={(!editor && path === folder) || undefined}
                    >
                      <Button
                        size="small"
                        className="agent-folder-choice"
                        onClick={() => (editor ? setBrowse(path) : select(path))}
                        aria-label={`${editor ? t('agent.organization.openFolder') : t('agent.organization.chooseFolder')}: ${path}`}
                      >
                        <Icon name="folderFilled" size={18} />
                        <span className="agent-folder-row-name">
                          <Match text={folderName(path)} query={search} />
                        </span>
                        {planned && <NewFolderBadge />}
                        {!!search && (
                          <small title={parentFolder(path)}>
                            <Match
                              text={parentFolder(path) || t('agent.organization.root')}
                              query={search}
                            />
                          </small>
                        )}
                        {!editor && path === folder && <Icon name="tick" size={16} />}
                        {editor && <Icon name="chev" size={14} />}
                      </Button>
                      {planned && !editor && (
                        <Button
                          className="agent-folder-row-action agent-folder-rename"
                          size="small"
                          aria-label={`${t('agent.organization.renameFolder')}: ${path}`}
                          onClick={() => edit('rename', path, folderName(path))}
                        >
                          <Icon name="pencil" size={14} />
                          {t('agent.organization.renameFolderAction')}
                        </Button>
                      )}
                      {!editor && (
                        <Button
                          className="agent-folder-row-action"
                          size="small"
                          aria-label={`${t('agent.organization.openFolder')}: ${path}`}
                          onClick={() => {
                            setBrowse(path)
                            setQuery('')
                          }}
                        >
                          <Icon name="chev" size={14} />
                        </Button>
                      )}
                    </div>
                  )
                })}
                {!visible.length && (
                  <p className="agent-folder-empty">
                    {t(search ? 'agent.organization.noFolders' : 'agent.organization.noSubfolders')}
                  </p>
                )}
              </div>
              {editor?.kind === 'create' && (
                <div className="agent-folder-form-actions">
                  <Button size="small" onClick={() => setEditor(null)}>
                    {t('common.cancel')}
                  </Button>
                  <Button
                    type="submit"
                    form={editorFormId}
                    size="small"
                    variant="primary"
                    disabled={!valid}
                  >
                    {t('agent.organization.createHere')}
                  </Button>
                </div>
              )}
              {!editor && (
                <div className="agent-folder-footer">
                  {!search && (
                    <Button size="small" onClick={() => select(browse)}>
                      {t('agent.organization.chooseCurrent', {
                        name: browse ? folderName(browse) : t('agent.organization.root'),
                      })}
                    </Button>
                  )}
                  <Button size="small" onClick={() => edit('create', browse, search)}>
                    <Icon name="plus" size={16} />
                    {t(search ? 'agent.organization.createSearch' : 'agent.organization.createIn', {
                      name: search,
                      parent: browse ? folderName(browse) : label(browse),
                    })}
                  </Button>
                </div>
              )}
            </>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
