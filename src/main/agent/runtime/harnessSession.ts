import type { McpServer } from '@agentclientprotocol/sdk'
import type { AgentConfiguration } from '../../../shared/types/agent'
import { AcpConnection, type AcpConnectionOptions } from './acpConnection'
import { claudeApiConfiguration } from './claudeAccess'
import { claudeSession } from './claudeSession'
import { RuntimeEnvironment, adapterEntry } from './runtimeEnvironment'
import { codexLaunch } from './codexLaunch'
import { applyNativePreferences } from './nativeConfiguration'

const APPROVAL_TOOL_TIMEOUT_MS = 30 * 60 * 1000

export interface HarnessSessionOptions {
  environment: RuntimeEnvironment
  codexLauncher: string
  configuration: AgentConfiguration
  apiKey?: string
  workspaceRoot: string
  signal: AbortSignal
  mcpServers: Extract<McpServer, { type: 'http' }>[]
  onUpdate: AcpConnectionOptions['onUpdate']
  onPermission?: AcpConnectionOptions['onPermission']
}

export async function startHarnessConnection(options: HarnessSessionOptions) {
  const { configuration, apiKey } = options
  const node = await options.environment.requireNode()
  const env = { ...process.env }
  for (const name of [
    'ELECTRON_RUN_AS_NODE',
    'CLAUDECODE',
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_AUTH_TOKEN',
    'ANTHROPIC_BASE_URL',
    'ANTHROPIC_CUSTOM_HEADERS',
    'CLAUDE_CODE_USE_BEDROCK',
    'CLAUDE_CODE_USE_VERTEX',
    'CLAUDE_CODE_USE_FOUNDRY',
    'ANTHROPIC_MODEL',
    'ANTHROPIC_DEFAULT_OPUS_MODEL',
    'ANTHROPIC_DEFAULT_SONNET_MODEL',
    'ANTHROPIC_DEFAULT_HAIKU_MODEL',
    'CLAUDE_CODE_SUBAGENT_MODEL',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'OPENAI_API_KEY',
    'CODEX_API_KEY',
    'OPENAI_BASE_URL',
    'MODEL_PROVIDER',
    'CODEX_CONFIG',
    'DEFAULT_AUTH_REQUEST',
    'INITIAL_AGENT_MODE',
    'CLAUDE_CODE_EXECUTABLE',
    'CODEX_PATH',
    'APP_SERVER_LOGS',
    'MCP_TOOL_TIMEOUT',
    'MAX_THINKING_TOKENS',
    'CLAUDE_CODE_EFFORT_LEVEL',
  ])
    delete env[name]
  let disabledMcpServers: Awaited<ReturnType<typeof codexLaunch>> | undefined
  if (configuration.provider === 'codex') {
    disabledMcpServers = await codexLaunch(
      node,
      options.workspaceRoot,
      options.codexLauncher,
      env,
      options.signal,
    )
    env.INITIAL_AGENT_MODE = 'read-only'
  }
  if (configuration.provider === 'claude') {
    // Melo owns durable preferences; do not create a second harness-specific memory.
    env.MCP_TOOL_TIMEOUT = String(APPROVAL_TOOL_TIMEOUT_MS)
    env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1'
    env.CLAUDE_CODE_DISABLE_CLAUDE_MDS = '1'
    if (configuration.access === 'api') {
      if (!apiKey) throw new Error('AGENT_API_KEY_REQUIRED')
      Object.assign(
        env,
        claudeApiConfiguration({
          baseUrl: configuration.baseUrl,
          model: configuration.model,
          apiKey,
        }).environment,
      )
      for (const name of [
        'ANTHROPIC_MODEL',
        'ANTHROPIC_DEFAULT_OPUS_MODEL',
        'ANTHROPIC_DEFAULT_SONNET_MODEL',
        'ANTHROPIC_DEFAULT_HAIKU_MODEL',
        'CLAUDE_CODE_SUBAGENT_MODEL',
      ])
        env[name] = configuration.model
    }
  }
  if (disabledMcpServers) {
    // Human review must not share the harness's short default tool deadline.
    env.CODEX_CONFIG = JSON.stringify({
      mcp_servers: {
        ...disabledMcpServers,
        ...Object.fromEntries(
          options.mcpServers.map((server) => [
            server.name,
            {
              url: server.url,
              http_headers: Object.fromEntries(
                server.headers.map((header) => [header.name, header.value]),
              ),
              tool_timeout_sec: APPROVAL_TOOL_TIMEOUT_MS / 1000,
            },
          ]),
        ),
      },
      features: {
        shell_tool: false,
        apply_patch_freeform: false,
        plugins: false,
        memories: false,
        hooks: false,
      },
      ...((configuration.access === 'api' ? configuration.model : configuration.native?.model)
        ? {
            model:
              configuration.access === 'api' ? configuration.model : configuration.native?.model,
          }
        : {}),
      ...(configuration.access === 'native' && configuration.native?.effort
        ? { model_reasoning_effort: configuration.native.effort }
        : {}),
    })
  }
  const connection = await AcpConnection.start({
    signal: options.signal,
    launch: { command: node, args: [adapterEntry(configuration.provider)], env },
    workspaceRoot: options.workspaceRoot,
    clientCapabilities: { auth: { _meta: { gateway: true } } },
    onUpdate: options.onUpdate,
    onPermission: options.onPermission,
  })
  const abort = () => {
    void connection.close().catch((error) => console.error('Agent startup cleanup failed', error))
  }
  options.signal.addEventListener('abort', abort, { once: true })
  try {
    options.signal.throwIfAborted()
    if (configuration.provider === 'codex' && configuration.access === 'api') {
      if (!apiKey) throw new Error('AGENT_API_KEY_REQUIRED')
      await connection.authenticate({
        methodId: 'gateway',
        _meta: {
          gateway: {
            baseUrl: configuration.baseUrl,
            headers: { Authorization: `Bearer ${apiKey}` },
          },
        },
      })
    }
    return connection
  } catch (error) {
    await connection.close()
    throw error
  } finally {
    options.signal.removeEventListener('abort', abort)
  }
}

export async function createHarnessSession(
  connection: AcpConnection,
  options: HarnessSessionOptions,
) {
  const { configuration } = options
  const session = await connection.createSession(
    configuration.provider === 'claude'
      ? claudeSession(
          options.mcpServers,
          configuration.access === 'api' ? configuration.model : configuration.native?.model,
        )
      : { mcpServers: options.mcpServers },
  )
  const configOptions =
    configuration.access === 'native'
      ? await applyNativePreferences(connection, session.configOptions ?? [], configuration.native)
      : (session.configOptions ?? [])
  options.signal.throwIfAborted()
  return { connection, configOptions }
}

export async function openHarnessSession(options: HarnessSessionOptions) {
  const connection = await startHarnessConnection(options)
  const abort = () => {
    void connection.close().catch((error) => console.error('Agent session cleanup failed', error))
  }
  options.signal.addEventListener('abort', abort, { once: true })
  try {
    options.signal.throwIfAborted()
    return await createHarnessSession(connection, options)
  } catch (error) {
    await connection.close()
    throw error
  } finally {
    options.signal.removeEventListener('abort', abort)
  }
}
