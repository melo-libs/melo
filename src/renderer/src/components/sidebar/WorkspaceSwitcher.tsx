import { useCallback, useEffect, useRef, useState } from 'react'
import { useAtomValue } from 'jotai'
import * as Popover from '@radix-ui/react-popover'
import { useTranslation } from 'react-i18next'
import { IpcChannels } from '@shared/types/ipc'
import { Icon } from '../Icon'
import { cn } from '../../lib/cn'
import { workspaceName } from '../../lib/workspace'
import { workspacePathAtom, workspaceSwitchingAtom, workspaceTreeAtom } from '../../store/workspace'
import type { FileNode } from './types'

/* ============================================================
   Workspace switcher — trigger shows the current workspace,
   the popover lists every registered one: current pinned first,
   the rest by last-opened. Selecting dispatches a switch event
   handled by the editor (it owns the flush/close-out dialogs).
   ============================================================ */

interface Entry {
  path: string
  name: string
  lastOpenedAt: number
  exists: boolean
}

const countFiles = (nodes: FileNode[]): number =>
  nodes.reduce((n, node) => n + (node.kind === 'folder' ? countFiles(node.children ?? []) : 1), 0)

const shortPath = (p: string) => p.replace(/^\/Users\/[^/]+/, '~')

const requestSwitch = (path: string, name: string) =>
  window.dispatchEvent(new CustomEvent('melo:switch-workspace', { detail: { path, name } }))

