import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import type { AgentContext } from '@shared/types/agent'
import { IpcChannels } from '@shared/types/ipc'
import { agentCommand, agentMessagesAtom, agentEntrySeenAtom, openAgent } from '../../store/agent'
import { openWorkspaceFile } from '../../lib/documentLinks'
import { agentFilePath } from './agentFiles'
import { toast } from '../Toaster'
import { Icon } from '../Icon'
import { MeloLogo } from '../MeloLogo'
import { useAgentAccounts } from './useAgentAccounts'
import { AgentWelcome } from './AgentWelcome'
import { AgentSettings } from './AgentSettings'
import { AgentEntry } from './AgentEntry'
import { AgentTranscript } from './AgentTranscript'
import { AgentSearch } from './AgentSearch'
import { AgentComposer } from './AgentComposer'
import { agentErrorText } from './agentError'
import { useAgentGeometry } from './useAgentGeometry'
import { useAgentController } from './useAgentController'
import './agent.scss'

export const AgentWindow = () => {
  const { t } = useTranslation()
  const [settingsAccess, setSettingsAccess] = useState<'api'>()
  const openSettings = (access?: 'api') => {
    setSettingsAccess(access)
    setSettingsOpen(true)
  }
  const [settingsOpen, setSettingsOpen] = useState(false),
    [connectionBusy, setConnectionBusy] = useState(false),
    [searching, setSearching] = useState(false),
    [showLatest, setShowLatest] = useState(false),
    [headerScrolling, setHeaderScrolling] = useState(false),
    [highlight, setHighlight] = useState<string | null>(null)
  const [draggingFiles, setDraggingFiles] = useState(false)
  const {
    state,
    setWindow,
    view,
    history,
    setup,
    root,
    busy,
    loading,
    connectionChecking,
    modelLoad,
    error,
    running,
    selectedProvider,
    ready,
    connected,
    canSend,
    attachments,
    receivingFiles,
    pasteAttachments,
    removeAttachment,
    send,
    changeProvider,
    loadModels,
    changeModel,
    loadHistory,
    respond,
    undo,
    undoFiling,
    deleteMessage,
    cancel,
  } = useAgentController(setSettingsOpen, connectionBusy)
  const { accounts, check: checkAccount, login } = useAgentAccounts(state.open)
  const collapsed = !state.open || state.collapsed
  const setEntrySeen = useSetAtom(agentEntrySeenAtom)
  useEffect(() => {
    if (root && !collapsed) setEntrySeen(true)
  }, [root, collapsed, setEntrySeen])
  const { panel, drag, resize, captureClick } = useAgentGeometry(!!root, state.anchor, collapsed)
  const wasExpanded = useRef(false)
  useLayoutEffect(() => {
    if (collapsed && wasExpanded.current) panel.current?.querySelector('button')?.focus()
    wasExpanded.current = !collapsed
  }, [collapsed, panel])
  const collapse = () => {
    setWindow((state) => ({ ...state, collapsed: true }))
  }
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
  const status = t(
    view?.permission
      ? 'agent.waitingForYou'
      : view?.messages[turnStart]?.context?.attachments?.length
        ? 'agent.processingFiles'
        : 'agent.working',
  )
  const progress =
    plan && step >= 0 && !busy
      ? t('agent.stepProgress', { step: step + 1, total: plan.length, status })
      : status
  useLayoutEffect(() => {
    if (state.context.selection) {
      setSearching(false)
      nearBottom.current = true
      jump.current = null
    }
  }, [state.context])
  useLayoutEffect(() => {
    const el = scroll.current
    if (!el || searching || collapsed) return
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
  }, [messages, view?.status, searching, settingsOpen, state.open, collapsed, state.context])
  useEffect(() => {
    setHeaderScrolling(false)
    return () => {
      if (headerIdle.current) clearTimeout(headerIdle.current)
    }
  }, [state.open, collapsed, searching, settingsOpen, root])
  useEffect(() => {
    if (!highlight) return
    const timer = setTimeout(() => setHighlight(null), 1800)
    return () => clearTimeout(timer)
  }, [highlight])

  const openFile = useCallback(
    async (relative: string, workspace = root) => {
      try {
        if (relative.startsWith('melo-attachment:') && workspace) {
          const response = await agentCommand({
            action: 'attachment',
            workspaceRoot: workspace,
            attachmentId: relative.slice(16),
          })
          if (!response.attachment?.path) throw Error(t('agent.fileUnavailable'))
          relative = response.attachment.path
        }
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
        openWorkspaceFile(response.data.canonicalPath, workspace)
      } catch (error) {
        toast(error instanceof Error ? error.message : t('agent.fileUnavailable'))
      }
    },
    [root, t],
  )
  const submit = (
    text = state.draft.trim() || (attachments.length ? t('agent.organizeAttachments') : ''),
    context: AgentContext = state.context,
  ) => {
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

  if (!root) return null
  return (
    <div
      ref={panel}
      className="agent-window"
      onDragOver={(event) => {
        if (
          settingsOpen ||
          collapsed ||
          !connected ||
          !event.dataTransfer.types.some(
            (type) => type === 'Files' || type === 'application/x-melo-node',
          )
        )
          return
        event.preventDefault()
        event.stopPropagation()
        event.dataTransfer.dropEffect = 'copy'
        setDraggingFiles(true)
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setDraggingFiles(false)
      }}
      onDrop={(event) => {
        setDraggingFiles(false)
        if (settingsOpen || collapsed || !connected) return
        const files = Array.from(event.dataTransfer.files)
        const workspaceFile = event.dataTransfer.getData('application/x-melo-node')
        if (!files.length && !workspaceFile) return
        event.preventDefault()
        event.stopPropagation()
        if (files.length) void pasteAttachments(files)
        else if (workspaceFile.startsWith(root! + '/'))
          void pasteAttachments(undefined, workspaceFile)
      }}
      role={collapsed ? undefined : 'dialog'}
      aria-label={t('agent.title')}
      onPointerDown={collapsed ? drag : undefined}
      onClickCapture={captureClick}
      data-collapsed={collapsed || undefined}
      data-scrolling={(!collapsed && headerScrolling) || undefined}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.defaultPrevented && !event.nativeEvent.isComposing) {
          if (searching) return
          event.stopPropagation()
          collapse()
        }
      }}
    >
      {collapsed ? (
        <AgentEntry
          onOpen={() => {
            if (state.draft.trim() || state.context.selection || attachments.length)
              setWindow((state) => ({ ...state, open: true, collapsed: false }))
            else openAgent()
          }}
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
                className="agent-quiet"
                aria-label={t('agent.close')}
                title={t('agent.close')}
                onClick={collapse}
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
              if (settingsOpen || collapsed) return
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
                initialAccess={settingsAccess}
                accounts={accounts}
                onCheckAccount={(provider) => void checkAccount(provider)}
                onLogin={login}
                disabled={busy}
                onProviderChange={(provider) => changeProvider(provider, true)}
                onBusyChange={setConnectionBusy}
              />
            ) : (
              <div
                className={`agent-transcript${!messages.length ? ' agent-transcript-empty' : ''}`}
              >
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
                  onUndoFiling={undoFiling}
                />
                {!connected &&
                  !running &&
                  (setup || connectionChecking) &&
                  (!connectionChecking || !messages.length) && (
                    <AgentWelcome
                      checking={connectionChecking}
                      setup={setup}
                      accounts={accounts}
                      busy={busy || loading}
                      onProvider={changeProvider}
                      onLogin={login}
                      onCheck={checkAccount}
                      onSettings={() => openSettings('api')}
                    />
                  )}
                {connected && (!messages.length || !!state.context.selection) && (
                  <div className="agent-empty">
                    {!state.context.selection && (
                      <>
                        <span className="agent-welcome-logo">
                          <MeloLogo size={44} />
                        </span>
                        <h2>{t('agent.welcomeTitle')}</h2>
                      </>
                    )}
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
                          <Icon name="chev" size={14} />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {(error || view?.error) && (
                  <div className="agent-error" role="alert">
                    <strong>{t('agent.failed')}</strong>
                    <p>{agentErrorText(error || view?.error || '')}</p>
                    <button className="agent-quiet" onClick={() => openSettings()}>
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
              draggingFiles={draggingFiles}
              attachments={attachments}
              receivingFiles={receivingFiles}
              onPasteAttachments={pasteAttachments}
              onRemoveAttachment={removeAttachment}
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
              connected={connected}
              connectionChecking={connectionChecking}
              focusKey={state.context}
              onDraft={(draft) => setWindow((state) => ({ ...state, draft }))}
              onSend={() => submit()}
              onStop={cancel}
              onProvider={changeProvider}
              onLoadModels={loadModels}
              onModelChange={changeModel}
              onSettings={() => openSettings()}
              onRemoveContext={() => setWindow((state) => ({ ...state, context: {} }))}
              onOpenFile={openFile}
            />
          )}
        </>
      )}
      {!collapsed && (
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
