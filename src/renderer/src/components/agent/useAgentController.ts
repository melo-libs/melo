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
  agentIntakeAtom,
  agentWindowAtom,
  type AgentModelLoadState,
} from '../../store/agent'
import { workspacePathAtom } from '../../store/workspace'
import { activeTabIdAtom } from '../../store/editor'
import { appStore } from '../../store/appStore'
import { agentErrorText } from './agentError'

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
    intake = useAtomValue(agentIntakeAtom),
    setup = useAtomValue(agentSetupAtom),
    catalogs = useAtomValue(agentNativeCatalogsAtom),
    accounts = useAtomValue(agentAccountsAtom),
    root = useAtomValue(workspacePathAtom)
  const [commandBusy, setCommandBusy] = useState(false),
    [receivingFiles, setReceivingFiles] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(''),
    [modelRequests, setModelRequests] = useState<
      Partial<Record<AgentProvider, AgentModelLoadState>>
    >({})
  const pendingCommands = useRef(0)
  const pendingFiles = useRef(0)
  const pendingModels = useRef(new Set<AgentProvider>())
  const prepared = useRef('')
  const preparing = useRef('')
  const [preparation, setPreparation] = useState<AgentModelLoadState>({ status: 'idle' })
  const [providerSwitch, setProviderSwitch] = useState<{
    provider: AgentProvider
    target: AgentProvider
    setup: AgentSetup | null
    connected: boolean
    pending: boolean
  } | null>(null)
  const previousRoot = useRef(root)
  const running = !!view && !['idle', 'error'].includes(view.status)
  const selectedProvider = view?.conversation.provider ?? setup?.configuration.provider ?? 'claude'
  const modelLoad: AgentModelLoadState =
    modelRequests[selectedProvider] ??
    (setup?.configuration.access === 'native' && !setup.configuration.native
      ? preparation
      : { status: 'idle' })
  const busy = commandBusy || connectionBusy
  const submittedFiles = new Set(
    running
      ? view?.messages
          .filter((message) => message.role === 'user')
          .at(-1)
          ?.context?.attachments?.map((file) => file.id)
      : [],
  )
  const attachments =
    intake?.workspaceRoot === root
      ? intake.attachments.filter((file) => !submittedFiles.has(file.id))
      : []
  const accountStatus = accounts[selectedProvider].status
  const connected =
    !!setup?.runtimeAvailable &&
    setup.configuration.provider === selectedProvider &&
    (setup.configuration.access === 'api'
      ? !!(
          setup.configuration.hasApiKey &&
          setup.configuration.baseUrl &&
          setup.configuration.model
        )
      : accountStatus === 'signed-in')
  const switchingProvider =
    !!providerSwitch &&
    (providerSwitch.pending ||
      (!!setup?.runtimeAvailable &&
        setup.configuration.provider === providerSwitch.target &&
        setup.configuration.access === 'native' &&
        (accountStatus === 'unknown' || accountStatus === 'checking')))
  useEffect(() => {
    if (providerSwitch && !switchingProvider) setProviderSwitch(null)
  }, [providerSwitch, switchingProvider])
  const connectionChecking =
    !switchingProvider &&
    (((!setup ||
      !view ||
      view.conversation.workspaceRoot !== root ||
      setup.configuration.provider !== selectedProvider) &&
      !error) ||
      (!!setup?.runtimeAvailable &&
        setup.configuration.access === 'native' &&
        (accountStatus === 'unknown' || accountStatus === 'checking')))
  const ready =
    !switchingProvider &&
    !connectionChecking &&
    connected &&
    !!root &&
    !!view &&
    !busy &&
    !loading &&
    (setup?.configuration.access === 'api' || !!setup?.configuration.native)
  const canSend =
    ready &&
    !receivingFiles &&
    (!running || view?.status === 'awaiting-permission') &&
    (!!state.draft.trim() || attachments.length > 0)
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
    setProviderSwitch(null)
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
      !connected
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
    connected,
    setup,
    view,
    root,
    running,
    selectedProvider,
    accountStatus,
  ])
  const wasRunning = useRef(false)
  useEffect(() => {
    if (wasRunning.current && !running) {
      if (!appStore.get(agentHistoryAtom)?.hasNewer)
        void agentCommand({ action: 'history' }).catch((error) => setError(error.message))
      if (root)
        void agentCommand({ action: 'draft-attachments', workspaceRoot: root }).catch((error) =>
          setError(error.message),
        )
    }
    wasRunning.current = running
  }, [running, root])
  const send = (text: string, context: AgentContext) => {
    if (
      !ready ||
      !root ||
      receivingFiles ||
      !view ||
      !text ||
      (running && view.status !== 'awaiting-permission')
    )
      return false
    const activeFile = appStore.get(activeTabIdAtom)
    const submittedContext: AgentContext = {
      ...context,
      ...(attachments.length ? { attachments } : {}),
      activeFilePath: activeFile?.startsWith(root + '/') ? activeFile.slice(root.length + 1) : null,
    }
    void perform(async () => {
      if (running) await agentCommand({ action: 'cancel', conversationId: view.conversation.id })
      if (history?.hasNewer) await agentCommand({ action: 'history' })
      await agentCommand({
        action: 'send',
        conversationId: view.conversation.id,
        text,
        context: submittedContext,
      })
      setWindow((current) => ({
        ...current,
        draft: current.draft.trim() === text ? '' : current.draft,
        context: current.context === context ? {} : current.context,
      }))
    })
    return true
  }
  const changeProvider = async (provider: AgentProvider, stayInSettings = false) => {
    // The two commands update separate atoms; keep their intermediate mismatch out of the UI.
    setProviderSwitch({
      provider: selectedProvider,
      target: provider,
      setup,
      connected,
      pending: true,
    })
    const changed = await perform(async () => {
      if (view)
        await agentCommand({ action: 'provider', conversationId: view.conversation.id, provider })
      const response = await agentCommand({ action: 'select-provider', provider })
      if (response.setup) onConnectionRequired(stayInSettings)
    })
    setProviderSwitch((current) => (changed && current ? { ...current, pending: false } : null))
    return changed
  }

  const pasteAttachments = async (files?: File[], workspaceFile?: string): Promise<boolean> => {
    if (!root) return false
    pendingFiles.current++
    setReceivingFiles(true)
    try {
      const paths =
        files?.map((file) => window.api.getPathForFile(file)) ??
        (workspaceFile ? [workspaceFile] : undefined)
      if (paths && (paths.length > 20 || paths.some((file) => !file)))
        throw new Error('AGENT_ATTACHMENT_LIMIT')
      const result = await agentCommand(
        paths
          ? { action: 'drop-attachments', workspaceRoot: root, files: paths }
          : { action: 'paste-attachments', workspaceRoot: root },
      )
      if (result.intakeErrors?.length)
        setError(
          result.intakeErrors
            .map((item) => `${item.name}: ${agentErrorText(item.error)}`)
            .join('\n'),
        )
      return result.intakeHandled === true
    } catch (error) {
      setError(error instanceof Error ? error.message : 'AGENT_ATTACHMENT_CAPTURE_FAILED')
      return true
    } finally {
      pendingFiles.current--
      setReceivingFiles(pendingFiles.current > 0)
    }
  }
  const removeAttachment = (attachmentId: string) => {
    if (root)
      void perform(() =>
        agentCommand({ action: 'remove-attachment', workspaceRoot: root, attachmentId }),
      )
  }

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
      agentCommand({
        action: 'permission',
        conversationId,
        permissionId,
        allow,
        conversation,
      }),
    )
  const undo = (conversationId: string, changeIds: string[]) =>
    void perform(() => agentCommand({ action: 'undo', conversationId, changeIds }))
  const undoFiling = (conversationId: string, batchId: string) =>
    void perform(() => agentCommand({ action: 'undo-filing', conversationId, batchId }))
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
    setup: switchingProvider ? providerSwitch!.setup : displayedSetup,
    runtimeAvailable: !!setup?.runtimeAvailable,
    root,
    busy: busy || switchingProvider,
    loading,
    connectionChecking,
    modelLoad,
    error,
    running,
    selectedProvider: switchingProvider ? providerSwitch!.provider : selectedProvider,
    ready,
    connected: switchingProvider ? providerSwitch!.connected : connected && !connectionChecking,
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
  }
}
