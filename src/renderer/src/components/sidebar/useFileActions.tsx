import { useMemo, useState } from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { IpcChannels } from '@shared/types/ipc'
import { toast } from '../Toaster'
import { safeExternalUrl } from '../../lib/url'
import { copyText } from '../../lib/clipboard'
import { loadTree, workspaceName } from '../../lib/workspace'
import { safeName } from '../../lib/safeName'
import {
  activeNoteAtom,
  treeSelectionAtom,
  workspacePathAtom,
  workspaceTreeAtom,
} from '../../store/workspace'
import { activeTabIdAtom, closeTabAtom, tabsAtom } from '../../store/editor'
import { closeSession, flush, reviveFromDisk } from '../../store/documentSession'
import { appStore } from '../../store/appStore'
import { PropertiesCard } from './PropertiesCard'
import { MoveDestinationDialog } from './MoveDestinationDialog'
import { findNode, flattenFolders } from './treeOps'
import { isInsidePath } from './moveDestination'
import type { ContextAction } from './FileContextMenu'
import type { FileNode } from './types'

interface FileActionOptions {
  onRevealFolder?: (tree: FileNode[], folderId: string) => void
  onPathChanged?: (oldPath: string, newPath: string) => void
}

/** Shared file actions for the tree and Smart Folder results. Both surfaces
 *  stay usable when the other one is hidden or unmounted. */
