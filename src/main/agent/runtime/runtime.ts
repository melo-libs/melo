import { RequestError, type McpServer, type SessionNotification } from '@agentclientprotocol/sdk'
import type { AgentConfiguration } from '../../../shared/types/agent'
import type { AgentRuntime, RuntimeFactory, RuntimeRequest } from '../agentTypes'
import { RuntimeEnvironment } from './runtimeEnvironment'
import { HarnessProcess } from './harnessProcess'
import { ownedMcpTool } from './toolIdentity'
import { runtimeOutput } from './runtimeOutput'
import type { AgentToolActivity } from '../../../shared/agentActivity'

function toolFileTarget(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return
  if ('file_path' in input && typeof input.file_path === 'string') return input.file_path
  if ('path' in input && typeof input.path === 'string') return input.path
  return undefined
}

interface Tools {
  config: Extract<McpServer, { type: 'http' }>
  close(): Promise<void>
}

export function createRuntimeFactory(options: {
  environment: RuntimeEnvironment
  codexLauncher: string
  configuration(provider: AgentConfiguration['provider']): AgentConfiguration
  nativePreferences?(
    provider: AgentConfiguration['provider'],
    signal: AbortSignal,
  ): Promise<NonNullable<AgentConfiguration['native']>>
  apiKey(provider: AgentConfiguration['provider']): string | undefined
  tools(request: RuntimeRequest): Promise<Tools>
  onApiAuthenticationFailed?(configuration: AgentConfiguration, apiKey: string): void
}): RuntimeFactory {
  const host = new HarnessProcess()
  const failure = (error: unknown, configuration: AgentConfiguration, apiKey?: string) => {
    const result = runtimeFailure(error, configuration, apiKey)
    if (configuration.access === 'api' && apiKey && result.message === 'AGENT_API_AUTH_FAILED')
      options.onApiAuthenticationFailed?.(configuration, apiKey)
    return result
  }
  const prepareConfiguration = async (
    provider: AgentConfiguration['provider'],
    signal: AbortSignal,
  ) => {
    let configuration = options.configuration(provider)
    if (configuration.access === 'native' && options.nativePreferences) {
      const native = await options.nativePreferences(provider, signal)
      signal.throwIfAborted()
      configuration = { ...configuration, native }
    }
    return configuration
  }
  let preparation = new AbortController()
  const create: RuntimeFactory = async (request) => {
    request.signal.throwIfAborted()
    let configuration = options.configuration(request.conversation.provider)
    if (configuration.provider !== request.conversation.provider)
      throw new Error('AGENT_PROVIDER_CHANGED')
    const apiKey =
      configuration.access === 'api' ? options.apiKey(configuration.provider) : undefined
    const output = runtimeOutput(apiKey)
    try {
      if (configuration.access === 'native' && options.nativePreferences) {
        configuration = await prepareConfiguration(configuration.provider, request.signal)
      }
    } catch (error) {
      throw failure(error, configuration, apiKey)
    }
    const tools = await options.tools(request)
    let lease: Awaited<ReturnType<HarnessProcess['open']>> | undefined
    let completed = false
    let toolName = tools.config.name
    let closing: Promise<void> | null = null
    const close = () =>
      (closing ??= (async () => {
        // Refuse further tool calls immediately, then release the owned runtime;
        // drain an already-approved edit before releasing its document service.
        const drained = tools.close()
        try {
          if (lease) await lease.release(completed)
        } finally {
          await drained
        }
      })())
    const abortStartup = () => {
      void close().catch((error) => console.error('Agent startup cleanup failed', error))
    }
    request.signal.addEventListener('abort', abortStartup, { once: true })
    const toolPresentations = new Map<string, { title: string; activity?: AgentToolActivity }>()
    const ownedTools = new Map<string, string>()
    const update = ({ update }: SessionNotification) => {
      if (update.sessionUpdate === 'plan') {
        request.onEvent({
          type: 'plan',
          entries: update.entries.map((entry) => ({
            content: output.sanitize(entry.content),
            status: entry.status,
          })),
        })
      }
      if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text') {
        if (
          configuration.provider === 'codex' &&
          update.content.text.startsWith(
            'Warning: Falling back from WebSockets to HTTPS transport.',
          ) &&
          update.content.text.length < 512
        ) {
          request.onEvent({
            type: 'tool',
            id: 'connection-fallback',
            title: 'network_fallback',
            status: 'completed',
          })
          return
        }
        const text = output.push(update.content.text)
        if (text) request.onEvent({ type: 'text', text })
      }
      if (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') {
        const owned = ownedMcpTool(update, configuration.provider, toolName)
        if (owned) ownedTools.set(update.toolCallId, owned)
        const previous = toolPresentations.get(update.toolCallId)
        const title = update.title ? output.sanitize(update.title) : (previous?.title ?? 'Tool')
        const kind = update.kind ?? previous?.activity?.kind
        const target =
          update.locations?.[0]?.path ??
          toolFileTarget(update.rawInput) ??
          previous?.activity?.target
        const activity = kind
          ? { kind, ...(target && { target: output.sanitize(target) }) }
          : undefined
        toolPresentations.set(update.toolCallId, { title, activity })
        request.onEvent({
          type: 'tool',
          id: update.toolCallId,
          title: ownedTools.get(update.toolCallId) ?? title,
          ...(activity && { activity }),
          status:
            update.status === 'completed'
              ? 'completed'
              : update.status === 'failed'
                ? 'failed'
                : 'pending',
        })
      }
    }
    try {
      request.signal.throwIfAborted()
      const opened = await host.open({
        environment: options.environment,
        codexLauncher: options.codexLauncher,
        configuration,
        apiKey,
        workspaceRoot: request.conversation.workspaceRoot,
        signal: request.signal,
        mcpServers: [tools.config],
        onUpdate: update,
        onPermission: async (permission) => {
          const owned =
            ownedMcpTool(permission.toolCall, configuration.provider, toolName) ??
            ownedTools.get(permission.toolCall.toolCallId)
          if (owned) {
            ownedTools.set(permission.toolCall.toolCallId, owned)
            request.onEvent({
              type: 'tool',
              id: permission.toolCall.toolCallId,
              title: owned,
              status: 'pending',
            })
          }
          // Owned MCP tools approve their own changes. A native request that
          // survives the Harness mode still requires the user's decision.
          const allowed =
            !!owned ||
            (await request.authorize({
              kind: 'native',
              title: output.sanitize(permission.toolCall.title ?? 'Agent permission'),
              detail: output.sanitize(JSON.stringify(permission.toolCall.rawInput ?? {})),
            }))
          const option =
            allowed && !request.signal.aborted && request.isActive()
              ? permission.options.find((option) => option.kind === 'allow_once')
              : undefined
          return option
            ? { outcome: { outcome: 'selected', optionId: option.optionId } }
            : { outcome: { outcome: 'cancelled' } }
        },
      })
      lease = opened
      toolName = opened.toolName
      const active = opened.connection
      const runtime: AgentRuntime = {
        async prompt(text) {
          completed = false
          ownedTools.clear()
          toolPresentations.clear()
          try {
            request.signal.throwIfAborted()
            const response = await active.prompt([{ type: 'text', text }])
            completed = response.stopReason !== 'cancelled'
          } catch (error) {
            // Typed prompt failures also cover auth changes after initialization.
            throw failure(error, configuration, apiKey)
          } finally {
            const tail = output.flush()
            if (tail) request.onEvent({ type: 'text', text: tail })
          }
        },
        close,
      }
      return runtime
    } catch (error) {
      await close()
      throw failure(error, configuration, apiKey)
    } finally {
      request.signal.removeEventListener('abort', abortStartup)
    }
  }
  create.prepare = async (conversation) => {
    const signal = preparation.signal
    let configuration = options.configuration(conversation.provider)
    const apiKey =
      configuration.access === 'api' ? options.apiKey(configuration.provider) : undefined
    try {
      configuration = await prepareConfiguration(conversation.provider, signal)
      signal.throwIfAborted()
      await host.prepare({
        environment: options.environment,
        codexLauncher: options.codexLauncher,
        workspaceRoot: conversation.workspaceRoot,
        configuration,
        apiKey,
      })
    } catch (error) {
      throw failure(error, configuration, apiKey)
    }
  }
  create.close = async () => {
    preparation.abort()
    preparation = new AbortController()
    await host.close()
  }
  return create
}

function runtimeFailure(error: unknown, configuration: AgentConfiguration, apiKey?: string): Error {
  const message =
    error instanceof RequestError && error.code === RequestError.authRequired().code
      ? configuration.access === 'native'
        ? 'AGENT_SIGN_IN_REQUIRED'
        : 'AGENT_API_AUTH_FAILED'
      : error instanceof Error
        ? error.message
        : 'Agent request failed'
  return new Error(runtimeOutput(apiKey).sanitize(message))
}
