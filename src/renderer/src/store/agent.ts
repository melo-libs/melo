import { canReuseAgentApiKey } from '@shared/agentApi'
import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import type {
  AgentAuthentication,
  AgentAttachment,
  AgentProvider,
  AgentCommand,
  AgentCommandResult,
  AgentContext,
  AgentSetup,
  AgentView,
  AgentHistoryPage,
  AgentModelControl,
  AgentFiling,
  AgentMessage,
} from '@shared/types/agent'
import { IpcChannels } from '@shared/types/ipc'
import { appStore } from './appStore'
import { workspacePathAtom } from './workspace'
import { activeTabIdAtom } from './editor'
import { handleAgentDocument } from './documentSession'

const agentFilingsAtom = atom(new Map<string, AgentFiling>())
const cacheFilingsAtom = atom(null, (get, set, messages: AgentMessage[]) => {
  const current = get(agentFilingsAtom)
  let next = current
  for (const { filing } of messages) {
    if (!filing || (next.get(filing.id)?.version ?? -1) >= filing.version) continue
    if (next === current) next = new Map(current)
    next.set(filing.id, filing)
  }
  if (next !== current) set(agentFilingsAtom, next)
})
const agentHistoryStateAtom = atom<AgentHistoryPage | null>(null)
export const agentHistoryAtom = atom(
  (get) => get(agentHistoryStateAtom),
  (_get, set, history: AgentHistoryPage | null) => {
    if (history) set(cacheFilingsAtom, history.messages)
    else set(agentFilingsAtom, new Map())
    set(agentHistoryStateAtom, history)
  },
)
const agentNoticeAtom = atom<{ conversationId: string; kind: 'ready' | 'error' } | null>(null)
const agentViewStateAtom = atom<AgentView | null>(null)
export const agentViewAtom = atom(
  (get) => get(agentViewStateAtom),
  (get, set, view: AgentView | null) => {
    const previous = get(agentViewStateAtom)
    const sameConversation = previous?.conversation.id === view?.conversation.id
    const finished =
      view?.status === 'idle' &&
      !!view.completedTurn &&
      sameConversation &&
      previous?.completedTurn !== view.completedTurn
    const failed = view?.status === 'error' && sameConversation && previous?.status !== 'error'
    if (!sameConversation || (view && !['idle', 'error'].includes(view.status)))
      set(agentNoticeAtom, null)
    const window = get(agentWindowAtom)
    if (view && (finished || failed))
      set(
        agentNoticeAtom,
        !window.open || window.collapsed
          ? { conversationId: view.conversation.id, kind: failed ? 'error' : 'ready' }
          : null,
      )
    if (view) set(cacheFilingsAtom, view.messages)
    set(agentViewStateAtom, view)
  },
)
export const agentIntakeAtom = atom<{
  workspaceRoot: string
  attachments: AgentAttachment[]
} | null>(null)
const agentRuntimeNoticeAtom = atom<'ready' | 'error' | null>(null)
export const agentSetupAtom = atom<AgentSetup | null>(null)
export const agentNativeCatalogsAtom = atom<
  Partial<
    Record<
      AgentProvider,
      {
        model: string
        controls: AgentModelControl[]
      }
    >
  >
>({})
export type AgentModelLoadState =
  | { status: 'idle' | 'loading' }
  | { status: 'error'; message: string }
export type AgentAccountState =
  | { status: 'checking' | 'unknown' }
  | AgentAuthentication
  | { status: 'error'; message: string }
export const agentAccountsAtom = atom<Record<AgentProvider, AgentAccountState>>({
  claude: { status: 'unknown' },
  codex: { status: 'unknown' },
})
export const agentEntrySeenAtom = atomWithStorage('melo.agent.entry-seen', false, undefined, {
  getOnInit: true,
})
type AgentWindowState = {
  open: boolean
  collapsed: boolean
  context: AgentContext
  anchor: { x: number; y: number } | null
  draft: string
}
const agentWindowStateAtom = atom<AgentWindowState>({
  open: false,
  collapsed: false,
  context: {},
  anchor: null,
  draft: '',
})
export const agentWindowAtom = atom(
  (get) => get(agentWindowStateAtom),
  (get, set, update: AgentWindowState | ((state: AgentWindowState) => AgentWindowState)) => {
    const next = typeof update === 'function' ? update(get(agentWindowStateAtom)) : update
    if (next.open && !next.collapsed) {
      set(agentNoticeAtom, null)
      set(agentRuntimeNoticeAtom, null)
    }
    set(agentWindowStateAtom, next)
  },
)

