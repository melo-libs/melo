import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import i18n from './i18n'
import { resolveTheme, setSetting, settingsAtom } from './store/settings'
import { appStore } from './store/appStore'
import { initTabSessionPersistence } from './store/tabSession'
import { useAtomValue, useSetAtom } from 'jotai'
import { Sidebar } from './components/sidebar/Sidebar'
import { Editor } from './components/editor/Editor'
import { Outline } from './components/outline/Outline'
import { SmartView } from './components/smart/SmartView'
import { SmartBuilder } from './components/smart/SmartBuilder'
import { SearchPalette } from './components/search/SearchPalette'
import { WorkspaceOpener } from './components/WorkspaceOpener'
import { Toaster, toast } from './components/Toaster'
import { IpcChannels } from '@shared/types/ipc'
import { reconcileActiveWithDisk } from './store/documentSession'
import { activeSmartIdAtom, loadSmartWorkspaceAtom, refreshSmartMetaAtom } from './store/smart'
import { openFileAtom, tabsAtom } from './store/editor'
import {
  searchOpenAtom,
  treeCreatingAtom,
  treeCreatingFolderAtom,
  workspacePathAtom,
  workspaceTreeAtom,
} from './store/workspace'
import {
  adoptWorkspace,
  applyWorkspaceChanges,
  applyWorkspaceSources,
  loadTree,
  pickWorkspacePath,
  restoreWorkspacePath,
} from './lib/workspace'
import { openCodeGuide } from './lib/codeGuide'

const SIDEBAR_WIDTH_KEY = 'melo.sidebarWidth'
const SIDEBAR_WIDTH_DEFAULT = 260
const SIDEBAR_WIDTH_MIN = 220
const SIDEBAR_WIDTH_MAX = 420

const savedSidebarWidth = (): number => {
  const width = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY))
  return Number.isFinite(width) && width >= SIDEBAR_WIDTH_MIN && width <= SIDEBAR_WIDTH_MAX
    ? width
    : SIDEBAR_WIDTH_DEFAULT
}

/**
 * App shell — three-column grid (sidebar | editor | outline).
 * Boot restores the last workspace (a plain folder); without one the
 * opener page shows instead. Selecting a smart folder swaps the center
 * column for the SmartView results page (the editor stays mounted so
 * in-progress edits survive); opening a note returns to the editor.
 */