export function useFileActions({ onRevealFolder, onPathChanged }: FileActionOptions = {}) {
  const { t } = useTranslation()
  const workspacePath = useAtomValue(workspacePathAtom)
  const [tree, setTree] = useAtom(workspaceTreeAtom)
  const [, setActiveId] = useAtom(activeNoteAtom)
  const [, setSelectedId] = useAtom(treeSelectionAtom)
  const closeTab = useSetAtom(closeTabAtom)
  const [propsNode, setPropsNode] = useState<FileNode | null>(null)
  const [moveSource, setMoveSource] = useState<FileNode | null>(null)

  const folders = useMemo(() => {
    if (!workspacePath) return flattenFolders(tree)
    const name = workspaceName(workspacePath)
    return [{ id: workspacePath, name, path: name }, ...flattenFolders(tree)]
  }, [tree, workspacePath])
  const inboxId = folders.find((folder) => folder.system === 'inbox')?.id

  const reload = async () => {
    if (!workspacePath) return tree
    try {
      const next = await loadTree(workspacePath)
      setTree(next)
      return next
    } catch {
      toast(t('sidebar.rereadFailed'))
      return tree
    }
  }

  const fail = async (message?: string | null, fallback?: string) => {
    toast(message || fallback || t('sidebar.somethingWrong'))
    await reload()
  }

  const reconcile = (next: FileNode[]) => {
    setPropsNode((node) => (node && !findNode(next, node.id) ? null : node))
    setActiveId((id) => (id && !findNode(next, id) ? null : id))
    setSelectedId((id) => (id && !findNode(next, id) ? null : id))
  }

  const remapTabs = (oldPath: string, newPath: string, openIds: Set<string>) => {
    const remap = (id: string) =>
      id === oldPath ? newPath : isInsidePath(id, oldPath) ? newPath + id.slice(oldPath.length) : id
    if (openIds.size) {
      appStore.set(
        tabsAtom,
        appStore.get(tabsAtom).map((tab) => {
          if (!openIds.has(tab.id)) return tab
          const id = remap(tab.id)
          const basename = id.split(/[\\/]/).pop() ?? id
          return {
            ...tab,
            id,
            path: id,
            title: basename.replace(/\.(md|markdown)$/i, ''),
            dirty: false,
            saveStatus: 'saved' as const,
          }
        }),
      )
      const active = appStore.get(activeTabIdAtom)
      if (active && openIds.has(active)) appStore.set(activeTabIdAtom, remap(active))
    }
    setActiveId((id) => (id ? remap(id) : id))
    setSelectedId((id) => (id ? remap(id) : id))
    return remap
  }

  const onAction = async (action: ContextAction, node: FileNode) => {
    if (action === 'duplicate') {
      const res = await window.api.invoke(IpcChannels.InvokeCopyFile, { sourcePath: node.id })
      if (!res.success) return fail(res.error, t('sidebar.couldNotDuplicate'))
      await reload()
    } else if (action === 'move-picker') {
      setMoveSource(node)
    } else if (action.startsWith('move:')) {
      const destId = action.slice(5)
      const openTabs = appStore
        .get(tabsAtom)
        .filter(
          (tab) => tab.id === node.id || (node.kind === 'folder' && isInsidePath(tab.id, node.id)),
        )
      for (const tab of openTabs) {
        if (!(await flush(tab.id))) return
      }
      const res = await window.api.invoke(IpcChannels.InvokeMoveFile, {
        sourcePath: node.id,
        targetPath: destId,
      })
      if (!res.success || !res.data) return fail(res.error, t('sidebar.couldNotMove'))
      for (const tab of openTabs) await closeSession(tab.id, { discard: true })
      const remap = remapTabs(node.id, res.data.newPath, new Set(openTabs.map((tab) => tab.id)))
      onPathChanged?.(node.id, res.data.newPath)
      const next = await reload()
      setPropsNode((value) => (value ? findNode(next, remap(value.id)) : value))
      onRevealFolder?.(next, destId)
      reconcile(next)
    } else if (action === 'delete') {
      if (!window.confirm(t('sidebar.confirmTrash', { name: node.name }))) return
      // Cancel pending saves before trashing so a timer cannot resurrect the file.
      await closeSession(node.id, { discard: true })
      const res = await window.api.invoke(IpcChannels.InvokeDeleteFile, { path: node.id })
      if (!res.success) {
        if (appStore.get(tabsAtom).some((tab) => tab.id === node.id)) void reviveFromDisk(node.id)
        return fail(res.error, t('sidebar.couldNotTrash'))
      }
      closeTab(node.id)
      const next = await reload()
      reconcile(next)
    } else if (action === 'reveal') {
      void window.api.invoke(IpcChannels.InvokeRevealInFinder, { path: node.id })
    } else if (action === 'copy-path') {
      void copyText(node.id)
    } else if (action === 'copy-link') {
      if (node.source?.url) void copyText(node.source.url)
      else {
        const res = await window.api.invoke(IpcChannels.InvokeGetFileMeta, { path: node.id })
        const title =
          (res.success && res.data?.meta?.title) || node.name.replace(/\.(md|markdown)$/i, '')
        void copyText(`[[${title}]]`)
      }
    } else if (action === 'info') {
      setPropsNode(node)
    } else if (action === 'open-source') {
      const url = node.source?.url && safeExternalUrl(node.source.url)
      if (url) window.open(url, '_blank')
    }
  }

  const commitRename = async (node: FileNode, raw: string | null) => {
    const name = raw ? safeName(raw) : ''
    if (!name || name === node.name) return
    const id = node.id
    const openTabs = appStore
      .get(tabsAtom)
      .filter((tab) => tab.id === id || (node.kind === 'folder' && isInsidePath(tab.id, id)))
    for (const tab of openTabs) {
      if (!(await flush(tab.id))) return
    }
    const res = await window.api.invoke(IpcChannels.InvokeRenameFile, {
      oldPath: id,
      newName: name,
    })
    if (!res.success) return fail(res.error, t('sidebar.couldNotRename'))
    for (const tab of openTabs) await closeSession(tab.id, { discard: true })
    const cut = Math.max(id.lastIndexOf('/'), id.lastIndexOf('\\'))
    const newPath = res.data?.newPath ?? id.slice(0, cut + 1) + name
    const remap = remapTabs(id, newPath, new Set(openTabs.map((tab) => tab.id)))
    onPathChanged?.(id, newPath)
    const next = await reload()
    setPropsNode((value) => (value ? findNode(next, remap(value.id)) : value))
    reconcile(next)
  }

  const dialogs = (
    <>
      <PropertiesCard node={propsNode} onClose={() => setPropsNode(null)} />
      {moveSource && workspacePath && (
        <MoveDestinationDialog
          key={moveSource.id}
          source={moveSource}
          folders={folders}
          workspaceId={workspacePath}
          onClose={() => setMoveSource(null)}
          onMove={(folderId) => {
            const source = moveSource
            setMoveSource(null)
            void onAction(`move:${folderId}`, source)
          }}
        />
      )}
    </>
  )

  return { onAction, commitRename, reload, fail, reconcile, inboxId, dialogs }
}
