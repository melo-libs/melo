import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import * as ContextMenu from '@radix-ui/react-context-menu'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { IpcChannels } from '@shared/types/ipc'
import { Icon } from '../Icon'
import { toast } from '../Toaster'
import { safeExternalUrl } from '../../lib/url'
import { setSetting, settingsAtom } from '../../store/settings'
import { formatSize } from '../../lib/format'
import { copyText } from '../../lib/clipboard'
import { loadTree, workspaceName } from '../../lib/workspace'
import { SIcon } from '../smart/SmartIcon'
import { newRule } from '../smart/smartData'
import {
  activeSmartIdAtom,
  deleteSmartViewAtom,
  smartBuilderAtom,
  smartCountsAtom,
  smartFoldersAtom,
  smartVocabAtom,
} from '../../store/smart'
import {
  activeNoteAtom,
  inlineCreateAtom,
  recentNotesAtom,
  searchOpenAtom,
  treeCreatingAtom,
  treeCreatingFolderAtom,
  treeSelectionAtom,
  workspacePathAtom,
  workspaceTreeAtom,
} from '../../store/workspace'
import { activeTabIdAtom, closeTabAtom } from '../../store/editor'
import { closeSession, flush, reviveFromDisk } from '../../store/documentSession'
import { appStore } from '../../store/appStore'
import { tabsAtom } from '../../store/editor'
import { WorkspaceSwitcher } from './WorkspaceSwitcher'
import { TreeNode } from './TreeNode'
import { PropertiesCard } from './PropertiesCard'
import { MoveDestinationDialog } from './MoveDestinationDialog'
import { NameInput } from './NameInput'
import { FileTypeIcon } from '../FileTypeIcon'
import { ancestorChain, findNode, flattenFolders, sortNodes, type TreeSortRule } from './treeOps'
import type { ContextAction } from './FileContextMenu'
import type { FileNode } from './types'
import { safeName } from '../../lib/safeName'
import { isInsidePath } from './moveDestination'
import './sidebar.scss'

interface SidebarProps {
  onResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void
  onResetWidth: () => void
}

