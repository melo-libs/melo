import { app, ipcMain } from 'electron'
import { execFile } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { z } from 'zod'
import { IpcChannels } from '../../shared/types/ipc'
import type { AgentCommandResult, AgentProvider, AgentSetup } from '../../shared/types/agent'
import { getMainWindow } from '../windows'
import { activeWorkspaceRoot } from '../api/indexer'
import { AgentService } from '../agent/agentService'
import { AgentSettings } from '../agent/storage/agentSettings'
import { ConversationStore } from '../agent/storage/conversationStore'
import { MemoryService } from '../agent/storage/memory'
import { DocumentAccess } from '../agent/workspace/documentAccess'
import { ChangeJournal } from '../agent/workspace/changeJournal'
import { WorkspaceAccess } from '../agent/workspace/workspaceAccess'
import { startWorkspaceTools } from '../agent/mcp/workspaceTools'
import { RuntimeEnvironment, adapterEntry } from '../agent/runtime/runtimeEnvironment'
import { createRuntimeFactory } from '../agent/runtime/runtime'
import { testAgentApi, validateAgentApi } from '../agent/runtime/apiConnection'
import { checkNativeAuthentication } from '../agent/runtime/nativeAuthentication'
import { NativeModels } from '../agent/runtime/nativeModels'
import { ApiModels } from '../agent/runtime/apiModels'
import { AGENT_API_SERVICES, canReuseAgentApiKey } from '../../shared/agentApi'

const execute = promisify(execFile)
const provider = z.enum(['claude', 'codex'])
const id = z.string().uuid()
const filePath = z.string().min(1).max(4096)
const COMMAND = z.discriminatedUnion('action', [
  z.object({ action: z.literal('setup'), provider: provider.optional() }),
  z.object({ action: z.literal('prepare'), conversationId: id }),
  z.object({ action: z.literal('check-sign-in'), provider }),
  z.object({ action: z.literal('select-provider'), provider }),
  z.object({ action: z.literal('native-options'), provider }),
  z.object({
    action: z.literal('native-option'),
    provider,
    category: z.enum(['model', 'thought_level']),
    value: z.string().min(1).max(256),
  }),
  z.object({ action: z.literal('install') }),
  z.object({ action: z.literal('login'), provider }),
  z.object({
    action: z.literal('api-models'),
    provider,
    apiService: z.enum(AGENT_API_SERVICES).optional(),
    baseUrl: z.string().max(2048),
    apiKey: z.string().max(4096).optional(),
    refresh: z.boolean().optional(),
  }),
  z.object({
    action: z.literal('test-connection'),
    provider,
    apiService: z.enum(AGENT_API_SERVICES).optional(),
    baseUrl: z.string().max(2048),
    model: z.string().max(256),
    apiKey: z.string().max(4096).optional(),
  }),
  z.object({
    action: z.literal('configure'),
    provider,
    access: z.enum(['native', 'api']),
    apiService: z.enum(AGENT_API_SERVICES).optional(),
    baseUrl: z.string().max(2048),
    model: z.string().max(256),
    apiKey: z.string().max(4096).optional(),
  }),
  z.object({ action: z.literal('current'), workspaceRoot: filePath }),
  z.object({
    action: z.literal('history'),
    before: z.number().int().positive().optional(),
    after: z.number().int().positive().optional(),
    around: z.string().min(1).max(256).optional(),
  }),
  z.object({
    action: z.literal('search-history'),
    query: z.string().max(1000),
    before: z.number().int().positive().optional(),
  }),
  z.object({ action: z.literal('delete-message'), messageId: z.string().min(1).max(256) }),
  z.object({ action: z.literal('clear-history') }),
  z.object({ action: z.literal('provider'), conversationId: id, provider }),
  z.object({
    action: z.literal('send'),
    conversationId: id,
    text: z.string().trim().min(1).max(32000),
    context: z.object({
      filePath: filePath.optional(),
      selection: z.string().max(24000).optional(),
    }),
  }),
  z.object({ action: z.literal('cancel'), conversationId: id }),
  z.object({
    action: z.literal('undo'),
    conversationId: id,
    changeIds: z.array(id).min(1).max(500),
  }),
  z.object({
    action: z.literal('permission'),
    conversationId: id,
    permissionId: id,
    allow: z.boolean(),
    conversation: z.boolean().optional(),
  }),
])
const REPLY = z.object({
  id,
  handled: z.boolean(),
  snapshot: z
    .object({ content: z.string().max(2 * 1024 * 1024), revision: z.string().length(64) })
    .optional(),
  error: z.string().max(1000).optional(),
})