const App = () => {
  const settings = useAtomValue(settingsAtom)
  const [sidebarShown, setSidebarShown] = useState(true)
  const appRef = useRef<HTMLDivElement>(null)
  const sidebarWidthRef = useRef(0)
  if (sidebarWidthRef.current === 0) sidebarWidthRef.current = savedSidebarWidth()
  const sidebarResizeFrameRef = useRef<number | null>(null)
  const stopSidebarResizeRef = useRef<(() => void) | null>(null)
  const startSidebarResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    stopSidebarResizeRef.current?.()

    const startX = event.clientX
    const startWidth = sidebarWidthRef.current
    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const move = (pointerEvent: PointerEvent) => {
      const width = Math.round(
        Math.min(
          SIDEBAR_WIDTH_MAX,
          Math.max(SIDEBAR_WIDTH_MIN, startWidth + pointerEvent.clientX - startX),
        ),
      )
      sidebarWidthRef.current = width
      if (sidebarResizeFrameRef.current !== null) return
      sidebarResizeFrameRef.current = requestAnimationFrame(() => {
        sidebarResizeFrameRef.current = null
        appRef.current?.style.setProperty('--sidebar-w', `${sidebarWidthRef.current}px`)
      })
    }
    const cleanup = () => {
      if (sidebarResizeFrameRef.current !== null) {
        cancelAnimationFrame(sidebarResizeFrameRef.current)
        sidebarResizeFrameRef.current = null
      }
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      window.removeEventListener('blur', finish)
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
      if (stopSidebarResizeRef.current === cleanup) stopSidebarResizeRef.current = null
    }
    const finish = () => {
      cleanup()
      appRef.current?.style.setProperty('--sidebar-w', `${sidebarWidthRef.current}px`)
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidthRef.current))
    }

    stopSidebarResizeRef.current = cleanup
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
    window.addEventListener('blur', finish)
  }, [])
  const resetSidebarWidth = useCallback(() => {
    stopSidebarResizeRef.current?.()
    sidebarWidthRef.current = SIDEBAR_WIDTH_DEFAULT
    appRef.current?.style.setProperty('--sidebar-w', `${SIDEBAR_WIDTH_DEFAULT}px`)
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(SIDEBAR_WIDTH_DEFAULT))
  }, [])
  useEffect(() => () => stopSidebarResizeRef.current?.(), [])
  // The setting provides the startup state; the toggle is a per-session
  // choice and intentionally doesn't write back.
  const [outlineShown, setOutlineShown] = useState(settings.outlineByDefault)
  const toggleOutline = () => setOutlineShown((v) => !v)
  // Theme lives in settings; 'system' resolves against the OS and follows
  // its changes live.
  const [sysDark, setSysDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  )
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const fn = (e: MediaQueryListEvent) => setSysDark(e.matches)
    mq.addEventListener('change', fn)
    return () => mq.removeEventListener('change', fn)
  }, [])
  const theme: 'light' | 'dark' =
    settings.theme === 'system' ? (sysDark ? 'dark' : 'light') : settings.theme
  const [booting, setBooting] = useState(true)
  const workspacePath = useAtomValue(workspacePathAtom)
  const setTree = useSetAtom(workspaceTreeAtom)
  const smart = useAtomValue(activeSmartIdAtom) != null
  const hasTabs = useAtomValue(tabsAtom).length > 0
  const openFile = useSetAtom(openFileAtom)
  const setSearchOpen = useSetAtom(searchOpenAtom)
  const setTreeCreating = useSetAtom(treeCreatingAtom)
  const setTreeCreatingFolder = useSetAtom(treeCreatingFolderAtom)
  const loadSmartWorkspace = useSetAtom(loadSmartWorkspaceAtom)
  const refreshSmartMeta = useSetAtom(refreshSmartMetaAtom)

  // Boot restoration and Editor listener registration are both async. Keep
  // their lifecycle state explicit so menu commands and close requests never
  // have to infer readiness from atoms that may update before React commits.
  const bootingRef = useRef(true)
  const bootWaitersRef = useRef<Array<() => void>>([])
  const editorReadyRef = useRef(false)
  const editorWaitersRef = useRef<Array<() => void>>([])
  const openWorkspaceBusyRef = useRef(false)

  const waitForBoot = useCallback(() => {
    if (!bootingRef.current) return Promise.resolve()
    return new Promise<void>((resolve) => bootWaitersRef.current.push(resolve))
  }, [])

  const waitForEditor = useCallback(() => {
    if (editorReadyRef.current) return Promise.resolve()
    return new Promise<void>((resolve) => editorWaitersRef.current.push(resolve))
  }, [])

  const handleEditorReadyChange = useCallback((ready: boolean) => {
    editorReadyRef.current = ready
    if (!ready) return
    const waiters = editorWaitersRef.current.splice(0)
    for (const resolve of waiters) resolve()
  }, [])

  const openWorkspace = useCallback(async () => {
    if (openWorkspaceBusyRef.current) return
    openWorkspaceBusyRef.current = true
    try {
      // A restored workspace may update atoms before Editor has mounted. Wait
      // for restoration to settle so we neither start a second adoption nor
      // dispatch a switch event to a listener that does not exist yet.
      await waitForBoot()
      const dir = await pickWorkspacePath()
      if (!dir) return

      // Atom state tells us whether an Editor is expected; the explicit
      // lifecycle signal below tells us when its save/switch listeners are
      // actually ready.
      const editorExpected =
        appStore.get(workspacePathAtom) !== null || appStore.get(tabsAtom).length > 0
      if (editorExpected) {
        await waitForEditor()
        await new Promise<void>((resolve) => {
          window.dispatchEvent(
            new CustomEvent('melo:switch-workspace', {
              detail: { path: dir, onComplete: resolve },
            }),
          )
        })
      } else {
        await adoptWorkspace(dir)
      }
    } catch {
      toast(i18n.t('opener.couldNotOpen'))
    } finally {
      openWorkspaceBusyRef.current = false
    }
  }, [waitForBoot, waitForEditor])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  // Reading face for note bodies — a root attribute so plain CSS swaps it.
  useEffect(() => {
    document.documentElement.setAttribute('data-reading-font', settings.editorFont)
  }, [settings.editorFont])

  // Boot: restore the last-used workspace if it still exists.
  useEffect(() => {
    initTabSessionPersistence()
    ;(async () => {
      try {
        const dir = await restoreWorkspacePath()
        if (dir) await adoptWorkspace(dir)
      } catch {
        // Folder gone or unreadable — fall through to the opener.
      } finally {
        setBooting(false)
        bootingRef.current = false
        const waiters = bootWaitersRef.current.splice(0)
        for (const resolve of waiters) resolve()
      }
    })()
    // Boot-only on purpose.
  }, []) // eslint-disable-line

  // The main process always asks the renderer to flush before closing. If
  // Editor has not registered its guarded close listener yet (boot, opener,
  // or a render transition), there cannot be user edits to protect here, so
  // acknowledge immediately. Once ready, Editor is the sole close owner.
  useEffect(() => {
    return window.api.on(IpcChannels.FlushBeforeClose, () => {
      if (!editorReadyRef.current) window.api.send(IpcChannels.ReadyToClose, undefined)
    })
  }, [])

  // File → Open Folder remains available after entering standalone-file
  // mode. The welcome button and menu route through the same transition.
  useEffect(() => {
    return window.api.on(IpcChannels.OpenWorkspace, () => void openWorkspace())
  }, [openWorkspace])

  // Keep one stable bridge for cold-start and boot-time file events. Once
  // Editor has registered its guarded listener it owns delivery; before that
  // App opens the tab so the event cannot fall into a lifecycle gap.
  useEffect(() => {
    return window.api.on(IpcChannels.OnFileOpened, ({ filePath }) => {
      if (!editorReadyRef.current) openFile(filePath)
    })
  }, [openFile])

  // This effect is declared after the stable file bridge above. Main keeps
  // cold-start files queued until both the listener and workspace/session
  // restoration are ready, so restored tabs cannot steal focus afterward.
  useEffect(() => {
    if (booting) return
    window.api.send(IpcChannels.RendererReady, undefined)
  }, [booting])

  // Help → Melo's CODE Idea opens (or creates) the guide in the current
  // workspace. With no workspace, explain the prerequisite instead of
  // silently doing nothing or writing beside a standalone file.
  useEffect(() => {
    return window.api.on(IpcChannels.OpenCodeGuide, () => {
      void (async () => {
        const root = appStore.get(workspacePathAtom)
        if (!root) {
          toast(i18n.t('codeGuide.needsWorkspace'))
          return
        }
        const tree = appStore.get(workspaceTreeAtom)
        const result = await openCodeGuide({ tree, firstUseOnly: false })
        if (result.created) {
          const next = await loadTree(root).catch(() => null)
          if (next) setTree(next)
        }
        if (!result.opened) toast(i18n.t('codeGuide.couldNotOpen'))
      })()
    })
  }, [setTree])

  // Mirror external changes (Finder, other apps) for the workspace's whole
  // lifetime — the watcher lives here, not in the sidebar, so hiding the
  // sidebar doesn't stop syncing. Re-scans are idempotent, so overlap with
  // the sidebar's own post-operation reloads is fine.
  useEffect(() => {
    if (!workspacePath) return
    let alive = true
    let refreshing = false
    let refreshQueued = false
    let workspaceEventVersion = 0

    // Native watcher callbacks are already batched, but a second batch can
    // arrive while a large tree is crossing IPC. Keep at most one scan in
    // flight and collapse all overlap into one trailing refresh.
    const refreshTree = async () => {
      if (refreshing) {
        refreshQueued = true
        return
      }

      refreshing = true
      try {
        do {
          refreshQueued = false
          const versionAtStart = workspaceEventVersion
          try {
            const next = await loadTree(workspacePath)
            if (alive && versionAtStart === workspaceEventVersion) setTree(next)
            else if (alive) refreshQueued = true
          } catch {
            if (alive) toast(i18n.t('opener.couldNotReread'))
            return
          }
        } while (alive && refreshQueued)
      } finally {
        refreshing = false
      }
    }

    void window.api
      .invoke(IpcChannels.InvokeWatchWorkspace, { directoryPath: workspacePath })
      .then((result) => {
        if (alive && !result.success) toast(i18n.t('opener.couldNotWatch'))
      })
    void loadSmartWorkspace()
    const off = window.api.on(IpcChannels.OnWorkspaceChanged, (change) => {
      if (change.workspaceRoot !== workspacePath) return
      const { kind } = change
      if (kind === 'filesystem') {
        workspaceEventVersion += 1
        const applied = applyWorkspaceChanges(
          appStore.get(workspaceTreeAtom),
          workspacePath,
          change.changes,
          change.sources,
        )
        if (applied.complete) setTree(applied.tree)
        else void refreshTree()
        // The open document may be what changed — reload it if clean,
        // warn if it has unsaved local edits.
        void reconcileActiveWithDisk()
      } else if (kind === 'index') {
        workspaceEventVersion += 1
        setTree(applyWorkspaceSources(appStore.get(workspaceTreeAtom), change.sources))
      } else if (kind === 'watcher-error') {
        toast(i18n.t(change.retrying ? 'opener.watcherInterrupted' : 'opener.couldNotWatch'))
      } else if (kind === 'watcher-recovered') {
        // The native backend may have missed changes between failure and the
        // new subscription. Reconcile once after reconnecting.
        workspaceEventVersion += 1
        void refreshTree()
        void window.api
          .invoke(IpcChannels.InvokeInitIndex, { directoryPath: workspacePath })
          .then((result) => {
            if (alive && !result.success) toast(i18n.t('opener.couldNotReread'))
          })
        void reconcileActiveWithDisk()
      }
      // Index moved under the smart folders — refresh badges and vocab.
      void refreshSmartMeta()
    })
    return () => {
      alive = false
      off()
      void window.api.invoke(IpcChannels.InvokeUnwatchWorkspace, undefined)
    }
  }, [workspacePath, setTree, loadSmartWorkspace, refreshSmartMeta])

  // ⌘K opens the search palette; command-palette actions arrive as events.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      const key = e.key.toLowerCase()
      // Settings must be reachable even before a workspace is chosen.
      if (mod && key === ',') {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('melo:settings'))
        return
      }
      if (!workspacePath) return
      // ⌘K always toggles the palette, even from inside the editor.
      if (mod && key === 'k') {
        e.preventDefault()
        setSearchOpen((v) => !v)
      } else {
        // The remaining shortcuts must not fire while typing in the editor,
        // search input, or any other editable/interactive element.
        const t = e.target as HTMLElement | null
        if (t?.closest('input, textarea, [contenteditable="true"], [role="dialog"], [role="menu"]'))
          return
        if (mod && !e.shiftKey && key === 'n') {
          e.preventDefault()
          window.dispatchEvent(new CustomEvent('melo:new-note'))
        } else if (mod && e.shiftKey && key === 'c') {
          e.preventDefault()
          setSearchOpen(true)
        } else if (mod && key === '\\') {
          e.preventDefault()
          setSidebarShown((v) => !v)
        }
      }
    }
    const onTheme = () =>
      setSetting(
        'theme',
        resolveTheme(appStore.get(settingsAtom).theme) === 'dark' ? 'light' : 'dark',
      )
    const onSidebar = () => setSidebarShown((v) => !v)
    // These need the sidebar mounted — reveal it first, then set the atom.
    const onNew = () => {
      setSidebarShown(true)
      setTreeCreating(true)
    }
    const onNewFolder = () => {
      setSidebarShown(true)
      setTreeCreatingFolder(true)
    }
    const onSettings = () => void window.api.invoke(IpcChannels.InvokeOpenSettingsWindow, undefined)
    window.addEventListener('keydown', onKey)
    window.addEventListener('melo:settings', onSettings)
    window.addEventListener('melo:toggle-theme', onTheme)
    window.addEventListener('melo:toggle-sidebar', onSidebar)
    window.addEventListener('melo:new-note', onNew)
    window.addEventListener('melo:new-folder', onNewFolder)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('melo:settings', onSettings)
      window.removeEventListener('melo:toggle-theme', onTheme)
      window.removeEventListener('melo:toggle-sidebar', onSidebar)
      window.removeEventListener('melo:new-note', onNew)
      window.removeEventListener('melo:new-folder', onNewFolder)
    }
  }, [workspacePath, setSearchOpen, setTreeCreating, setTreeCreatingFolder])

  const openSingleFile = async () => {
    try {
      const res = await window.api.invoke(IpcChannels.InvokeOpenFile, undefined)
      if (res.success && res.data?.filePath) openFile(res.data.filePath)
      else if (!res.success) toast(i18n.t('opener.couldNotOpenFile'))
    } catch {
      toast(i18n.t('opener.couldNotOpenFile'))
    }
  }

  if (booting) return null
  if (!workspacePath && !hasTabs) {
    return (
      <>
        <WorkspaceOpener onOpenWorkspace={openWorkspace} onOpenFile={openSingleFile} />
        <Toaster />
      </>
    )
  }

  const showSidebar = !!workspacePath && sidebarShown

  return (
    <div
      ref={appRef}
      className="app"
      style={{ '--sidebar-w': `${sidebarWidthRef.current}px` } as CSSProperties}
      data-sidebar={showSidebar ? 'shown' : 'hidden'}
      data-outline={outlineShown && !smart && hasTabs ? 'shown' : 'hidden'}
      data-smart={smart || undefined}
    >
      {showSidebar ? (
        <Sidebar onResizeStart={startSidebarResize} onResetWidth={resetSidebarWidth} />
      ) : (
        <div className="app-region" />
      )}
      <div className="center-region">
        {smart && <SmartView />}
        <div className="center-pane">
          <Editor
            theme={theme}
            sidebarAvailable={!!workspacePath}
            onLifecycleReadyChange={handleEditorReadyChange}
            onToggleSidebar={() => setSidebarShown((v) => !v)}
            onToggleOutline={toggleOutline}
            onToggleTheme={() => setSetting('theme', theme === 'dark' ? 'light' : 'dark')}
          />
        </div>
      </div>
      {outlineShown && !smart && hasTabs ? <Outline /> : <div className="app-region" />}
      <SmartBuilder />
      <SearchPalette />
      <Toaster />
    </div>
  )
}

export default App
