import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import type { AgentContext } from '@shared/types/agent'
import { IpcChannels } from '@shared/types/ipc'
import { agentMessagesAtom } from '../../store/agent'
import { workspacePathAtom, treeSelectionAtom, recentNotesAtom } from '../../store/workspace'
import { openFileAtom } from '../../store/editor'
import { activeSmartIdAtom } from '../../store/smart'
import { appStore } from '../../store/appStore'
import { agentFilePath } from './agentFiles'
import { toast } from '../Toaster'
import { Icon } from '../Icon'
import { MeloLogo } from '../MeloLogo'
import { useAgentAccounts } from './useAgentAccounts'
import { AgentSettings } from './AgentSettings'
import { AgentDock } from './AgentDock'
import { AgentSource } from './AgentSource'
import { AgentTranscript } from './AgentTranscript'
import { AgentSearch } from './AgentSearch'
import { AgentComposer } from './AgentComposer'
import { agentErrorText } from './agentError'
import { useAgentGeometry } from './useAgentGeometry'
import { useAgentController } from './useAgentController'
import './agent.scss'

export const AgentWindow = () => {
  const { t } = useTranslation()
  const [settingsOpen, setSettingsOpen] = useState(false),
    [connectionBusy, setConnectionBusy] = useState(false),
    [searching, setSearching] = useState(false),
    [showLatest, setShowLatest] = useState(false),
    [headerScrolling, setHeaderScrolling] = useState(false),
    [highlight, setHighlight] = useState<string | null>(null)
  const {
    state,
    setWindow,
    view,
    history,
    setup,
    root,
    busy,
    loading,
    modelLoad,
    error,
    running,
    selectedProvider,
    ready,
    canSend,
    send,
    changeProvider,
    loadModels,
    changeModel,
    loadHistory,
    respond,
    undo,
    deleteMessage,
    cancel,
  } = useAgentController(setSettingsOpen, connectionBusy)
  const {
    accounts,
    check: checkAccount,
    login,
  } = useAgentAccounts(state.open && !!setup?.runtimeAvailable)
  const { panel, drag, resize, captureClick } = useAgentGeometry(
    state.open && !!root,
    state.anchor,
    state.collapsed,
  )
  const scroll = useRef<HTMLDivElement>(null),
    scrollTop = useRef(0),
    nearBottom = useRef(true),
    paging = useRef(false),
    prepend = useRef<{ height: number; top: number } | null>(null),
    jump = useRef<string | null>(null),
    headerIdle = useRef<ReturnType<typeof setTimeout> | null>(null)
  const messages = useAtomValue(agentMessagesAtom)
  const turnStart = view?.messages.map((message) => message.role).lastIndexOf('user') ?? -1
  const planMessage = view?.messages
    .slice(turnStart + 1)
    .filter((message) => message.plan)
    .at(-1)
  const plan = planMessage?.plan,
    inProgress = plan?.findIndex((entry) => entry.status === 'in_progress') ?? -1
  const step =
    inProgress >= 0 ? inProgress : (plan?.findIndex((entry) => entry.status === 'pending') ?? -1)
  const status = t(view?.permission ? 'agent.waitingForYou' : 'agent.working')
  const progress =
    plan && step >= 0 && !busy
      ? t('agent.stepProgress', { step: step + 1, total: plan.length, status })
      : status
  const lastSource = messages
    .filter((message) => message.role === 'user' && message.context?.filePath)
    .at(-1)
  const pendingSource =
    state.context.filePath &&
    (state.context.selection ||
      state.context.filePath !== lastSource?.context?.filePath ||
      root !== lastSource?.workspaceRoot)

  useLayoutEffect(() => {
    if (state.context.selection) {
      setSearching(false)
      nearBottom.current = true
      jump.current = null
    }
  }, [state.context])
  useLayoutEffect(() => {
    const el = scroll.current
    if (!el || searching || state.collapsed) return
    if (settingsOpen) return
    if (jump.current) {
      const target = [
        ...el.querySelectorAll<HTMLElement>('[data-message-id], [data-permission-id]'),
      ].find(
        (node) =>
          node.dataset.messageId === jump.current || node.dataset.permissionId === jump.current,
      )
      if (target) {
        target.scrollIntoView({ block: 'center' })
        scrollTop.current = el.scrollTop
        nearBottom.current = false
        jump.current = null
      }
      return
    }
    if (prepend.current) {
      el.scrollTop = prepend.current.top + el.scrollHeight - prepend.current.height
      prepend.current = null
    } else el.scrollTop = nearBottom.current ? el.scrollHeight : scrollTop.current
  }, [messages, view?.status, searching, settingsOpen, state.open, state.collapsed, state.context])
  useEffect(() => {
    setHeaderScrolling(false)
    return () => {
      if (headerIdle.current) clearTimeout(headerIdle.current)
    }
  }, [state.open, state.collapsed, searching, settingsOpen, root])
  useEffect(() => {
    if (!highlight) return
    const timer = setTimeout(() => setHighlight(null), 1800)
    return () => clearTimeout(timer)
  }, [highlight])

  const openFile = useCallback(
    async (relative: string, workspace = root) => {
      try {
        if (!workspace || !agentFilePath(relative)) throw Error(t('agent.fileUnavailable'))
        const expected = workspace.replace(/\/$/, '') + '/'
        const response = await window.api.invoke(IpcChannels.InvokeGetFileStats, {
          filePath: expected + relative,
        })
        if (
          !response.success ||
          !response.data ||
          response.data.isDirectory ||
          !response.data.canonicalPath.startsWith(expected)
        )
          throw Error(t('agent.fileUnavailable'))
        appStore.set(openFileAtom, response.data.canonicalPath)
        if (workspace === appStore.get(workspacePathAtom)) {
          appStore.set(treeSelectionAtom, response.data.canonicalPath)
          appStore.set(activeSmartIdAtom, null)
          appStore.set(recentNotesAtom, response.data.canonicalPath)
        }
      } catch (error) {
        toast(error instanceof Error ? error.message : t('agent.fileUnavailable'))
      }
    },
    [root, t],
  )
  const submit = (text = state.draft.trim(), context: AgentContext = state.context) => {
    if (send(text, context)) {
      setSearching(false)
      nearBottom.current = true
    }
  }
  const loadPage = async (direction: 'before' | 'after') => {
    if (paging.current || !history) return
    const cursor =
      direction === 'before' ? history.messages[0]?.sequence : history.messages.at(-1)?.sequence
    if (!cursor) return
    paging.current = true
    if (direction === 'before' && scroll.current)
      prepend.current = { height: scroll.current.scrollHeight, top: scroll.current.scrollTop }
    try {
      if (!(await loadHistory({ [direction]: cursor }))) prepend.current = null
    } finally {
      paging.current = false
    }
  }
  const openMessage = async (id: string) => {
    jump.current = id
    if (!(await loadHistory({ around: id }))) {
      jump.current = null
      return
    }
    nearBottom.current = false
    setHighlight(id)
    setSearching(false)
  }
  const returnLatest = async () => {
    nearBottom.current = true
    setShowLatest(false)
    if (await loadHistory())
      scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior: 'smooth' })
  }

  if (!state.open || !root) return null
  return (
    <div
      ref={panel}
      className="agent-window"
      role="dialog"
      aria-label={t('agent.title')}
      onPointerDown={state.collapsed ? drag : undefined}
      onClickCapture={captureClick}
      data-collapsed={state.collapsed || undefined}
      data-scrolling={(!state.collapsed && headerScrolling) || undefined}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.defaultPrevented && !event.nativeEvent.isComposing) {
          if (searching) return
          setWindow((state) => ({ ...state, open: false }))
        }
      }}
    >
      {state.collapsed ? (
        <AgentDock
          view={view}
          onExpand={() => setWindow((state) => ({ ...state, collapsed: false }))}
        />
      ) : searching ? (
        <AgentSearch
          onClose={() => setSearching(false)}
          onJump={openMessage}
          canAsk={ready && !running}
          onAsk={(query) => submit(t('agent.historyQuestion', { query }), {})}
        />
      ) : (
        <>
          <div className="agent-head" onPointerDown={drag}>
            {settingsOpen ? (
              <button
                className="agent-quiet agent-settings-back"
                aria-label={t('agent.back')}
                onClick={() => setSettingsOpen(false)}
              >
                <Icon name="chev" size={18} />
              </button>
            ) : (
              <span className="agent-brand" title={t('agent.drag')}>
                <MeloLogo size={26} />
                <Icon name="grip" size={18} />
              </span>
            )}
            <strong className="agent-conversation-title">
              {settingsOpen ? t('agent.connectionSettings') : 'Melo'}
            </strong>
            <div className="agent-head-actions">
              {!settingsOpen && (
                <button
                  className="agent-quiet"
                  aria-label={t('agent.searchHistory')}
                  title={t('agent.searchHistory')}
                  onClick={() => {
                    scrollTop.current = scroll.current?.scrollTop ?? scrollTop.current
                    setSearching(true)
                  }}
                >
                  <Icon name="search" size={16} />
                </button>
              )}
              <button
                className="agent-quiet agent-collapse"
                aria-label={t('agent.minimize')}
                aria-expanded={true}
                onClick={() => setWindow((state) => ({ ...state, collapsed: true }))}
              >
                <Icon name="minus" size={16} />
              </button>
              <button
                className="agent-quiet"
                aria-label={t('agent.hide')}
                onClick={() => setWindow((state) => ({ ...state, open: false }))}
              >
                <Icon name="x" size={16} />
              </button>
            </div>
          </div>
          <div
            className={`agent-body${settingsOpen ? ' agent-body-settings' : ''}`}
            ref={scroll}
            onScroll={() => {
              const el = scroll.current!
              if (headerIdle.current) clearTimeout(headerIdle.current)
              setHeaderScrolling(el.scrollTop > 1)
              headerIdle.current =
                el.scrollTop > 1 ? setTimeout(() => setHeaderScrolling(false), 180) : null
              if (settingsOpen || state.collapsed) return
              scrollTop.current = el.scrollTop
              nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
              setShowLatest(!nearBottom.current || !!history?.hasNewer)
              if (el.scrollTop < 48 && history?.hasOlder) void loadPage('before')
              else if (nearBottom.current && history?.hasNewer) void loadPage('after')
            }}
          >
            {settingsOpen && setup ? (
              <AgentSettings
                key={setup.configuration.provider}
                accounts={accounts}
                onCheckAccount={(provider) => void checkAccount(provider)}
                onLogin={login}
                disabled={busy}
                onProviderChange={(provider) => changeProvider(provider, true)}
                onBusyChange={setConnectionBusy}
              />
            ) : (
              <div className="agent-transcript">
                <AgentTranscript
                  messages={messages}
                  running={running}
                  busy={busy}
                  activeConversation={view?.conversation.id}
                  activeWorkspace={root}
                  activePlan={planMessage?.id}
                  activePermission={view?.permission?.id}
                  onRespond={respond}
                  highlight={highlight}
                  onOpenFile={openFile}
                  onOpenMessage={openMessage}
                  onDelete={deleteMessage}
                  onUndo={undo}
                />
                {pendingSource && (
                  <AgentSource
                    path={state.context.filePath!}
                    at={Date.now()}
                    onOpen={() => openFile(state.context.filePath!)}
                  />
                )}
                {(!messages.length || !!state.context.selection) && (
                  <div className="agent-empty">
                    <p className="agent-empty-intro">
                      {t(state.context.selection ? 'agent.selectionIntro' : 'agent.emptyIntro')}
                    </p>
                    <div className="agent-suggestions">
                      {(state.context.selection
                        ? (['explain', 'rewrite', 'example', 'translate'] as const)
                        : (['summarize', 'write', 'organize'] as const)
                      ).map((key) => (
                        <button
                          key={key}
                          onClick={() => submit(t(`agent.suggestion.${key}`))}
                          disabled={!ready || running}
                        >
                          <Icon
                            name={
                              key === 'write' || key === 'rewrite'
                                ? 'pencil'
                                : key === 'organize'
                                  ? 'folder'
                                  : key === 'translate'
                                    ? 'languages'
                                    : key === 'example'
                                      ? 'file'
                                      : 'lightbulb'
                            }
                            size={16}
                          />
                          <span>{t(`agent.suggestionLabel.${key}`)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {(error || view?.error) && (
                  <div className="agent-error" role="alert">
                    <strong>{t('agent.failed')}</strong>
                    <p>{agentErrorText(error || view?.error || '')}</p>
                    <button className="agent-quiet" onClick={() => setSettingsOpen(true)}>
                      {t('agent.connectionSettings')}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
          {!settingsOpen && (showLatest || history?.hasNewer) && (
            <button className="agent-latest agent-quiet" onClick={returnLatest}>
              <Icon name="arrowDown" size={14} />
              {t('agent.latest')}
            </button>
          )}
          {!settingsOpen && running && (
            <div className="agent-status" role="status">
              <span className="agent-status-dot" />
              {view?.permission ? (
                <button
                  className="agent-quiet"
                  onClick={() => {
                    if (history?.hasNewer) {
                      jump.current = view.permission!.id
                      void loadHistory().then((loaded) => {
                        if (!loaded) jump.current = null
                      })
                    } else
                      scroll.current
                        ?.querySelector('.agent-permission[data-pending]')
                        ?.scrollIntoView({ block: 'end', behavior: 'smooth' })
                  }}
                >
                  {progress}
                </button>
              ) : (
                progress
              )}
            </div>
          )}
          {!settingsOpen && (
            <AgentComposer
              draft={state.draft}
              context={state.context}
              setup={setup}
              provider={selectedProvider}
              running={running}
              interrupting={!!view?.permission && !!state.draft.trim()}
              busy={busy}
              loading={loading}
              modelLoad={modelLoad}
              canSend={canSend}
              focusKey={state.context}
              onDraft={(draft) => setWindow((state) => ({ ...state, draft }))}
              onSend={() => submit()}
              onStop={cancel}
              onProvider={changeProvider}
              onLoadModels={loadModels}
              onModelChange={changeModel}
              onSettings={() => setSettingsOpen(true)}
              onRemoveContext={() => setWindow((state) => ({ ...state, context: {} }))}
              onOpenFile={openFile}
            />
          )}
        </>
      )}
      {!state.collapsed && (
        <button
          className="agent-resize"
          tabIndex={-1}
          aria-label={t('agent.resize')}
          onPointerDown={resize}
        />
      )}
    </div>
  )
}