export const Sidebar = ({ onResizeStart, onResetWidth }: SidebarProps) => {
  const { t } = useTranslation()
  const workspacePath = useAtomValue(workspacePathAtom)
  const [tree, setTree] = useAtom(workspaceTreeAtom)
  const activeTabId = useAtomValue(activeTabIdAtom)
  const [, setActiveId] = useAtom(activeNoteAtom)
  const [selectedId, setSelectedId] = useAtom(treeSelectionAtom)
  const pushRecent = useSetAtom(recentNotesAtom)
  const setSearchOpen = useSetAtom(searchOpenAtom)
  const closeTab = useSetAtom(closeTabAtom)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [propsNode, setPropsNode] = useState<FileNode | null>(null)
  const [moveSource, setMoveSource] = useState<FileNode | null>(null)
  const [creating, setCreating] = useAtom(treeCreatingAtom)
  const [creatingFolder, setCreatingFolder] = useAtom(treeCreatingFolderAtom)
  const [inlineCreate, setInlineCreate] = useAtom(inlineCreateAtom)
  const [renameId, setRenameId] = useState<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropId, setDropId] = useState<string | null>(null)

  // Smart folders (shared with the center column via atoms).
  const smartFolders = useAtomValue(smartFoldersAtom)
  const smartCounts = useAtomValue(smartCountsAtom)
  const smartVocab = useAtomValue(smartVocabAtom)
  const [activeSmartId, setActiveSmartId] = useAtom(activeSmartIdAtom)
  const setBuilder = useSetAtom(smartBuilderAtom)
  const deleteSmartView = useSetAtom(deleteSmartViewAtom)

  // Seed expansion from `open` flags whenever new folders appear (workspace
  // load / reload), without clobbering the user's manual toggles.
  useEffect(() => {
    setExpanded((prev) => {
      const next = { ...prev }
      const walk = (n: FileNode) => {
        if (n.children) {
          if (!(n.id in next) && n.open) next[n.id] = true
          n.children.forEach(walk)
        }
      }
      tree.forEach(walk)
      return next
    })
  }, [tree])

  const onToggle = (id: string) => setExpanded((e) => ({ ...e, [id]: !e[id] }))
  const activateNote = (id: string) => {
    setActiveId(id)
    setSelectedId(id)
    setActiveSmartId(null)
    pushRecent(id)
  }
  const selectFolder = (id: string) => {
    setSelectedId(id)
    setActiveSmartId(null)
  }

  useEffect(() => {
    if (!activeTabId) return
    const cut = Math.max(activeTabId.lastIndexOf('/'), activeTabId.lastIndexOf('\\'))
    if (cut > 0) revealFolder(tree, activeTabId.slice(0, cut))
    // eslint-disable-next-line
  }, [activeTabId])

  const wsName = workspacePath ? workspaceName(workspacePath) : t('ws.fallbackName')
  // The workspace top level is a valid Move-to target even though it has no
  // row of its own in the tree.
  const folders = useMemo(
    () =>
      workspacePath
        ? [{ id: workspacePath, name: wsName, path: wsName }, ...flattenFolders(tree)]
        : flattenFolders(tree),
    [tree, workspacePath, wsName],
  )
  const inboxId = useMemo(() => folders.find((f) => f.system === 'inbox')?.id, [folders])

  /** Surface a failed operation and re-scan — the most common cause is a
      tree that drifted from disk, and a fresh scan realigns it. */
  const fail = async (msg?: string | null, fallback?: string) => {
    toast(msg || fallback || t('sidebar.somethingWrong'))
    await reload()
  }

  /** Re-scan the workspace from disk (after any mutation). */
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

  // Reveal a folder by expanding it and every ancestor on the way down.
  const revealFolder = (nextTree: FileNode[], folderId: string) => {
    const chain = ancestorChain(nextTree, folderId)
    setExpanded((e) => {
      const next = { ...e }
      chain.forEach((id) => (next[id] = true))
      return next
    })
  }

  /** Drop selection / properties pointing at paths that no longer exist. */
  const reconcile = (next: FileNode[]) => {
    setPropsNode((p) => (p && !findNode(next, p.id) ? null : p))
    setActiveId((id) => (id && !findNode(next, id) ? null : id))
    setSelectedId((id) => (id && !findNode(next, id) ? null : id))
  }

  const onAction = async (action: ContextAction, node: FileNode) => {
    if (action === 'new-note-in') {
      if (node.kind !== 'folder') return
      revealFolder(tree, node.id)
      setInlineCreate({ folderId: node.id, type: 'note' })
    } else if (action === 'new-folder-in') {
      if (node.kind !== 'folder') return
      revealFolder(tree, node.id)
      setInlineCreate({ folderId: node.id, type: 'folder' })
    } else if (action === 'open') {
      if (node.kind !== 'folder') activateNote(node.id)
    } else if (action === 'paste') {
      if (node.kind !== 'folder') return
      let res = await window.api.invoke(IpcChannels.InvokePasteFiles, { targetPath: node.id })
      // Name conflicts: nothing was copied yet — ask, Finder style, and
      // apply the choice to every conflicting item.
      if (res.success && res.data?.conflicts?.length) {
        const c = res.data.conflicts
        const box = await window.api.invoke(IpcChannels.InvokeShowMessageBox, {
          type: 'question',
          title: t('sidebar.pasteTitle'),
          message:
            c.length === 1
              ? t('sidebar.pasteExistsOne', { name: c[0] })
              : t('sidebar.pasteExistsMany', { count: c.length }),
          detail: t('sidebar.pasteDetail'),
          buttons: [t('sidebar.keepBoth'), t('sidebar.replace'), t('common.cancel')],
          defaultId: 0,
          cancelId: 2,
        })
        const choice = box.success ? box.data?.response : 2
        if (choice === 2 || choice == null) return
        res = await window.api.invoke(IpcChannels.InvokePasteFiles, {
          targetPath: node.id,
          onConflict: choice === 0 ? 'keep-both' : 'replace',
        })
      }
      if (!res.success) return fail(res.error, t('sidebar.couldNotPaste'))
      const n = res.data?.copiedFiles.length ?? 0
      const failedCount = res.data?.failed ?? 0
      toast(
        n === 0 && failedCount === 0
          ? t('sidebar.nothingToPaste')
          : failedCount === 0
            ? t('sidebar.pasted', { count: n })
            : n === 0
              ? t('sidebar.couldNotPaste')
              : t('sidebar.pastedPartial', { count: n, failed: failedCount }),
      )
      if (n > 0) await reload()
    } else if (action === 'duplicate') {
      const res = await window.api.invoke(IpcChannels.InvokeCopyFile, { sourcePath: node.id })
      if (!res.success) return fail(res.error, t('sidebar.couldNotDuplicate'))
      await reload()
    } else if (action === 'move-picker') {
      setMoveSource(findNode(tree, node.id))
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
      const newPath = res.data.newPath
      const remap = (id: string) =>
        id === node.id
          ? newPath
          : isInsidePath(id, node.id)
            ? newPath + id.slice(node.id.length)
            : id
      if (openTabs.length) {
        const openIds = new Set(openTabs.map((tab) => tab.id))
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
      const next = await reload()
      setPropsNode((value) => (value ? findNode(next, remap(value.id)) : value))
      revealFolder(next, destId)
      reconcile(next)
    } else if (action === 'delete') {
      if (!window.confirm(t('sidebar.confirmTrash', { name: node.name }))) return
      // Close the session first (drops pending save timers, awaits any
      // in-flight write) so a timer can't resurrect the deleted file.
      await closeSession(node.id, { discard: true })
      const res = await window.api.invoke(IpcChannels.InvokeDeleteFile, { path: node.id })
      if (!res.success) {
        // The file survived but its session was discarded — rebuild it
        // from disk if the tab is still open, or edits become unsavable.
        if (appStore.get(tabsAtom).some((t) => t.id === node.id)) void reviveFromDisk(node.id)
        return fail(res.error, t('sidebar.couldNotTrash'))
      }
      closeTab(node.id)
      const next = await reload()
      reconcile(next)
    } else if (action === 'reveal') {
      window.api.invoke(IpcChannels.InvokeRevealInFinder, { path: node.id })
    } else if (action === 'copy-path') {
      copyText(node.id)
    } else if (action === 'copy-link') {
      // Captured pages copy their source URL; notes copy their wikilink.
      if (node.source?.url) copyText(node.source.url)
      else {
        const res = await window.api.invoke(IpcChannels.InvokeGetFileMeta, { path: node.id })
        const title =
          (res.success && res.data?.meta?.title) || node.name.replace(/\.(md|markdown)$/i, '')
        copyText(`[[${title}]]`)
      }
    } else if (action === 'info') {
      setPropsNode(findNode(tree, node.id))
    } else if (action === 'rename') {
      setRenameId(node.id)
    } else if (action === 'open-source') {
      // Frontmatter is file content — validate the scheme before handing
      // it to the system browser.
      const url = node.source?.url && safeExternalUrl(node.source.url)
      if (url) window.open(url, '_blank')
    }
  }

  const commitRename = async (id: string, raw: string | null) => {
    setRenameId(null)
    const name = raw ? safeName(raw) : ''
    const node = findNode(tree, id)
    if (!name || !node || name === node.name) return
    const res = await window.api.invoke(IpcChannels.InvokeRenameFile, {
      oldPath: id,
      newName: name,
    })
    if (!res.success) return fail(res.error, t('sidebar.couldNotRename'))
    // Success is judged on `success` alone; if data is missing (e.g. a stale
    // main process during dev), derive the new path from the old one.
    const cut = Math.max(id.lastIndexOf('/'), id.lastIndexOf('\\'))
    const newPath = res.data?.newPath ?? id.slice(0, cut + 1) + name
    const next = await reload()
    // Renaming a folder shifts every descendant path — remap by prefix so
    // the active row and the open Properties card follow along.
    const remap = (cur: string) =>
      cur === id ? newPath : cur.startsWith(id + '/') ? newPath + cur.slice(id.length) : cur
    setActiveId((cur) => (cur ? remap(cur) : cur))
    setSelectedId((cur) => (cur ? remap(cur) : cur))
    setPropsNode((p) => (p ? findNode(next, remap(p.id)) : p))
  }

  // Target folder for new note/folder: selected folder → selected file's
  // parent → Inbox → workspace root.
  const { newNoteLocation, treeSort } = useAtomValue(settingsAtom)
  const sortedTree = useMemo(() => sortNodes(tree, treeSort), [tree, treeSort])

  // Real on-disk footprint (includes .assets/.melo the tree hides) —
  // refreshed when the watcher reports changes, lightly debounced so a
  // burst of writes triggers one walk.
  const [wsBytes, setWsBytes] = useState<number | null>(null)
  useEffect(() => {
    if (!workspacePath) {
      setWsBytes(null)
      return
    }
    let alive = true
    let timer: ReturnType<typeof setTimeout> | null = null
    const measure = () => {
      window.api
        .invoke(IpcChannels.InvokeGetWorkspaceSize, { directoryPath: workspacePath })
        .then((res) => {
          if (alive && res.success && res.data) setWsBytes(res.data.bytes)
        })
    }
    measure()
    const off = window.api.on(IpcChannels.OnWorkspaceChanged, ({ kind }) => {
      if (kind !== 'filesystem') return
      if (timer) clearTimeout(timer)
      timer = setTimeout(measure, 2000)
    })
    return () => {
      alive = false
      if (timer) clearTimeout(timer)
      off()
    }
  }, [workspacePath])
  const createTarget = useMemo(() => {
    if (!workspacePath) return workspacePath
    if (newNoteLocation === 'inbox') return inboxId ?? workspacePath
    if (selectedId) {
      const node = findNode(tree, selectedId)
      if (node?.kind === 'folder') return node.id
      const sep = Math.max(selectedId.lastIndexOf('/'), selectedId.lastIndexOf('\\'))
      if (sep > 0) return selectedId.slice(0, sep)
    }
    return inboxId ?? workspacePath
  }, [selectedId, tree, workspacePath, inboxId, newNoteLocation])

  const doNewNote = () => {
    if (!workspacePath) return
    const folderId = createTarget ?? workspacePath
    if (folderId !== workspacePath) revealFolder(tree, folderId)
    setInlineCreate({ folderId, type: 'note' })
  }

  const doNewFolder = () => {
    if (!workspacePath) return
    const folderId = createTarget ?? workspacePath
    if (folderId !== workspacePath) revealFolder(tree, folderId)
    setInlineCreate({ folderId, type: 'folder' })
  }

  const commitInlineCreate = async (raw: string | null) => {
    const target = inlineCreate
    setInlineCreate(null)
    const base = raw ? safeName(raw) : ''
    if (!base || !target || !workspacePath) return
    if (target.type === 'note') {
      const name = base.includes('.') ? base : `${base}.md`
      const res = await window.api.invoke(IpcChannels.InvokeCreateFile, {
        parentPath: target.folderId,
        name,
      })
      if (!res.success) return fail(res.error, t('sidebar.couldNotCreateNote'))
      const next = await reload()
      if (target.folderId !== workspacePath) revealFolder(next, target.folderId)
      activateNote(res.data?.filePath ?? `${target.folderId}/${name}`)
    } else {
      const res = await window.api.invoke(IpcChannels.InvokeCreateDirectory, {
        parentPath: target.folderId,
        name: base,
      })
      if (!res.success) return fail(res.error, t('sidebar.couldNotCreateFolder'))
      const next = await reload()
      const newId = res.data?.directoryPath ?? `${target.folderId}/${base}`
      revealFolder(next, newId)
      selectFolder(newId)
    }
  }

  // App.tsx sets these atoms (from ⌘N, search-palette commands, etc.) to
  // signal "create a note/folder".  We react here, then clear the flag.
  useEffect(() => {
    if (!creating) return
    setCreating(false)
    doNewNote()
  }, [creating]) // eslint-disable-line
  useEffect(() => {
    if (!creatingFolder) return
    setCreatingFolder(false)
    doNewFolder()
  }, [creatingFolder]) // eslint-disable-line

  /** Drag a node into a folder. No-ops: itself, its descendants, its parent. */
  const onMoveNode = async (sourceId: string, folderId: string) => {
    setDraggingId(null)
    setDropId(null)
    if (sourceId === folderId) return
    // Not into a descendant (either path separator flavor).
    if (folderId.startsWith(sourceId + '/') || folderId.startsWith(sourceId + '\\')) return
    // Not into its current directory (a same-dir move would dupe as "(1)").
    // Trailing separators are normalized so filesystem roots compare too.
    const cut = Math.max(sourceId.lastIndexOf('/'), sourceId.lastIndexOf('\\'))
    const sourceDir = sourceId.slice(0, cut) || sourceId[cut]
    const strip = (p: string) => (p.length > 1 ? p.replace(/[\\/]+$/, '') : p)
    if (strip(sourceDir) === strip(folderId)) return
    const res = await window.api.invoke(IpcChannels.InvokeMoveFile, {
      sourcePath: sourceId,
      targetPath: folderId,
    })
    if (!res.success) return fail(res.error, t('sidebar.couldNotMove'))
    const next = await reload()
    revealFolder(next, folderId)
    reconcile(next)
  }

  // The shortcuts advertised in the context menu, acting on the selected
  // row whenever focus isn't in an input, the editor, or an open overlay.
  const keyCtx = useRef({ selectedId, tree, onAction, activeSmartId })
  keyCtx.current = { selectedId, tree, onAction, activeSmartId }

  // Top-bar "More" menu routes document actions here so copy-link /
  // reveal / info / trash have exactly one implementation. Untitled tabs
  // have no node in the tree — those actions quietly no-op.
  useEffect(() => {
    const onDocAction = (e: Event) => {
      const { action } = (e as CustomEvent<{ action: ContextAction }>).detail
      const id = appStore.get(activeTabIdAtom)
      if (!id) return
      const node = findNode(keyCtx.current.tree, id)
      if (node) void keyCtx.current.onAction(action, node)
    }
    window.addEventListener('melo:doc-action', onDocAction)
    return () => window.removeEventListener('melo:doc-action', onDocAction)
  }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (
        t?.closest(
          'input, textarea, select, button, a, [role="button"], [contenteditable="true"], [role="dialog"], [role="menu"]',
        )
      )
        return
      const { selectedId: id, tree: cur, onAction: act, activeSmartId: smart } = keyCtx.current
      if (!id || smart) return
      const node = findNode(cur, id)
      if (!node) return
      const mod = e.metaKey || e.ctrlKey
      if (e.key === 'F2' && !mod) {
        e.preventDefault()
        act('rename', node)
      } else if (e.key === 'Enter' && !mod) {
        e.preventDefault()
        act('open', node)
      } else if (e.key === 'Backspace' && !mod && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        act('delete', node)
      } else if (mod && !e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        act('duplicate', node)
      } else if (mod && !e.shiftKey && e.key.toLowerCase() === 'i') {
        e.preventDefault()
        act('info', node)
      } else if (mod && !e.shiftKey && e.key.toLowerCase() === 'l') {
        e.preventDefault()
        act('copy-link', node)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <aside className="sidebar">
      <div className="sb-top">
        {/* Spacer reserving room for the real macOS traffic lights
            (drawn by the OS via titleBarStyle: 'hidden'). */}
        <div className="sb-traffic-spacer" />
        <WorkspaceSwitcher />
      </div>

      <button className="sb-search" onClick={() => setSearchOpen(true)}>
        <Icon name="search" size={14} />
        <span className="sb-search-ph">{t('sidebar.searchWorkspace')}</span>
        <kbd>⌘K</kbd>
      </button>

      <div className="sb-section">
        <span>{t('sidebar.smartFolders')}</span>
        <button
          title={t('sidebar.newSmartFolder')}
          onClick={() =>
            setBuilder({ name: '', glyph: 'bookmark', rules: [newRule('Kind', smartVocab)] })
          }
        >
          <Icon name="plus" size={13} />
        </button>
      </div>
      <div className="sf-list">
        {smartFolders.map((f) => (
          <ContextMenu.Root key={f.id}>
            <ContextMenu.Trigger asChild>
              <button
                className={'sf-row' + (f.id === activeSmartId ? ' active' : '')}
                onClick={() => setActiveSmartId(f.id)}
              >
                <SIcon n={f.glyph} s={15} cls="sf-glyph" />
                <span className="sf-row-label">{f.name}</span>
                <span className="sb-count">{smartCounts[f.id] ?? 0}</span>
              </button>
            </ContextMenu.Trigger>
            <ContextMenu.Portal>
              <ContextMenu.Content className="ctx-menu">
                <ContextMenu.Item
                  className="ctx-item"
                  onSelect={() =>
                    setBuilder({ name: f.name, glyph: f.glyph, rules: f.rules, editId: f.id })
                  }
                >
                  <span className="ctx-ic">
                    <SIcon n="sliders" s={14} />
                  </span>
                  <span className="ctx-lbl">{t('ctx.editSmartFolder')}</span>
                </ContextMenu.Item>
                <ContextMenu.Separator className="ctx-sep" />
                <ContextMenu.Item
                  className="ctx-item danger"
                  onSelect={() =>
                    void deleteSmartView(f.id).then((ok) =>
                      toast(
                        ok
                          ? t('sidebar.deletedSmart', { name: f.name })
                          : t('sidebar.couldNotDeleteSmart'),
                      ),
                    )
                  }
                >
                  <span className="ctx-ic">
                    <SIcon n="trash" s={14} />
                  </span>
                  <span className="ctx-lbl">{t('ctx.delete')}</span>
                </ContextMenu.Item>
              </ContextMenu.Content>
            </ContextMenu.Portal>
          </ContextMenu.Root>
        ))}
      </div>

      <div className="sb-section">
        <span>{t('sidebar.workspace')}</span>
        <span className="sb-section-actions">
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button title={t('sidebar.sortTree')} data-on={treeSort !== 'name-asc' || undefined}>
                <Icon name="sortAsc" size={13} />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                className="ctx-menu sb-sort-menu"
                align="start"
                sideOffset={4}
                onCloseAutoFocus={(e) => e.preventDefault()}
              >
                <div className="sb-sort-head">{t('sidebar.sortBy')}</div>
                {(
                  [
                    [
                      ['name-asc', t('sidebar.sortNameAsc')],
                      ['name-desc', t('sidebar.sortNameDesc')],
                    ],
                    [
                      ['modified-desc', t('sidebar.sortModifiedDesc')],
                      ['modified-asc', t('sidebar.sortModifiedAsc')],
                    ],
                    [
                      ['created-desc', t('sidebar.sortCreatedDesc')],
                      ['created-asc', t('sidebar.sortCreatedAsc')],
                    ],
                  ] as [TreeSortRule, string][][]
                ).map((group, gi) => (
                  <div key={gi}>
                    {gi > 0 && <div className="ctx-sep" />}
                    {group.map(([value, label]) => (
                      <DropdownMenu.Item
                        key={value}
                        className={'ctx-item' + (treeSort === value ? ' sb-sort-on' : '')}
                        onSelect={() => setSetting('treeSort', value)}
                      >
                        <span className="ctx-lbl">{label}</span>
                        {/* Same selected-state language as the app's other
                            pickers: accent tick, right-aligned. */}
                        {treeSort === value && (
                          <span className="sb-sort-ck">
                            <Icon name="tick" size={13} />
                          </span>
                        )}
                      </DropdownMenu.Item>
                    ))}
                  </div>
                ))}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
          <button title={t('sidebar.newFolder')} onClick={doNewFolder}>
            <Icon name="folderPlus" size={13} />
          </button>
          <button title={t('sidebar.newNote')} onClick={doNewNote}>
            <Icon name="plus" size={13} />
          </button>
        </span>
      </div>

      <div
        className={'sb-tree' + (dropId === workspacePath ? ' drop-root' : '')}
        // The workspace top level has no row of its own — the tree's blank
        // area is its drop target (row handlers stop propagation, so only
        // drops outside folder rows land here).
        onDragOver={(e) => {
          if (!workspacePath) return
          if (!Array.from(e.dataTransfer.types).includes('application/x-melo-node')) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          setDropId(workspacePath)
        }}
        onDragLeave={() => {
          if (dropId === workspacePath) setDropId(null)
        }}
        onDrop={(e) => {
          if (!workspacePath) return
          const nodeId = e.dataTransfer.getData('application/x-melo-node')
          if (!nodeId) return
          e.preventDefault()
          void onMoveNode(nodeId, workspacePath)
        }}
      >
        {inlineCreate?.folderId === workspacePath && (
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
                  ? t('sidebar.folderNamePlaceholder')
                  : t('sidebar.noteNamePlaceholder')
              }
              onCommit={commitInlineCreate}
            />
          </div>
        )}
        {sortedTree.map((node) => (
          <TreeNode
            key={node.id}
            node={node}
            activeId={activeSmartId ? null : activeTabId}
            selectedId={activeSmartId ? null : selectedId}
            expanded={expanded}
            recentIds={[]}
            sortRule={treeSort}
            renameId={renameId}
            onRenameCommit={commitRename}
            inlineCreate={inlineCreate}
            onInlineCreateCommit={commitInlineCreate}
            draggingId={draggingId}
            onDragNode={setDraggingId}
            dropId={dropId}
            onDropHint={setDropId}
            onMoveNode={onMoveNode}
            onActivate={activateNote}
            onSelectFolder={selectFolder}
            onToggle={onToggle}
            onAction={onAction}
          />
        ))}
      </div>

      <div className="sb-bottom">
        <div className="sb-storage">
          {t('sidebar.local')}
          {wsBytes != null && <span className="sb-storage-size"> · {formatSize(wsBytes)}</span>}
        </div>
        <button
          className="sb-icon-btn"
          title={t('sidebar.revealWorkspace')}
          onClick={() =>
            workspacePath &&
            window.api.invoke(IpcChannels.InvokeRevealInFinder, { path: workspacePath })
          }
        >
          <Icon name="folderOpen" size={14} />
        </button>
        <button
          className="sb-icon-btn"
          title={t('sidebar.settings')}
          onClick={() => void window.api.invoke(IpcChannels.InvokeOpenSettingsWindow, undefined)}
        >
          <Icon name="dots" size={14} />
        </button>
      </div>

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
      <div
        className="sb-resize"
        onPointerDown={onResizeStart}
        onDoubleClick={onResetWidth}
        title={t('misc.dragResize')}
      />
    </aside>
  )
}
