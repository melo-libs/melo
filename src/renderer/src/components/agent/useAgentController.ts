import { useEffect, useRef, useState } from 'react'
import { useAtom, useAtomValue } from 'jotai'
import type {
  AgentCommand,
  AgentContext,
  AgentModelControl,
  AgentProvider,
  AgentSetup,
} from '@shared/types/agent'
import {
  agentCommand,
  agentAccountsAtom,
  agentHistoryAtom,
  agentSetupAtom,
  agentNativeCatalogsAtom,
  agentViewAtom,
  agentWindowAtom,
  type AgentModelLoadState,
} from '../../store/agent'
import { workspacePathAtom } from '../../store/workspace'
import { appStore } from '../../store/appStore'

const preparationKey = (id: string, { configuration: c }: AgentSetup) =>
  JSON.stringify([
    id,
    c.provider,
    c.access,
    c.baseUrl,
    c.model,
    c.hasApiKey,
    c.native?.model,
    c.native?.effort,
  ])

/** Conversation commands and loading state; geometry and scroll stay with the view. */
export function useAgentController(
  onConnectionRequired: (required: boolean) => void,
  connectionBusy = false,
) {
  const [state, setWindow] = useAtom(agentWindowAtom),
    [view, setView] = useAtom(agentViewAtom)
  const history = useAtomValue(agentHistoryAtom),
    setup = useAtomValue(agentSetupAtom),
    catalogs = useAtomValue(agentNativeCatalogsAtom),
    accounts = useAtomValue(agentAccountsAtom),
    root = useAtomValue(workspacePathAtom)
  const [commandBusy, setCommandBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(''),
    [modelRequests, setModelRequests] = useState<
      Partial<Record<AgentProvider, AgentModelLoadState>>
    >({})
  const pendingCommands = useRef(0)
  const pendingModels = useRef(new Set<AgentProvider>())
  const prepared = useRef('')
  const preparing = useRef('')
  const [preparation, setPreparation] = useState<AgentModelLoadState>({ status: 'idle' })
  const previousRoot = useRef(root)
  const running = !!view && !['idle', 'error'].includes(view.status)
  const selectedProvider = view?.conversation.provider ?? setup?.configuration.provider ?? 'claude'
  const modelLoad: AgentModelLoadState =
    modelRequests[selectedProvider] ??
    (setup?.configuration.access === 'native' && !setup.configuration.native
      ? preparation
      : { status: 'idle' })
  const busy = commandBusy || connectionBusy
  const accountStatus = accounts[selectedProvider].status
  const ready =
    !!root &&
    !!view &&
    !!setup?.runtimeAvailable &&
    setup.configuration.provider === selectedProvider &&
    !busy &&
    !loading &&
    (setup.configuration.access === 'api' ||
      (accountStatus === 'signed-in' && !!setup.configuration.native))
  const canSend =
    ready && (!running || view?.status === 'awaiting-permission') && !!state.draft.trim()
  const perform = async (work: () => Promise<unknown>): Promise<boolean> => {
    pendingCommands.current += 1
    setCommandBusy(true)
    setError('')
    try {
      await work()
      return true
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Agent request failed')
      return false
    } finally {
      pendingCommands.current -= 1
      setCommandBusy(pendingCommands.current > 0)
    }
  }
  useEffect(() => {
    if (previousRoot.current === root) return
    previousRoot.current = root
    setView(null)
    setWindow((state) => ({ ...state, context: {}, ...(!root ? { open: false } : {}) }))
    onConnectionRequired(false)
  }, [root, setView, setWindow, onConnectionRequired])
  useEffect(() => {
    if (!state.open || !root) return
    let live = true
    setLoading(true)
    setError('')
    void (async () => {
      const response = await agentCommand({ action: 'current', workspaceRoot: root })
      if (!live || appStore.get(workspacePathAtom) !== root) return
      await agentCommand({
        action: 'setup',
        provider: response.view!.conversation.provider,
      })
      if (!appStore.get(agentHistoryAtom)) await agentCommand({ action: 'history' })
    })()
      .catch((error) => {
        if (live) setError(error.message)
      })
      .finally(() => {
        if (live) setLoading(false)
      })
    return () => {
      live = false
    }
  }, [state.open, root, onConnectionRequired])
  useEffect(() => {
    if (
      !state.open ||
      loading ||
      busy ||
      !setup ||
      setup.configuration.provider !== selectedProvider
    )
      return
    if (
      !setup.runtimeAvailable ||
      (setup.configuration.access === 'native' &&
        (accountStatus === 'signed-out' || accountStatus === 'error'))
    )
      onConnectionRequired(true)
  }, [state.open, loading, busy, setup, selectedProvider, accountStatus, onConnectionRequired])
  useEffect(() => {
    if (!state.open) {
      prepared.current = ''
      return
    }
    if (
      loading ||
      connectionBusy ||
      !setup?.runtimeAvailable ||
      !view ||
      running ||
      view.conversation.workspaceRoot !== root ||
      setup.configuration.provider !== selectedProvider ||
      (setup.configuration.access === 'native' && accountStatus !== 'signed-in')
    )
      return
    const key = preparationKey(view.conversation.id, setup)
    if (prepared.current === key || preparing.current === key) return
    prepared.current = key
    preparing.current = key
    setPreparation({ status: 'loading' })
    void agentCommand({ action: 'prepare', conversationId: view.conversation.id })
      .then((response) => {
        if (preparing.current !== key) return
        if (response.setup) prepared.current = preparationKey(view.conversation.id, response.setup)
        setPreparation({ status: 'idle' })
      })
      .catch((error: Error) => {
        if (preparing.current === key) setPreparation({ status: 'error', message: error.message })
      })
      .finally(() => {
        if (preparing.current === key) preparing.current = ''
      })
  }, [
    state.open,
    loading,
    connectionBusy,
    setup,
    view,
    root,
    running,
    selectedProvider,
    accountStatus,
  ])
  const wasRunning = useRef(false)
  useEffect(() => {
    if (wasRunning.current && !running && !appStore.get(agentHistoryAtom)?.hasNewer)
      void agentCommand({ action: 'history' }).catch((error) => setError(error.message))
    wasRunning.current = running
  }, [running])
  const send = (text: string, context: AgentContext) => {
    if (!ready || !view || !text || (running && view.status !== 'awaiting-permission')) return false
    void perform(async () => {
      if (running) await agentCommand({ action: 'cancel', conversationId: view.conversation.id })
      if (history?.hasNewer) await agentCommand({ action: 'history' })
      await agentCommand({ action: 'send', conversationId: view.conversation.id, text, context })
      setWindow((current) => ({
        ...current,
        draft: current.draft.trim() === text ? '' : current.draft,
        context: current.context === context ? {} : current.context,
      }))
    })
    return true
  }
  const changeProvider = (provider: AgentProvider, stayInSettings = false) =>
    void perform(async () => {
      if (view)
        await agentCommand({ action: 'provider', conversationId: view.conversation.id, provider })
      const response = await agentCommand({ action: 'select-provider', provider })
      if (response.setup) {
        const authentication = appStore.get(agentAccountsAtom)[provider].status
        onConnectionRequired(
          stayInSettings ||
            !response.setup.runtimeAvailable ||
            (response.setup.configuration.access === 'native' &&
              (authentication === 'signed-out' || authentication === 'error')),
        )
      }
    })

  const loadModels = async () => {
    const provider = selectedProvider
    if (pendingModels.current.has(provider)) return
    pendingModels.current.add(provider)
    setModelRequests((current) => ({ ...current, [provider]: { status: 'loading' } }))
    try {
      const response = await agentCommand({ action: 'native-options', provider })
      if (!response.setup?.nativeControls) throw new Error('AGENT_MODELS_UNAVAILABLE')
      setModelRequests((current) => ({ ...current, [provider]: { status: 'idle' } }))
    } catch (error) {
      setModelRequests((current) => ({
        ...current,
        [provider]: {
          status: 'error',
          message: error instanceof Error ? error.message : 'AGENT_MODELS_UNAVAILABLE',
        },
      }))
    } finally {
      pendingModels.current.delete(provider)
    }
  }
  const changeModel = (category: AgentModelControl['category'], value: string) =>
    void perform(() =>
      agentCommand({ action: 'native-option', provider: selectedProvider, category, value }),
    )

  const loadHistory = (cursor: Omit<Extract<AgentCommand, { action: 'history' }>, 'action'> = {}) =>
    perform(() => agentCommand({ action: 'history', ...cursor }))
  const respond = (
    conversationId: string,
    permissionId: string,
    allow: boolean,
    conversation = false,
  ) =>
    void perform(() =>
      agentCommand({ action: 'permission', conversationId, permissionId, allow, conversation }),
    )
  const undo = (conversationId: string, changeIds: string[]) =>
    void perform(() => agentCommand({ action: 'undo', conversationId, changeIds }))
  const deleteMessage = (messageId: string) =>
    void perform(() => agentCommand({ action: 'delete-message', messageId }))
  const cancel = () => {
    if (view)
      void perform(() => agentCommand({ action: 'cancel', conversationId: view.conversation.id }))
  }

  const catalog = setup && catalogs[setup.configuration.provider]
  const displayedSetup =
    setup?.configuration.access === 'native' &&
    catalog &&
    catalog.model === setup.configuration.native?.model
      ? { ...setup, nativeControls: catalog.controls }
      : setup
  return {
    state,
    setWindow,
    view,
    history,
    setup: displayedSetup,
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
  }
}