export const WorkspaceSwitcher = () => {
  const { t } = useTranslation()
  const workspacePath = useAtomValue(workspacePathAtom)
  const tree = useAtomValue(workspaceTreeAtom)
  const switching = useAtomValue(workspaceSwitchingAtom)

  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState<Entry[]>([])
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<{ path: string; draft: string } | null>(null)
  const renameRef = useRef<HTMLInputElement>(null)

  const reload = useCallback(async () => {
    const res = await window.api.invoke(IpcChannels.InvokeListWorkspaces, undefined)
    if (res.success && res.data) setEntries(res.data.workspaces)
  }, [])

  useEffect(() => {
    if (open) void reload()
    else {
      setMenuFor(null)
      setRenaming(null)
    }
  }, [open, reload])

  // The trigger shows the stored display name from the first paint, not
  // only after the popover has been opened once.
  useEffect(() => {
    void reload()
  }, [workspacePath, reload])

  useEffect(() => {
    if (renaming) renameRef.current?.select()
  }, [renaming?.path]) // eslint-disable-line react-hooks/exhaustive-deps

  const current = entries.find((e) => e.path === workspacePath)
  const others = entries
    .filter((e) => e.path !== workspacePath)
    .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
  const rows: Entry[] = [
    current ??
      (workspacePath
        ? { path: workspacePath, name: workspaceName(workspacePath), lastOpenedAt: 0, exists: true }
        : null),
    ...others,
  ].filter((e): e is Entry => e !== null)

  const triggerName =
    switching ??
    current?.name ??
    (workspacePath ? workspaceName(workspacePath) : t('ws.fallbackName'))

  const selectRow = async (e: Entry) => {
    if (e.path === workspacePath) {
      setOpen(false)
      return
    }
    if (!e.exists) {
      const res = await window.api.invoke(IpcChannels.InvokeShowMessageBox, {
        type: 'warning',
        title: t('ws.notFoundTitle'),
        message: `"${e.name}" is no longer at ${e.path}`,
        detail: t('ws.notFoundDetail'),
        buttons: [t('ws.locate'), t('ws.removeFromList'), t('common.cancel')],
        defaultId: 0,
        cancelId: 2,
      })
      const choice = res.success ? res.data?.response : 2
      if (choice === 0) {
        const rel = await window.api.invoke(IpcChannels.InvokeRelocateWorkspace, { path: e.path })
        if (rel.success && rel.data) {
          setOpen(false)
          requestSwitch(rel.data.newPath, e.name)
        }
      } else if (choice === 1) {
        await window.api.invoke(IpcChannels.InvokeRemoveWorkspace, { path: e.path })
        void reload()
      }
      return
    }
    setOpen(false)
    requestSwitch(e.path, e.name)
  }

  const commitRename = async () => {
    if (!renaming) return
    const { path, draft } = renaming
    setRenaming(null)
    await window.api.invoke(IpcChannels.InvokeRenameWorkspace, { path, name: draft })
    void reload()
  }

  const createWorkspace = async () => {
    const res = await window.api.invoke(IpcChannels.InvokeCreateWorkspace, undefined)
    if (res.success && res.data) {
      setOpen(false)
      requestSwitch(res.data.path, workspaceName(res.data.path))
    }
  }

  const openFromFolder = async () => {
    const res = await window.api.invoke(IpcChannels.InvokeOpenDirectory, undefined)
    if (res.success && res.data) {
      setOpen(false)
      requestSwitch(res.data.directoryPath, workspaceName(res.data.directoryPath))
    }
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          className={cn('sb-workspace', open && 'open', switching && 'switching')}
          title={t('misc.switchWorkspace')}
        >
          <span className="sb-ws-info">
            <span className="sb-ws-name">{triggerName}</span>
          </span>
          <span className="sb-ws-caret">
            <Icon name="chev" size={11} />
          </span>
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content className="sb-ws-pop" align="start" sideOffset={6} role="menu">
          <div className="sb-ws-pop-label">{t('misc.workspaces')}</div>
          {rows.map((e) => {
            const isCurrent = e.path === workspacePath
            return (
              <div
                key={e.path}
                className={cn('sb-ws-row', isCurrent && 'active', !e.exists && 'invalid')}
                onClick={() => void selectRow(e)}
              >
                <span className="sb-ws-row-info">
                  {renaming?.path === e.path ? (
                    <input
                      ref={renameRef}
                      className="sb-ws-rename"
                      value={renaming.draft}
                      onChange={(ev) => setRenaming({ path: e.path, draft: ev.target.value })}
                      onClick={(ev) => ev.stopPropagation()}
                      onKeyDown={(ev) => {
                        if (ev.key === 'Enter') void commitRename()
                        if (ev.key === 'Escape') setRenaming(null)
                        ev.stopPropagation()
                      }}
                      onBlur={() => void commitRename()}
                    />
                  ) : (
                    <span className="sb-ws-row-name">{e.name}</span>
                  )}
                  <span className="sb-ws-row-meta">
                    {!e.exists
                      ? t('ws.folderNotFound')
                      : isCurrent
                        ? `${countFiles(tree)} notes · local`
                        : shortPath(e.path)}
                  </span>
                </span>
                {isCurrent && (
                  <span className="sb-ws-check">
                    <svg
                      viewBox="0 0 18 18"
                      width="12"
                      height="12"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M4 9.5l3.2 3.2L14 6" />
                    </svg>
                  </span>
                )}
                <button
                  className="sb-ws-row-more"
                  onClick={(ev) => {
                    ev.stopPropagation()
                    setMenuFor(menuFor === e.path ? null : e.path)
                  }}
                  title={t('misc.workspaceOptions')}
                >
                  <Icon name="moreH" size={13} />
                </button>
                {menuFor === e.path && (
                  <div className="sb-ws-menu" onClick={(ev) => ev.stopPropagation()}>
                    <button
                      className="sb-ws-menu-item"
                      onClick={() => {
                        setMenuFor(null)
                        setRenaming({ path: e.path, draft: e.name })
                      }}
                    >
                      {t('ws.rename')}
                    </button>
                    <button
                      className="sb-ws-menu-item"
                      onClick={() => {
                        setMenuFor(null)
                        void window.api.invoke(IpcChannels.InvokeRevealInFinder, { path: e.path })
                      }}
                    >
                      Show in Finder
                    </button>
                    <button
                      className="sb-ws-menu-item"
                      disabled={isCurrent}
                      title={isCurrent ? t('ws.cannotRemoveOpen') : undefined}
                      onClick={async () => {
                        setMenuFor(null)
                        await window.api.invoke(IpcChannels.InvokeRemoveWorkspace, { path: e.path })
                        void reload()
                      }}
                    >
                      {t('ws.removeFromListItem')}
                    </button>
                  </div>
                )}
              </div>
            )
          })}

          <div className="sb-ws-divider" />
          <button className="sb-ws-action" onClick={() => void createWorkspace()}>
            <Icon name="plus" size={13} />
            <span>{t('ws.newWorkspace')}</span>
          </button>
          <button className="sb-ws-action" onClick={() => void openFromFolder()}>
            <Icon name="folderOpen" size={13} />
            <span>{t('ws.openFromFolder')}</span>
          </button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