let controller: ReturnType<typeof createController> | undefined
const suspensions = new Set<string>()
function createController() {
  const directory = path.join(app.getPath('userData'), 'agent')
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const settings = new AgentSettings(directory)
  const environment = new RuntimeEnvironment(path.join(directory, 'runtime'))
  const codexLauncher = path
    .join(app.getAppPath(), 'resources/agent/codex-launch.cjs')
    .replace('app.asar/', 'app.asar.unpacked/')
  const nativeModels = new NativeModels(settings, environment, codexLauncher)
  const apiModels = new ApiModels()
  const store = new ConversationStore(path.join(directory, 'conversations.db'))
  const memory = new MemoryService(directory)
  const documents = new DocumentAccess(() => getMainWindow()?.webContents ?? null)
  const journal = new ChangeJournal(store, documents, directory)
  const workspace = new WorkspaceAccess(documents, memory, journal, (query) =>
    store.searchHistory(query),
  )
  const service = new AgentService(
    store,
    memory,
    createRuntimeFactory({
      environment,
      codexLauncher,
      nativePreferences: (provider, signal) => nativeModels.resolve(provider, signal),
      configuration: (p) => settings.get(p),
      apiKey: (p) => settings.key(p),
      tools: (request) => startWorkspaceTools((signal) => workspace.operations(request, signal)),
    }),
    (view) => getMainWindow()?.webContents.send(IpcChannels.OnAgentView, view),
    suspensions,
    (id, conversationId, root) => workspace.undo(id, conversationId, root),
  )
  return { settings, environment, nativeModels, apiModels, store, documents, service, journal }
}
const getController = () => (controller ??= createController())

export async function suspendAgent(reason = 'workspace'): Promise<void> {
  suspensions.add(reason)
  if (controller)
    await Promise.all([controller.service.suspend(reason), controller.nativeModels.cancel()])
}
export function resumeAgent(reason = 'workspace'): void {
  suspensions.delete(reason)
  controller?.service.resume(reason)
}

async function setup(p?: AgentProvider): Promise<AgentSetup> {
  const { settings, environment, nativeModels } = getController()
  const configuration = settings.get(p)
  const node = await environment.findNode()
  const connectionProfile = (provider: AgentProvider) => {
    const profile = settings.get(provider)
    return {
      access: profile.access,
      apiConfigured: !!(profile.hasApiKey && profile.baseUrl.trim() && profile.model.trim()),
    }
  }
  return {
    configuration,
    connectionProfiles: { claude: connectionProfile('claude'), codex: connectionProfile('codex') },
    nativeControls:
      configuration.access === 'native' ? nativeModels.cached(configuration.provider) : undefined,
    runtimeAvailable: !!node,
    installing: environment.installing,
  }
}

