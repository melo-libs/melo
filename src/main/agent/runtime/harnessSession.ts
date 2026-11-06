import type { McpServer } from '@agentclientprotocol/sdk'
import path from 'node:path'
import type { AgentConfiguration } from '../../../shared/types/agent'
import { AcpConnection, type AcpConnectionOptions } from './acpConnection'
import { claudeApiConfiguration } from './claudeAccess'
import { claudeSession } from './claudeSession'
import { EXECUTION_SECRET_ENV, executionInstructions } from './executionInstructions'
import { RuntimeEnvironment, adapterEntry } from './runtimeEnvironment'
import { codexLaunch, CODEX_API_PROVIDER, CODEX_API_KEY_ENV } from './codexLaunch'
import { applyNativePreferences } from './nativeConfiguration'
import { agentApiService, savedAgentApiService } from '../../../shared/agentApi'

const APPROVAL_TOOL_TIMEOUT_MS = 30 * 60 * 1000

export interface HarnessSessionOptions {
  environment: RuntimeEnvironment
  codexLauncher: string
  configuration: AgentConfiguration
  apiKey?: string
  workspaceRoot: string
  scratchDirectory?: string
  signal: AbortSignal
  mcpServers: Extract<McpServer, { type: 'http' }>[]
  onUpdate: AcpConnectionOptions['onUpdate']
  onPermission?: AcpConnectionOptions['onPermission']
}

export async function startHarnessConnection(
  options: HarnessSessionOptions & { mcpServerName?: string },
) {
  const { configuration, apiKey } = options
  const node = await options.environment.requireNode()
  const executable = await options.environment.requireProvider(configuration.provider)
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
    'ANTHROPIC_DEFAULT_FABLE_MODEL',
    'CLAUDE_CODE_SUBAGENT_MODEL',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'OPENAI_API_KEY',
    'CODEX_API_KEY',
    CODEX_API_KEY_ENV,
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
    'CLAUDE_CODE_TMPDIR',
  ])
    delete env[name]
  let disabledMcpServers: Awaited<ReturnType<typeof codexLaunch>> | undefined
  if (configuration.provider === 'codex') {
    disabledMcpServers = await codexLaunch(
      node,
      executable,
      options.workspaceRoot,
      options.codexLauncher,
      env,
      options.signal,
      configuration.access === 'api'
        ? {
            baseUrl: configuration.baseUrl,
            apiService: savedAgentApiService(
              'codex',
              configuration.baseUrl,
              configuration.apiService,
            ),
          }
        : undefined,
    )
    env.INITIAL_AGENT_MODE = 'agent-full-access'
    if (options.scratchDirectory) {
      env.TMPDIR = options.scratchDirectory
    }
    env.MELO_DISABLE_TITLE_GENERATION = '1'
    if (configuration.access === 'api') {
      if (!apiKey) throw new Error('AGENT_API_KEY_REQUIRED')
      env.MODEL_PROVIDER = CODEX_API_PROVIDER
      env[CODEX_API_KEY_ENV] = apiKey
    }
  }
  if (configuration.provider === 'claude') {
    env.PATH = `${path.dirname(node)}${path.delimiter}${env.PATH ?? ''}`
    env.CLAUDE_CODE_EXECUTABLE = executable
    if (options.scratchDirectory) {
      env.CLAUDE_CODE_TMPDIR = options.scratchDirectory
      env.TMPDIR = options.scratchDirectory
    }
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
          apiService: configuration.apiService,
          model: configuration.model,
          apiKey,
        }).environment,
      )
      for (const name of [
        'ANTHROPIC_MODEL',
        'ANTHROPIC_DEFAULT_OPUS_MODEL',
        'ANTHROPIC_DEFAULT_SONNET_MODEL',
        'ANTHROPIC_DEFAULT_HAIKU_MODEL',
        'ANTHROPIC_DEFAULT_FABLE_MODEL',
        'CLAUDE_CODE_SUBAGENT_MODEL',
      ])
        env[name] = configuration.model
    }
  }
  if (disabledMcpServers) {
    const apiModel =
      configuration.access === 'api'
        ? agentApiService(
            'codex',
            savedAgentApiService('codex', configuration.baseUrl, configuration.apiService),
          ).models.find((model) => model.id === configuration.model)
        : undefined
    // Human review must not share the harness's short default tool deadline.
    env.CODEX_CONFIG = JSON.stringify({
      sandbox_mode: 'danger-full-access',
      approval_policy: 'never',
      shell_environment_policy: { exclude: EXECUTION_SECRET_ENV },
      allow_login_shell: false,
      ...(options.scratchDirectory && {
        developer_instructions: executionInstructions(
          options.workspaceRoot,
          options.scratchDirectory,
        ),
      }),
      // Process launch selects this provider; keep per-session routing consistent.
      ...(configuration.access === 'api'
        ? {
            model_provider: CODEX_API_PROVIDER,
            // Explicitly override file-backed Terminal preferences. Medium is the
            // Harness default; known API models use their documented high level.
            model_reasoning_effort: apiModel?.effortLevels?.includes('high') ? 'high' : 'medium',
          }
        : {}),
      mcp_servers: {
        ...disabledMcpServers,
        // ACP adds the task's transport at session/new. Reserve its timeout in
        // the process config before that URL/token exists; never persist it.
        ...(options.mcpServerName && {
          [options.mcpServerName]: { tool_timeout_sec: APPROVAL_TOOL_TIMEOUT_MS / 1000 },
        }),
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
        shell_tool: true,
        apply_patch_freeform: true,
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
          options.workspaceRoot,
          configuration.access === 'api' ? configuration.model : configuration.native?.model,
          options.scratchDirectory,
        )
      : { mcpServers: options.mcpServers },
  )
  // The adapter owns permissionMode and ignores it in forwarded SDK options.
  // Select the advertised native mode through ACP before executing any tools.
  const sessionOptions =
    configuration.provider === 'claude' && options.scratchDirectory
      ? await connection.setConfigOption('mode', 'bypassPermissions')
      : (session.configOptions ?? [])
  const configOptions =
    configuration.access === 'native'
      ? await applyNativePreferences(connection, sessionOptions, configuration.native)
      : sessionOptions
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
