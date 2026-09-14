import { useCallback, useEffect, useRef, useState } from 'react'
import { persistTabSessionNow } from '../../store/tabSession'
import { settingsAtom } from '../../store/settings'
import i18n from '../../i18n'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { EditorTopBar } from './EditorTopBar'
import { Tabs } from './Tabs'
import { EditorPage } from './EditorPage'
import { EmptyState } from './EmptyState'
import { BottomBar } from './BottomBar'
import { ShareCard, type SharePayload } from './ShareCard'
import {
  tabsAtom,
  activeTabIdAtom,
  activeTabAtom,
  openFileAtom,
  closeTabAtom,
  newTabAtom,
} from '../../store/editor'
import { activeNoteAtom } from '../../store/workspace'
import { appStore } from '../../store/appStore'
import { kindOf, isEditableKind, adoptWorkspace, workspaceName } from '../../lib/workspace'
import { activeSmartIdAtom } from '../../store/smart'
import { workspacePathAtom, workspaceSwitchingAtom, treeSelectionAtom } from '../../store/workspace'
import { ViewerPage } from './viewers/ViewerPage'
import { toast } from '../Toaster'
import { tocAtom } from '../../store/toc'
import {
  closeSession,
  flush,
  flushAll,
  getContent,
  promoteUntitled,
  snapshotDisplayed,
} from '../../store/documentSession'
import './editor.scss'
import './emptyState.scss'
import './block.scss'
import './overlays.scss'
import './table/table.scss'

export interface EditorProps {
  theme: 'light' | 'dark'
  sidebarAvailable?: boolean
  onLifecycleReadyChange?: (ready: boolean) => void
  onToggleSidebar: () => void
  onToggleOutline: () => void
  onToggleTheme: () => void
}

/** Current tabs/active-id, readable from stable event handlers without
 *  re-subscribing them on every render. */
const currentTabs = () => appStore.get(tabsAtom)
const currentActiveId = () => appStore.get(activeTabIdAtom)

const tabKind = (id: string) =>
  id.startsWith('untitled-') ? ('md' as const) : kindOf(id.split('/').pop() ?? '')

const decodeXmlEntities = (s: string): string =>
  s.replace(/&(amp|lt|gt|quot|apos|#x[0-9a-f]+|#\d+);/gi, (_, ent: string) => {
    if (ent === 'amp') return '&'
    if (ent === 'lt') return '<'
    if (ent === 'gt') return '>'
    if (ent === 'quot') return '"'
    if (ent === 'apos') return "'"
    const code = ent[1] === 'x' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10)
    return Number.isFinite(code) ? String.fromCodePoint(code) : ''
  })

/** Pull the target URL out of a bookmark file: .url (INI), .webloc
 *  (XML plist, entities decoded), or — Safari writes binary plists —
 *  any embedded http(s) string as a last resort. */