export type AgentMascotState = 'idle' | 'working' | 'waiting' | 'ready' | 'error' | 'offline'
export const agentPresenceAtom = atom((get): { state: AgentMascotState; label: string } => {
  const installation = get(agentSetupAtom)?.components
  if (
    installation &&
    Object.values(installation).some((component) =>
      ['downloading', 'preparing'].includes(component.status),
    )
  )
    return { state: 'working', label: 'agent.componentDownloading' }
  const runtimeNotice = get(agentRuntimeNoticeAtom)
  if (runtimeNotice)
    return {
      state: runtimeNotice,
      label: runtimeNotice === 'ready' ? 'agent.componentPrepared' : 'agent.componentFailed',
    }
  const root = get(workspacePathAtom)
  const current = get(agentViewAtom)
  const view = current?.conversation.workspaceRoot === root ? current : null
  const notice = get(agentNoticeAtom)
  if (view && notice?.conversationId === view.conversation.id)
    return { state: notice.kind, label: `agent.mascot.${notice.kind}Detail` }
  if (view?.status === 'awaiting-permission' && view.permission)
    return { state: 'waiting', label: 'agent.waitingForYou' }
  if (view && !['idle', 'error'].includes(view.status)) {
    const question = view.messages.findLast((message) => message.role === 'user')
    return {
      state: 'working',
      label: question?.context?.attachments?.length ? 'agent.processingFiles' : 'agent.working',
    }
  }
  const setup = get(agentSetupAtom)
  if (setup && (!view || setup.configuration.provider === view.conversation.provider)) {
    const configuration = setup.configuration
    const unavailable =
      !setup.runtimeAvailable ||
      (configuration.access === 'api'
        ? !configuration.hasApiKey || !configuration.baseUrl.trim() || !configuration.model.trim()
        : get(agentAccountsAtom)[configuration.provider].status === 'signed-out')
    if (unavailable) return { state: 'offline', label: 'agent.mascot.offline' }
  }
  return { state: 'idle', label: 'agent.mascot.idle' }
})

export const agentMessagesAtom = atom((get) => {
  const history = get(agentHistoryAtom),
    view = get(agentViewAtom)
  const saved = history?.messages ?? []
  const map = new Map(saved.map((message) => [message.id, message]))
  if (view) {
    for (const message of view.messages) {
      const savedMessage = map.get(message.id)
      if (savedMessage)
        map.set(message.id, {
          ...savedMessage,
          ...message,
          filing: message.filing ?? savedMessage.filing,
        })
    }
  }
  if (!history?.hasNewer && view) {
    for (const message of view.messages) {
      if (
        !map.has(message.id) &&
        history?.hasOlder &&
        message.createdAt < (saved[0]?.createdAt ?? 0)
      )
        continue
      map.set(message.id, {
        ...map.get(message.id),
        ...message,
        filing: message.filing ?? map.get(message.id)?.filing,
        conversationId: view.conversation.id,
        workspaceRoot: view.conversation.workspaceRoot,
        sequence: map.get(message.id)?.sequence ?? Number.MAX_SAFE_INTEGER,
      })
    }
  }
  const filings = get(agentFilingsAtom)
  return [...map.values()]
    .map((message) =>
      message.filing
        ? { ...message, filing: filings.get(message.filing.id) ?? message.filing }
        : message,
    )
    .sort((a, b) => a.createdAt - b.createdAt || a.sequence - b.sequence)
})

