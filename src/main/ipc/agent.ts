import { app, clipboard, ipcMain } from 'electron'
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
import { RuntimeEnvironment } from '../agent/runtime/runtimeEnvironment'
import { createRuntimeFactory } from '../agent/runtime/runtime'
import { testAgentApi, validateAgentApi } from '../agent/runtime/apiConnection'
import { checkNativeAuthentication } from '../agent/runtime/nativeAuthentication'
import { NativeModels } from '../agent/runtime/nativeModels'
import { ApiModels } from '../agent/runtime/apiModels'
import { AGENT_API_SERVICES, canReuseAgentApiKey } from '../../shared/agentApi'
import { FileIntake } from '../agent/storage/fileIntake'
import { getClipboardFiles } from '../api/fileOperations/clipboardOperations'
import { fileThumbnail } from '../libs/fileThumbnail'

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
  z.object({ action: z.literal('install'), provider }),
  z.object({ action: z.literal('cancel-install'), provider }),
  z.object({ action: z.literal('login'), provider }),
  z.object({
    action: z.literal('api-models'),
    provider,
    apiService: z.enum(AGENT_API_SERVICES).optional(),
    baseUrl: z.string().max(2048),
    apiKey: z.string().max(4096).optional(),
    refresh: z.boolean().optional(),
  }),
  z.object({ action: z.literal('test-connection'), provider }),
  z.object({ action: z.literal('set-access'), provider, access: z.enum(['native', 'api']) }),
  z.object({
    action: z.literal('configure'),
    provider,
    access: z.literal('api'),
    apiService: z.enum(AGENT_API_SERVICES).optional(),
    baseUrl: z.string().max(2048),
    model: z.string().max(256),
    apiKey: z.string().max(4096).optional(),
  }),
  z.object({ action: z.literal('current'), workspaceRoot: filePath }),
  z.object({ action: z.literal('paste-attachments'), workspaceRoot: filePath }),
  z.object({
    action: z.literal('drop-attachments'),
    workspaceRoot: filePath,
    files: z.array(filePath).min(1).max(20),
  }),
  z.object({ action: z.literal('attachment-preview'), workspaceRoot: filePath, attachmentId: id }),
  z.object({ action: z.literal('draft-attachments'), workspaceRoot: filePath }),
  z.object({ action: z.literal('remove-attachment'), workspaceRoot: filePath, attachmentId: id }),
  z.object({ action: z.literal('attachment'), workspaceRoot: filePath, attachmentId: id }),
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
      activeFilePath: filePath.nullable().optional(),
      filePath: filePath.optional(),
      selection: z.string().max(24000).optional(),
      attachments: z.array(z.object({ id })).max(20).optional(),
    }),
  }),
  z.object({ action: z.literal('cancel'), conversationId: id }),
  z.object({
    action: z.literal('undo'),
    conversationId: id,
    changeIds: z.array(id).min(1).max(500),
  }),
  z.object({ action: z.literal('undo-filing'), conversationId: id, batchId: id }),
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
  const environment = new RuntimeEnvironment(path.join(directory, 'runtime'), (components) => {
    getMainWindow()?.webContents.send(IpcChannels.OnAgentComponents, components)
  })
  const codexLauncher = path
    .join(app.getAppPath(), 'resources/agent/codex-launch.cjs')
    .replace('app.asar/', 'app.asar.unpacked/')
  const nativeModels = new NativeModels(settings, environment, codexLauncher)
  const apiModels = new ApiModels()
  const store = new ConversationStore(path.join(directory, 'conversations.db'))
  const intake = new FileIntake(path.join(directory, 'conversations.db'), directory)
  const memory = new MemoryService(directory)
  const documents = new DocumentAccess(() => getMainWindow()?.webContents ?? null)
  const journal = new ChangeJournal(store, documents, directory, intake)
  const workspace = new WorkspaceAccess(
    documents,
    memory,
    journal,
    (query) => store.searchHistory(query),
    intake,
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
      onApiAuthenticationFailed: (configuration, apiKey) => {
        if (settings.invalidateApiVerification({ ...configuration, apiKey })) {
          const { provider, baseUrl, model, apiService } = configuration
          getMainWindow()?.webContents.send(IpcChannels.OnAgentApiVerificationInvalidated, {
            provider,
            baseUrl,
            model,
            apiService,
          })
        }
      },
      tools: (request) => startWorkspaceTools((signal) => workspace.operations(request, signal)),
    }),
    (view) => getMainWindow()?.webContents.send(IpcChannels.OnAgentView, view),
    suspensions,
    (id, conversationId, root) => workspace.undo(id, conversationId, root),
    (conversation, id, signal) => workspace.receiveAttachment(conversation, id, signal),
  )
  return {
    settings,
    environment,
    nativeModels,
    apiModels,
    store,
    documents,
    service,
    journal,
    intake,
  }
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
  const components = await environment.inspect()
  const connectionProfile = (provider: AgentProvider) => {
    const profile = settings.get(provider)
    return {
      access: profile.access,
      apiVerified: profile.apiVerified,
      apiConfigured: !!(profile.hasApiKey && profile.baseUrl.trim() && profile.model.trim()),
    }
  }
  return {
    configuration,
    connectionProfiles: { claude: connectionProfile('claude'), codex: connectionProfile('codex') },
    nativeControls:
      configuration.access === 'native' ? nativeModels.cached(configuration.provider) : undefined,
    components,
    runtimeAvailable: components[configuration.provider].status === 'ready',
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
      const { settings, environment, nativeModels, apiModels, service, store, journal, intake } =
        getController()
      const root = activeWorkspaceRoot()
      if (
        'workspaceRoot' in command &&
        command.action !== 'attachment' &&
        command.action !== 'attachment-preview' &&
        command.workspaceRoot !== root
      )
        throw new Error('Workspace is not active')
      if (
        'conversationId' in command &&
        service.open(command.conversationId).conversation.workspaceRoot !== root
      )
        throw new Error('Conversation belongs to a different workspace')
      let result: AgentCommandResult = {}
      if (
        [
          'attachment-preview',
          'drop-attachments',
          'paste-attachments',
          'draft-attachments',
          'remove-attachment',
          'attachment',
          'current',
          'send',
          'clear-history',
        ].includes(command.action)
      )
        journal.reconcileAttachments()
      switch (command.action) {
        case 'attachment-preview': {
          const file = intake.get(command.workspaceRoot, command.attachmentId)
          const source = await intake.openPreview(command.workspaceRoot, file.id)
          try {
            result = { attachmentPreview: await fileThumbnail(source, file.name) }
          } finally {
            await source.close()
          }
          break
        }
        case 'drop-attachments':
        case 'paste-attachments': {
          if (suspensions.size || !root) throw new Error('Agent workspace is closing')
          const sources =
            command.action === 'drop-attachments' ? command.files : getClipboardFiles()
          // Read image bytes before awaiting file IO so another copy cannot replace this paste.
          const image = sources.length ? undefined : clipboard.readImage()
          const png = image && !image.isEmpty() ? image.toPNG() : undefined
          const errors: { name: string; error: string }[] = []
          for (const source of sources) {
            try {
              await intake.stageFile(root, source)
            } catch (error) {
              errors.push({
                name: path.basename(source),
                error:
                  error instanceof Error && error.message.startsWith('AGENT_')
                    ? error.message
                    : 'AGENT_ATTACHMENT_CAPTURE_FAILED',
              })
            }
          }
          if (png) {
            try {
              await intake.stageImage(root, png)
            } catch (error) {
              errors.push({
                name: 'Screenshot',
                error:
                  error instanceof Error && error.message.startsWith('AGENT_')
                    ? error.message
                    : 'AGENT_ATTACHMENT_CAPTURE_FAILED',
              })
            }
          }
          result = {
            intakeHandled: sources.length > 0 || !!png,
            intake: { workspaceRoot: root, attachments: intake.drafts(root) },
            ...(errors.length ? { intakeErrors: errors } : {}),
          }
          break
        }
        case 'draft-attachments':
          result = {
            intake: {
              workspaceRoot: command.workspaceRoot,
              attachments: intake.drafts(command.workspaceRoot),
            },
          }
          break
        case 'remove-attachment':
          await intake.remove(command.workspaceRoot, command.attachmentId)
          result = {
            intake: {
              workspaceRoot: command.workspaceRoot,
              attachments: intake.drafts(command.workspaceRoot),
            },
          }
          break
        case 'attachment':
          result = { attachment: intake.get(command.workspaceRoot, command.attachmentId) }
          break
        case 'prepare':
          if (suspensions.size) throw new Error('Agent workspace is closing')
          await service.prepare(command.conversationId)
          result = {
            setup: await setup(service.open(command.conversationId).conversation.provider),
          }
          break
        case 'api-models': {
          const saved = settings.get(command.provider)
          const key =
            command.apiKey?.trim() ||
            (canReuseAgentApiKey(command.provider, saved, command)
              ? settings.key(command.provider)
              : undefined)
          if (!key) throw new Error('AGENT_API_KEY_REQUIRED')
          result = {
            apiCatalog: await apiModels.load({ ...command, apiKey: key }, command.refresh),
          }
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
          const executable = await environment.requireProvider(command.provider)
          result = {
            authentication: await checkNativeAuthentication(
              executable,
              command.provider,
              await environment.requireNode(),
            ),
          }
          break
        }
        case 'setup':
          result = { setup: await setup(command.provider) }
          break
        case 'install':
          await environment.install(command.provider)
          result = { setup: await setup() }
          break
        case 'cancel-install':
          environment.cancel(command.provider)
          break
        case 'login': {
          const executable = await environment.requireProvider(command.provider)
          const args = command.provider === 'claude' ? ['auth', 'login', '--claudeai'] : ['login']
          const quote = (text: string) => "'" + text.replaceAll("'", "'\\''") + "'"
          const script = [executable, ...args].map(quote).join(' ')
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
        case 'set-access': {
          await service.suspend('configuration')
          try {
            settings.setAccess(command.provider, command.access)
          } finally {
            service.resume('configuration')
          }
          result = { setup: await setup(command.provider) }
          break
        }
        case 'test-connection':
        case 'configure': {
          const saved = settings.get(command.provider)
          const input = command.action === 'test-connection' ? saved : command
          const key =
            command.action === 'test-connection'
              ? settings.key(command.provider)
              : command.apiKey?.trim() ||
                (canReuseAgentApiKey(command.provider, saved, command)
                  ? settings.key(command.provider)
                  : undefined)
          if (!key) throw new Error('AGENT_API_KEY_REQUIRED')
          const validated = validateAgentApi({ ...input, provider: command.provider, apiKey: key })
          try {
            await testAgentApi(validated)
          } catch (error) {
            if (error instanceof Error && error.message === 'AGENT_API_AUTH_FAILED') {
              settings.invalidateApiVerification(validated)
              return {
                success: false,
                error: error.message,
                data: { setup: await setup(command.provider) },
              }
            }
            throw error
          }
          if (command.action === 'test-connection') {
            result = {}
            break
          }
          await service.suspend('configuration')
          try {
            settings.saveVerifiedApi(validated)
          } finally {
            service.resume('configuration')
          }
          result = { setup: await setup(command.provider) }
          break
        }
        case 'current':
          result = {
            view: service.current(command.workspaceRoot, settings.get().provider),
            intake: {
              workspaceRoot: command.workspaceRoot,
              attachments: intake.drafts(command.workspaceRoot),
            },
          }
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
          for (const contextPath of [command.context.filePath, command.context.activeFilePath]) {
            if (
              contextPath &&
              (path.isAbsolute(contextPath) || contextPath.split(/[\\/]/).some((p) => p === '..'))
            )
              throw new Error('Invalid context path')
          }
          result = {
            view: service.send(command.conversationId, command.text, {
              ...command.context,
              attachments: command.context.attachments?.map((file) => intake.get(root!, file.id)),
            }),
          }
          break
        case 'cancel':
          await service.cancel(command.conversationId)
          result = { view: service.open(command.conversationId) }
          break
        case 'undo':
          result = { view: await service.undo(command.conversationId, command.changeIds) }
          break
        case 'undo-filing':
          result = { view: await service.undoFiling(command.conversationId, command.batchId) }
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
  app.on('will-quit', () => {
    controller?.store.close()
    controller?.intake.close()
  })
}