const bookmarkUrl = (content: string): string | null => {
  const ini = content.match(/^URL=(https?:\/\/\S+)$/m)
  if (ini) return ini[1].trim()
  const xml = content.match(/<string>(https?:\/\/[^<]+)<\/string>/)
  if (xml) return decodeXmlEntities(xml[1]).trim()
  const raw = content.match(/https?:\/\/[^\s"<>\0]+/)
  return raw ? raw[0].trim() : null
}

export const Editor = ({
  theme,
  sidebarAvailable = true,
  onLifecycleReadyChange,
  onToggleSidebar,
  onToggleOutline,
  onToggleTheme,
}: EditorProps) => {
  const editorWidth = useAtomValue(settingsAtom).editorWidth
  const tabs = useAtomValue(tabsAtom)
  const [activeTabId, setActiveTabId] = useAtom(activeTabIdAtom)
  const activeTab = useAtomValue(activeTabAtom)
  const openFile = useSetAtom(openFileAtom)
  const closeTab = useSetAtom(closeTabAtom)
  const newTab = useSetAtom(newTabAtom)

  const [activeNote, setActiveNote] = useAtom(activeNoteAtom)
  const [sharePayload, setSharePayload] = useState<SharePayload | null>(null)

  const dialogBusy = useRef(false)
  const externalOpenQueue = useRef<Promise<void>>(Promise.resolve())

  const saveAsUntitled = useCallback(async (tabId: string): Promise<boolean> => {
    if (dialogBusy.current) return false
    dialogBusy.current = true
    try {
      if (tabId === currentActiveId()) snapshotDisplayed()
      const md = getContent(tabId)
      if (!md) return false
      const res = await window.api.invoke(window.api.channels.InvokeSaveAs, {
        content: md,
        defaultPath: 'Untitled.md',
      })
      if (!res.success || !res.data) return false
      await promoteUntitled(tabId, res.data.filePath)
      return true
    } finally {
      dialogBusy.current = false
    }
  }, [])

  const promptSaveUntitled = async (title: string): Promise<'save' | 'discard' | 'cancel'> => {
    if (dialogBusy.current) return 'cancel'
    dialogBusy.current = true
    try {
      const res = await window.api.invoke(window.api.channels.InvokeShowMessageBox, {
        type: 'warning',
        title: i18n.t('dialogs.saveChangesTitle'),
        message: i18n.t('dialogs.saveChangesMsg', { title }),
        detail: i18n.t('dialogs.saveChangesDetail'),
        buttons: [i18n.t('dialogs.save'), i18n.t('dialogs.dontSave'), i18n.t('common.cancel')],
        defaultId: 0,
        cancelId: 2,
      })
      if (!res.success || !res.data) return 'cancel'
      return (['save', 'discard', 'cancel'] as const)[res.data.response] ?? 'cancel'
    } finally {
      dialogBusy.current = false
    }
  }

  // Returns true if OK to proceed, false if user cancelled.
  const guardDirtyUntitled = async (): Promise<boolean> => {
    const id = currentActiveId()
    if (!id?.startsWith('untitled-')) return true
    const tab = currentTabs().find((t) => t.id === id)
    if (!tab?.dirty) return true
    snapshotDisplayed()
    const action = await promptSaveUntitled(tab.title)
    if (action === 'save') {
      const saved = await saveAsUntitled(id)
      if (!saved) return false
    }
    return action !== 'cancel'
  }

  // Close a single tab with dirty-untitled guard. Returns false if user cancelled.
  const closeSingleTab = async (tabId: string): Promise<boolean> => {
    const tab = currentTabs().find((t) => t.id === tabId)
    if (!tab) return true
    if (tabId === currentActiveId()) snapshotDisplayed()
    if (tab.id.startsWith('untitled-') && tab.dirty) {
      const action = await promptSaveUntitled(tab.title)
      if (action === 'save') {
        const saved = await saveAsUntitled(tabId)
        if (!saved) return false
        // Save As promoted the tab to the new file path — it stays open
        // under its new identity (existing behavior).
        return true
      }
      if (action === 'cancel') return false
      await closeSession(tabId, { discard: true })
    } else {
      // Real files flush inside closeSession. If that save fails the
      // session survives and we keep the tab open — closing would drop
      // the unsaved content on the floor.
      const ok = await closeSession(tabId, { discard: tab.id.startsWith('untitled-') })
      if (!ok) return false
    }
    closeTab(tabId)
    return true
  }

  const hasTabs = tabs.length > 0

  // Bookmarks never become tabs — resolve the URL and jump to the browser.
  const openPathOrBookmark = useCallback(
    async (filePath: string) => {
      if (tabKind(filePath) === 'bookmark') {
        const res = await window.api.invoke(window.api.channels.InvokeReadFile, { filePath })
        const url = res.success && res.data ? bookmarkUrl(res.data.content) : null
        if (url) void window.api.invoke(window.api.channels.InvokeOpenExternal, { url })
        else toast('Could not read a link from this bookmark')
        return
      }
      if (!(await guardDirtyUntitled())) return
      openFile(filePath)
    },
    [openFile], // eslint-disable-line react-hooks/exhaustive-deps
  )

  // When sidebar/search sets activeNoteAtom, open it as a tab
  useEffect(() => {
    if (!activeNote) return
    setActiveNote(null)
    void openPathOrBookmark(activeNote)
  }, [activeNote, setActiveNote, openPathOrBookmark])

  // Open files triggered from Finder / macOS open-file event
  useEffect(() => {
    return window.api.on(window.api.channels.OnFileOpened, ({ filePath }) => {
      externalOpenQueue.current = externalOpenQueue.current
        .then(() => openPathOrBookmark(filePath))
        .catch((error) => {
          console.error('[editor] external file open failed:', error)
          toast(i18n.t('opener.couldNotOpenFile'))
        })
    })
  }, [openPathOrBookmark])

  // File > New File (Cmd+N)
  useEffect(() => {
    return window.api.on(window.api.channels.FileNew, async () => {
      if (!(await guardDirtyUntitled())) return
      newTab()
    })
  }, [newTab]) // eslint-disable-line react-hooks/exhaustive-deps

  // Cmd+W — close current tab
  useEffect(() => {
    return window.api.on(window.api.channels.CloseCurrentTab, () => {
      const id = currentActiveId()
      if (id) void closeSingleTab(id)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Cmd+S — flush real files or Save As for untitled
  useEffect(() => {
    return window.api.on(window.api.channels.OnSave, () => {
      const id = currentActiveId()
      if (!id) return
      if (id.startsWith('untitled-')) void saveAsUntitled(id)
      else void flush(id)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Ctrl+Tab / Ctrl+Shift+Tab — cycle tabs
  useEffect(() => {
    const onKeyDown = async (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.key !== 'Tab') return
      e.preventDefault()
      const ts = currentTabs()
      if (ts.length <= 1) return
      const idx = ts.findIndex((t) => t.id === currentActiveId())
      if (idx < 0) return
      const next = e.shiftKey ? (idx - 1 + ts.length) % ts.length : (idx + 1) % ts.length
      if (!(await guardDirtyUntitled())) return
      setActiveTabId(ts[next].id)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [setActiveTabId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Workspace switch: same close-out discipline as quitting — flush real
  // files, walk the user through dirty untitleds, then drop every tab and
  // session before adopting the new directory. Cancel at any dialog aborts
  // and leaves the current workspace untouched.
  useEffect(() => {
    const onSwitch = async (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | { path?: string; name?: string; onComplete?: () => void }
        | undefined
      const target = detail?.path
      const name = detail?.name
      const complete = detail?.onComplete ?? (() => {})
      if (!target || target === appStore.get(workspacePathAtom)) return complete()
      // One switch at a time — overlapping switches would race tab
      // clearing against the first switch's restore.
      if (appStore.get(workspaceSwitchingAtom) !== null) return complete()
      appStore.set(workspaceSwitchingAtom, name ?? workspaceName(target))
      let commitSession = false
      try {
        // Confirm the target is readable before any destructive close-out —
        // failing after the tabs are gone would strand a half-closed state.
        const probe = await window.api.invoke(window.api.channels.InvokeListDirectory, {
          directoryPath: target,
        })
        if (!probe.success) {
          toast('Could not open that workspace')
          return
        }

        snapshotDisplayed()
        const failures = await flushAll()
        if (failures.length) {
          const names = failures.map((id) => id.split('/').pop() ?? id).join(', ')
          const res = await window.api.invoke(window.api.channels.InvokeShowMessageBox, {
            type: 'warning',
            title: i18n.t('session.saveFailedTitle'),
            message: i18n.t('dialogs.couldNotSave', { names }),
            detail: i18n.t('dialogs.switchDetail'),
            buttons: [i18n.t('dialogs.switch'), i18n.t('common.cancel')],
            defaultId: 1,
            cancelId: 1,
          })
          if (!res.success || res.data?.response !== 0) return
        }

        for (;;) {
          const next = currentTabs().find((t) => t.id.startsWith('untitled-') && t.dirty)
          if (!next) break
          const action = await promptSaveUntitled(next.title)
          if (action === 'save') {
            const saved = await saveAsUntitled(next.id)
            if (!saved) return
          }
          if (action === 'cancel') return
          if (action === 'discard') await closeSession(next.id, { discard: true })
        }

        // Everything is flushed (or explicitly abandoned) — force-close the
        // remaining sessions and clear the editor state for the new workspace.
        for (const t of currentTabs()) await closeSession(t.id, { discard: true })
        appStore.set(tabsAtom, [])
        appStore.set(activeTabIdAtom, null)
        appStore.set(activeSmartIdAtom, null)
        appStore.set(treeSelectionAtom, null)
        try {
          await adoptWorkspace(target)
        } catch {
          toast('Could not open that workspace')
        }
        commitSession = true
      } catch {
        toast('Could not open that workspace')
      } finally {
        appStore.set(workspaceSwitchingAtom, null)
        // Persistence was suppressed during the switch — commit only after
        // releasing that guard, matching the normal tab-session write path.
        if (commitSession) persistTabSessionNow()
        complete()
      }
    }
    window.addEventListener('melo:switch-workspace', onSwitch)
    return () => window.removeEventListener('melo:switch-workspace', onSwitch)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Flush before window close: save real files + handle untitled + signal ready.
  // A failed flush blocks the silent close — the user decides.
  useEffect(() => {
    const off = window.api.on(window.api.channels.FlushBeforeClose, async () => {
      // Every abort path must tell main to reset the close protocol —
      // otherwise its 30s fallback timer force-destroys the window later.
      const cancelClose = () => window.api.send(window.api.channels.CancelClose, undefined)

      snapshotDisplayed()
      const failures = await flushAll()
      if (failures.length) {
        const names = failures.map((id) => id.split('/').pop() ?? id).join(', ')
        const res = await window.api.invoke(window.api.channels.InvokeShowMessageBox, {
          type: 'warning',
          title: i18n.t('session.saveFailedTitle'),
          message: i18n.t('dialogs.couldNotSave', { names }),
          detail: i18n.t('dialogs.quitDetail'),
          buttons: [i18n.t('dialogs.quit'), i18n.t('common.cancel')],
          defaultId: 1,
          cancelId: 1,
        })
        if (!res.success || res.data?.response !== 0) return cancelClose()
      }

      for (;;) {
        const next = currentTabs().find((t) => t.id.startsWith('untitled-') && t.dirty)
        if (!next) break
        const action = await promptSaveUntitled(next.title)
        if (action === 'save') {
          const saved = await saveAsUntitled(next.id)
          if (!saved) return cancelClose() // user cancelled Save As
        }
        if (action === 'cancel') return cancelClose()
        if (action === 'discard') await closeSession(next.id, { discard: true })
      }

      window.api.send(window.api.channels.ReadyToClose, undefined)
    })
    // This effect comes after the workspace-switch listener above, so true
    // means both lifecycle-critical listeners are registered and can safely
    // take ownership from App.
    onLifecycleReadyChange?.(true)
    return () => {
      onLifecycleReadyChange?.(false)
      off()
    }
  }, [onLifecycleReadyChange]) // eslint-disable-line react-hooks/exhaustive-deps

  // --- Tab interaction handlers ---

  const handleSelectTab = useCallback(
    async (tabId: string) => {
      if (tabId === activeTabId) return
      if (!(await guardDirtyUntitled())) return
      setActiveTabId(tabId)
    },
    [activeTabId, setActiveTabId], // eslint-disable-line react-hooks/exhaustive-deps
  )

  const handleCloseTab = useCallback(
    (tabId: string) => void closeSingleTab(tabId),
    [], // eslint-disable-line react-hooks/exhaustive-deps
  )

  const handleCloseOthers = useCallback(async (keepId: string) => {
    const toClose = currentTabs()
      .filter((t) => t.id !== keepId)
      .map((t) => t.id)
    for (const id of toClose) {
      if (!(await closeSingleTab(id))) break
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleCloseToRight = useCallback(async (afterId: string) => {
    const ts = currentTabs()
    const idx = ts.findIndex((t) => t.id === afterId)
    if (idx < 0) return
    const toClose = ts.slice(idx + 1).map((t) => t.id)
    for (const id of toClose) {
      if (!(await closeSingleTab(id))) break
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleNewTab = useCallback(async () => {
    if (!(await guardDirtyUntitled())) return
    newTab()
  }, [newTab]) // eslint-disable-line react-hooks/exhaustive-deps

  // Non-editable tabs render a viewer over the (hidden, still-mounted)
  // editor — the Tiptap instance survives, no session is ever created.
  const activeKind = activeTab ? tabKind(activeTab.id) : null
  const viewerActive = activeKind !== null && !isEditableKind(activeKind)

  // The outline panel would otherwise keep showing the hidden document.
  const setToc = useSetAtom(tocAtom)
  useEffect(() => {
    if (viewerActive) setToc([])
  }, [viewerActive, setToc])

  return (
    <div className="editor-col">
      <EditorTopBar
        filePath={activeTab?.path ?? ''}
        theme={theme}
        empty={!hasTabs}
        viewerActive={viewerActive}
        sidebarAvailable={sidebarAvailable}
        onToggleSidebar={onToggleSidebar}
        onToggleOutline={onToggleOutline}
        onToggleTheme={onToggleTheme}
      />
      {hasTabs ? (
        <>
          <Tabs
            tabs={tabs}
            activeId={activeTabId ?? ''}
            onSelect={handleSelectTab}
            onClose={handleCloseTab}
            onCloseOthers={handleCloseOthers}
            onCloseToRight={handleCloseToRight}
            onNew={handleNewTab}
          />
          <div className="ed-scroll" data-viewer={viewerActive || undefined}>
            <div style={{ display: viewerActive ? 'none' : 'contents' }}>
              <EditorPage
                activeTabId={viewerActive ? null : activeTabId}
                title={activeTab?.title ?? 'Untitled'}
                width={editorWidth}
                onShare={setSharePayload}
              />
            </div>
            {viewerActive && activeTab && activeKind && (
              <ViewerPage
                key={activeTab.id}
                path={activeTab.id}
                kind={activeKind}
                name={activeTab.title}
              />
            )}
          </div>
          <BottomBar
            filePath={activeTab?.path ?? null}
            viewerKind={viewerActive ? activeKind : null}
          />
        </>
      ) : (
        <EmptyState />
      )}

      <ShareCard payload={sharePayload} onClose={() => setSharePayload(null)} />
    </div>
  )
}