let setupGeneration = 0
const catalogGenerations: Record<AgentProvider, number> = { claude: 0, codex: 0 }
let historyGeneration = 0
export async function agentCommand(command: AgentCommand): Promise<AgentCommandResult> {
  const metadata = command.action === 'prepare' || command.action === 'native-options'
  const catalogProvider =
    command.action === 'prepare'
      ? (appStore.get(agentViewAtom)?.conversation.provider ??
        appStore.get(agentSetupAtom)?.configuration.provider)
      : 'provider' in command
        ? command.provider
        : undefined
  const catalogGeneration = catalogProvider
    ? ['native-options', 'native-option'].includes(command.action)
      ? ++catalogGenerations[catalogProvider]
      : catalogGenerations[catalogProvider]
    : undefined
  const generation = [
    'setup',
    'select-provider',
    'set-access',
    'configure',
    'install',
    'native-option',
  ].includes(command.action)
    ? ++setupGeneration
    : setupGeneration
  const historyRequest =
    command.action === 'clear-history' ||
    command.action === 'delete-message' ||
    (command.action === 'history' && command.before === undefined && command.after === undefined)
      ? ++historyGeneration
      : historyGeneration
  const response = await window.api.invoke(IpcChannels.AgentCommand, command)
  if (!response.success || !response.data) {
    if (response.data?.setup && generation === setupGeneration)
      appStore.set(agentSetupAtom, response.data.setup)
    throw new Error(response.error ?? 'Agent request failed')
  }
  if (command.action === 'clear-history') appStore.set(agentFilingsAtom, new Map())
  if (response.data.view) appStore.set(cacheFilingsAtom, response.data.view.messages)
  if (response.data.history) appStore.set(cacheFilingsAtom, response.data.history.messages)
  if (response.data.intake?.workspaceRoot === appStore.get(workspacePathAtom))
    appStore.set(agentIntakeAtom, response.data.intake)
  if (
    response.data.view &&
    response.data.view.conversation.workspaceRoot === appStore.get(workspacePathAtom)
  )
    appStore.set(agentViewAtom, response.data.view)
  if (response.data.history && historyRequest === historyGeneration) {
    const page = response.data.history
    const current = appStore.get(agentHistoryAtom)
    if (
      command.action === 'history' &&
      current &&
      (command.before !== undefined || command.after !== undefined)
    ) {
      const messages = [
        ...new Map(
          [...current.messages, ...page.messages].map((message) => [message.id, message]),
        ).values(),
      ].sort((a, b) => a.sequence - b.sequence)
      appStore.set(agentHistoryAtom, {
        messages,
        hasOlder: command.before !== undefined ? page.hasOlder : current.hasOlder,
        hasNewer: command.after !== undefined ? page.hasNewer : current.hasNewer,
      })
    } else appStore.set(agentHistoryAtom, page)
  }
  if (response.data.setup) {
    const next = response.data.setup
    const provider = next.configuration.provider
    const currentCatalog =
      provider === catalogProvider && catalogGeneration === catalogGenerations[provider]
    const native = next.configuration.native
    const controls = next.nativeControls
    if (currentCatalog && native && controls)
      appStore.set(agentNativeCatalogsAtom, (catalogs) => ({
        ...catalogs,
        [provider]: {
          model: native.model,
          controls,
        },
      }))
    if (metadata) {
      const current = appStore.get(agentSetupAtom)
      if (
        currentCatalog &&
        current?.configuration.provider === provider &&
        current.configuration.access === 'native' &&
        !current.configuration.native &&
        next.configuration.native
      )
        appStore.set(agentSetupAtom, {
          ...current,
          configuration: {
            ...current.configuration,
            native: next.configuration.native,
          },
        })
    } else if (generation === setupGeneration) appStore.set(agentSetupAtom, next)
  }
  return response.data
}

