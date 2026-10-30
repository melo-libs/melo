import { atom } from 'jotai'
import type {
  AgentAuthentication,
  AgentProvider,
  AgentCommand,
  AgentCommandResult,
  AgentContext,
  AgentSetup,
  AgentView,
  AgentHistoryPage,
  AgentModelControl,
} from '@shared/types/agent'
import { IpcChannels } from '@shared/types/ipc'
import { appStore } from './appStore'
import { workspacePathAtom } from './workspace'
import { activeTabIdAtom } from './editor'
import { handleAgentDocument } from './documentSession'

export const agentHistoryAtom = atom<AgentHistoryPage | null>(null)
export const agentViewAtom = atom<AgentView | null>(null)
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
export const agentWindowAtom = atom<{
  open: boolean
  collapsed: boolean
  context: AgentContext
  anchor: { x: number; y: number } | null
  draft: string
}>({ open: false, collapsed: false, context: {}, anchor: null, draft: '' })

export const agentMessagesAtom = atom((get) => {
  const history = get(agentHistoryAtom),
    view = get(agentViewAtom)
  const saved = history?.messages ?? []
  const map = new Map(saved.map((message) => [message.id, message]))
  if (view) {
    for (const message of view.messages) {
      const savedMessage = map.get(message.id)
      if (savedMessage) map.set(message.id, { ...savedMessage, ...message })
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
        conversationId: view.conversation.id,
        workspaceRoot: view.conversation.workspaceRoot,
        sequence: map.get(message.id)?.sequence ?? Number.MAX_SAFE_INTEGER,
      })
    }
  }
  return [...map.values()].sort((a, b) => a.createdAt - b.createdAt || a.sequence - b.sequence)
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
  const generation = ['setup', 'select-provider', 'configure', 'install', 'native-option'].includes(
    command.action,
  )
    ? ++setupGeneration
    : setupGeneration
  const historyRequest =
    command.action === 'clear-history' ||
    command.action === 'delete-message' ||
    (command.action === 'history' && command.before === undefined && command.after === undefined)
      ? ++historyGeneration
      : historyGeneration
  const response = await window.api.invoke(IpcChannels.AgentCommand, command)
  if (!response.success || !response.data) throw new Error(response.error ?? 'Agent request failed')
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
  options: { selection?: string; anchor?: { x: number; y: number }; draft?: string } = {},
): void {
  const root = appStore.get(workspacePathAtom)
  if (!root) return
  const file = appStore.get(activeTabIdAtom)
  appStore.set(agentWindowAtom, {
    open: true,
    collapsed: false,
    context: {
      ...(file?.startsWith(root + '/') ? { filePath: file.slice(root.length + 1) } : {}),
      ...(options.selection ? { selection: options.selection.slice(0, 24000) } : {}),
    },
    anchor: options.anchor
      ? { x: Math.round(options.anchor.x), y: Math.round(options.anchor.y) }
      : null,
    draft: options.draft ?? appStore.get(agentWindowAtom).draft,
  })
}

/** One app-level subscription also serves document requests when the chat is
 * hidden. Hiding a window must not orphan an in-flight approved edit. */
export function connectAgent(): () => void {
  const requests = new Map<string, AbortController>()
  const offView = window.api.on(IpcChannels.OnAgentView, (view) => {
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
    offView()
    offDocument()
    for (const controller of requests.values()) controller.abort()
  }
}