export function setupAgentIPC(): void {
  ipcMain.on(IpcChannels.AgentDocumentReply, (event, value: unknown) => {
    const reply = REPLY.safeParse(value)
    if (reply.success) controller?.documents.reply(event.sender, reply.data)
  })
  ipcMain.handle(IpcChannels.AgentCommand, async (event, value: unknown) => {
    try {
      if (
        event.sender !== getMainWindow()?.webContents ||
        event.senderFrame !== event.sender.mainFrame
      )
        throw new Error('Invalid agent sender')
      const command = COMMAND.parse(value)
      const { settings, environment, nativeModels, apiModels, service, store, journal } =
        getController()
      const root = activeWorkspaceRoot()
      if ('workspaceRoot' in command && command.workspaceRoot !== root)
        throw new Error('Workspace is not active')
      if (
        'conversationId' in command &&
        service.open(command.conversationId).conversation.workspaceRoot !== root
      )
        throw new Error('Conversation belongs to a different workspace')
      let result: AgentCommandResult = {}
      switch (command.action) {
        case 'prepare':
          if (suspensions.size) throw new Error('Agent workspace is closing')
          await service.prepare(command.conversationId)
          result = {
            setup: await setup(service.open(command.conversationId).conversation.provider),
          }
          break
        case 'api-models':
        case 'test-connection': {
          const saved = settings.get(command.provider)
          const key =
            command.apiKey?.trim() ||
            (canReuseAgentApiKey(command.provider, saved, command)
              ? settings.key(command.provider)
              : undefined)
          if (!key) throw new Error('AGENT_API_KEY_REQUIRED')
          if (command.action === 'api-models')
            result = {
              apiCatalog: await apiModels.load({ ...command, apiKey: key }, command.refresh),
            }
          else await testAgentApi({ ...command, apiKey: key })
          break
        }
        case 'native-options':
        case 'native-option':
          if (suspensions.size) throw new Error('Agent workspace is closing')
          await nativeModels.load(
            command.provider,
            command.action === 'native-option'
              ? { category: command.category, value: command.value }
              : undefined,
          )
          result = { setup: await setup(command.provider) }
          break
        case 'select-provider':
          settings.select(command.provider)
          // Switching uses the panel's independently refreshed account state.
          result = { setup: await setup(command.provider) }
          break
        case 'check-sign-in': {
          const node = await environment.requireNode()
          result = { authentication: await checkNativeAuthentication(node, command.provider) }
          break
        }
        case 'setup':
          result = { setup: await setup(command.provider) }
          break
        case 'install':
          await environment.install()
          result = { setup: await setup() }
          break
        case 'login': {
          const node = await environment.requireNode()
          const args =
            command.provider === 'claude'
              ? ['--cli', 'auth', 'login', '--claudeai']
              : ['cli', 'login']
          const quote = (text: string) => "'" + text.replaceAll("'", "'\\''") + "'"
          const script = [node, adapterEntry(command.provider), ...args].map(quote).join(' ')
          if (process.platform !== 'darwin')
            throw new Error('Use the provider CLI to sign in, then return to Melo')
          await execute('osascript', [
            '-e',
            `tell application "Terminal" to do script ${JSON.stringify(script)}`,
            '-e',
            'tell application "Terminal" to activate',
          ])
          break
        }
        case 'configure': {
          let configuration = { ...command, apiKey: command.apiKey?.trim() }
          if (command.access === 'api') {
            const saved = settings.get(command.provider)
            const key =
              configuration.apiKey ||
              (canReuseAgentApiKey(command.provider, saved, command)
                ? settings.key(command.provider)
                : undefined)
            if (!key) throw new Error('AGENT_API_KEY_REQUIRED')
            const validated = validateAgentApi({ ...configuration, apiKey: key })
            configuration = {
              ...configuration,
              apiService: validated.apiService,
              baseUrl: validated.baseUrl,
              model: validated.model,
            }
          }
          await service.suspend('configuration')
          try {
            settings.save(configuration)
          } finally {
            service.resume('configuration')
          }
          result = { setup: await setup() }
          break
        }
        case 'current':
          result = { view: service.current(command.workspaceRoot, settings.get().provider) }
          break
        case 'history':
          if (
            [command.before, command.after, command.around].filter((value) => value !== undefined)
              .length > 1
          )
            throw new Error('Choose one history cursor')
          result = { history: store.history(command) }
          break
        case 'search-history':
          result = { search: store.searchHistory(command.query, command.before) }
          break
        case 'delete-message':
        case 'clear-history':
          await service.removeHistory(
            command.action === 'delete-message' ? command.messageId : undefined,
          )
          if (command.action === 'clear-history') await journal.clearBackups()
          result = {
            history: store.history(),
            ...(root ? { view: service.current(root, settings.get().provider) } : {}),
          }
          break
        case 'provider':
          result = { view: await service.setProvider(command.conversationId, command.provider) }
          break
        case 'send':
          if (
            command.context.filePath &&
            (path.isAbsolute(command.context.filePath) ||
              command.context.filePath.split(/[\\/]/).some((p) => p === '..'))
          )
            throw new Error('Invalid context path')
          result = { view: service.send(command.conversationId, command.text, command.context) }
          break
        case 'cancel':
          await service.cancel(command.conversationId)
          result = { view: service.open(command.conversationId) }
          break
        case 'undo':
          result = { view: await service.undo(command.conversationId, command.changeIds) }
          break
        case 'permission':
          service.respond(
            command.conversationId,
            command.permissionId,
            command.allow,
            command.conversation,
          )
          break
      }
      return { success: true, data: result }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Agent request failed',
      }
    }
  })
  app.on('will-quit', () => controller?.store.close())
}