export function openAgent(
  options: {
    selection?: string
    anchor?: { x: number; y: number }
    draft?: string
    appendDraft?: boolean
  } = {},
): void {
  const root = appStore.get(workspacePathAtom)
  if (!root) return
  const file = appStore.get(activeTabIdAtom)
  const current = appStore.get(agentWindowAtom)
  appStore.set(agentWindowAtom, {
    open: true,
    collapsed: false,
    context:
      options.appendDraft && !options.selection
        ? current.context
        : {
            ...(options.selection && file?.startsWith(root + '/')
              ? { filePath: file.slice(root.length + 1) }
              : {}),
            ...(options.selection ? { selection: options.selection.slice(0, 24000) } : {}),
          },
    anchor:
      current.open && !current.collapsed
        ? current.anchor
        : options.anchor
          ? { x: Math.round(options.anchor.x), y: Math.round(options.anchor.y) }
          : null,
    draft:
      options.appendDraft &&
      options.draft &&
      current.draft.trim() &&
      current.draft.trim() !== options.draft.trim()
        ? `${current.draft}\n\n${options.draft}`
        : (options.draft ?? current.draft),
  })
}

/** One app-level subscription also serves document requests when the chat is
 * hidden. Hiding a window must not orphan an in-flight approved edit. */
export function connectAgent(): () => void {
  const requests = new Map<string, AbortController>()
  const offComponents = window.api.on(IpcChannels.OnAgentComponents, (components) => {
    const current = appStore.get(agentSetupAtom)
    if (!current) return
    const windowState = appStore.get(agentWindowAtom)
    if (!windowState.open || windowState.collapsed) {
      for (const provider of ['claude', 'codex'] as const) {
        const previous = current.components?.[provider].status
        if (previous && ['downloading', 'preparing'].includes(previous)) {
          if (components[provider].status === 'ready') appStore.set(agentRuntimeNoticeAtom, 'ready')
          if (components[provider].status === 'error') appStore.set(agentRuntimeNoticeAtom, 'error')
        }
      }
    }
    appStore.set(agentSetupAtom, {
      ...current,
      components,
      installing: Object.values(components).some((component) =>
        ['downloading', 'preparing'].includes(component.status),
      ),
      runtimeAvailable: components[current.configuration.provider].status === 'ready',
    })
  })
  const offVerification = window.api.on(
    IpcChannels.OnAgentApiVerificationInvalidated,
    (profile) => {
      const current = appStore.get(agentSetupAtom)
      if (!current) return
      const selected = current.configuration
      const matches =
        selected.provider === profile.provider &&
        selected.model === profile.model &&
        canReuseAgentApiKey(profile.provider, selected, profile)
      if (selected.provider === profile.provider && !matches) return
      appStore.set(agentSetupAtom, {
        ...current,
        configuration: matches ? { ...selected, apiVerified: false } : selected,
        ...(current.connectionProfiles && {
          connectionProfiles: {
            ...current.connectionProfiles,
            [profile.provider]: {
              ...current.connectionProfiles[profile.provider],
              apiVerified: false,
            },
          },
        }),
      })
    },
  )
  const offView = window.api.on(IpcChannels.OnAgentView, (view) => {
    appStore.set(cacheFilingsAtom, view.messages)
    if (view.conversation.workspaceRoot !== appStore.get(workspacePathAtom)) return
    if (appStore.get(agentViewAtom)?.conversation.id === view.conversation.id)
      appStore.set(agentViewAtom, view)
  })
  const offDocument = window.api.on(IpcChannels.OnAgentDocumentRequest, (request) => {
    if (request.action === 'cancel') {
      requests.get(request.id)?.abort()
      return
    }
    const controller = new AbortController()
    requests.set(request.id, controller)
    void handleAgentDocument(request, controller.signal)
      .then((reply) => {
        window.api.send(IpcChannels.AgentDocumentReply, reply)
      })
      .catch((error) => {
        window.api.send(IpcChannels.AgentDocumentReply, {
          id: request.id,
          handled: true,
          error: error instanceof Error ? error.message : 'Document operation failed',
        })
      })
      .finally(() => requests.delete(request.id))
  })
  return () => {
    offComponents()
    offVerification()
    offView()
    offDocument()
    for (const controller of requests.values()) controller.abort()
  }
}
