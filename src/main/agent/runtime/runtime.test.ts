import { mkdtemp, realpath, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { RequestError } from '@agentclientprotocol/sdk'
import { expect, it, vi } from 'vitest'
import { createRuntimeFactory } from './runtime'
import { AcpConnection } from './acpConnection'
import type { AcpConnectionOptions } from './acpConnection'
import { RuntimeEnvironment } from './runtimeEnvironment'
import { startWorkspaceTools } from '../mcp/workspaceTools'

it.each([
  { kind: 'execute', allow: true, cancel: false },
  { kind: 'execute', allow: false, cancel: false },
  { kind: 'execute', allow: true, cancel: true },
  { kind: 'edit', allow: true, cancel: false },
  { kind: 'delete', allow: false, cancel: false },
  { kind: 'read', allow: true, cancel: false },
] as const)(
  'routes native $kind permission through Melo (allow=$allow, cancel=$cancel)',
  async ({ kind, allow, cancel }) => {
    const environment = new RuntimeEnvironment('unused')
    vi.spyOn(environment, 'requireNode').mockResolvedValue(process.execPath)
    vi.spyOn(environment, 'requireProvider').mockResolvedValue('/fixture/cli')
    let handlers!: AcpConnectionOptions
    vi.spyOn(AcpConnection, 'start').mockImplementation(async (options) => {
      handlers = options
      return {
        createSession: async () => ({ sessionId: 'fixture' }),
        setConfigOption: async () => [],
        closeSession: async () => {},
        close: async () => {},
      } as unknown as AcpConnection
    })
    const controller = new AbortController()
    const authorize = vi.fn(async () => {
      if (cancel) controller.abort()
      return allow
    })
    const onEvent = vi.fn()
    const factory = createRuntimeFactory({
      environment,
      codexLauncher: '',
      configuration: () => ({
        provider: 'claude',
        access: 'native',
        baseUrl: '',
        model: '',
        hasApiKey: false,
      }),
      apiKey: () => undefined,
      tools: async () => ({
        config: { type: 'http', name: 'fixture', url: 'http://127.0.0.1:1234', headers: [] },
        close: async () => {},
      }),
    })
    try {
      const runtime = await factory({
        conversation: {
          id: 'fixture',
          workspaceRoot: process.cwd(),
          provider: 'claude',
          title: '',
          updatedAt: 1,
        },
        signal: controller.signal,
        isActive: () => true,
        authorize,
        onEvent,
      })
      handlers.onUpdate({
        sessionId: 'fixture',
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'native',
          title: 'Native action',
          kind,
          locations: [{ path: '/fixture/report.pdf' }],
          status: 'pending',
        },
      })
      expect(onEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'tool',
          activity: { kind, target: '/fixture/report.pdf' },
        }),
      )
      handlers.onUpdate({
        sessionId: 'fixture',
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'native',
          rawInput: { file_path: '/fixture/final.pdf' },
          status: 'completed',
        },
      })
      expect(onEvent).toHaveBeenLastCalledWith(
        expect.objectContaining({
          activity: { kind, target: '/fixture/final.pdf' },
          status: 'completed',
        }),
      )
      const outcome = await handlers.onPermission!({
        sessionId: 'fixture',
        toolCall: {
          toolCallId: 'native',
          kind,
          title: 'Native action',
          rawInput: { command: 'fixture command' },
        },
        options: [
          { optionId: 'always', kind: 'allow_always', name: 'Always' },
          { optionId: 'once', kind: 'allow_once', name: 'Once' },
          { optionId: 'reject', kind: 'reject_once', name: 'Reject' },
        ],
      })
      expect(authorize).toHaveBeenCalledWith({
        kind: 'native',
        title: 'Native action',
        detail: JSON.stringify({ command: 'fixture command' }),
      })
      expect(outcome).toEqual({
        outcome:
          allow && !cancel ? { outcome: 'selected', optionId: 'once' } : { outcome: 'cancelled' },
      })
      await runtime.close()
    } finally {
      await factory.close!()
      vi.restoreAllMocks()
    }
  },
)

it('reuses the prepared adapter while giving each turn fresh tools, callbacks and session context', async () => {
  const environment = new RuntimeEnvironment('unused')
  vi.spyOn(environment, 'requireNode').mockResolvedValue(process.execPath)
  vi.spyOn(environment, 'requireProvider').mockResolvedValue('/fixture/cli')
  let handlers!: AcpConnectionOptions
  let sequence = 0
  const createSession = vi.fn(async () => ({ sessionId: String(++sequence) }))
  const closeSession = vi.fn(async () => {})
  const close = vi.fn(async () => {})
  const start = vi.spyOn(AcpConnection, 'start').mockImplementation(async (options) => {
    handlers = options
    return {
      createSession,
      setConfigOption: async () => [],
      closeSession,
      close,
      prompt: async (prompt: { text: string }[]) => {
        handlers.onUpdate({
          sessionId: String(sequence),
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: prompt[0].text },
          },
        })
        return { stopReason: 'end_turn' }
      },
    } as unknown as AcpConnection
  })
  const toolClosures: ReturnType<typeof vi.fn>[] = []
  const factory = createRuntimeFactory({
    environment,
    codexLauncher: '',
    configuration: () => ({
      provider: 'claude',
      access: 'native',
      baseUrl: '',
      model: '',
      hasApiKey: false,
    }),
    apiKey: () => undefined,
    tools: async () => {
      const close = vi.fn(async () => {})
      toolClosures.push(close)
      return {
        config: {
          type: 'http',
          name: `turn-${toolClosures.length}`,
          url: `http://127.0.0.1:${1234 + toolClosures.length}`,
          headers: [],
        },
        close,
      }
    },
  })
  const conversation = {
    id: 'test',
    workspaceRoot: process.cwd(),
    provider: 'claude' as const,
    title: '',
    updatedAt: 1,
  }
  const firstEvents = vi.fn(),
    secondEvents = vi.fn()
  try {
    await factory.prepare!(conversation)
    expect(createSession).not.toHaveBeenCalled()
    for (const [text, onEvent] of [
      ['first', firstEvents],
      ['second', secondEvents],
    ] as const) {
      const runtime = await factory({
        conversation,
        signal: new AbortController().signal,
        isActive: () => true,
        authorize: async () => false,
        onEvent,
      })
      await runtime.prompt(text)
      await runtime.close()
    }
    expect(start).toHaveBeenCalledTimes(1)
    expect(createSession).toHaveBeenCalledTimes(2)
    expect(closeSession).toHaveBeenCalledTimes(2)
    expect(firstEvents.mock.calls).toEqual([[{ type: 'text', text: 'first' }]])
    expect(secondEvents.mock.calls).toEqual([[{ type: 'text', text: 'second' }]])
    expect(toolClosures.every((close) => close.mock.calls.length === 1)).toBe(true)
    expect(close).not.toHaveBeenCalled()
  } finally {
    await factory.close!()
    vi.restoreAllMocks()
  }
})

it.each(['native', 'api'] as const)(
  'maps late ACP authentication failures for %s access',
  async (access) => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'melo-runtime-auth-')))
    const environment = new RuntimeEnvironment(path.join(root, 'runtime'))
    vi.spyOn(environment, 'requireNode').mockResolvedValue(process.execPath)
    vi.spyOn(environment, 'requireProvider').mockResolvedValue('/fixture/cli')
    const close = vi.fn(async () => {})
    const onApiAuthenticationFailed = vi.fn()
    const start = vi.spyOn(AcpConnection, 'start').mockResolvedValue({
      createSession: async () => ({ sessionId: 'fixture' }),
      setConfigOption: async () => [],
      prompt: async () => {
        await Promise.resolve()
        throw RequestError.authRequired()
      },
      close,
      cancel: async () => {},
    } as unknown as AcpConnection)
    let runtime: Awaited<ReturnType<ReturnType<typeof createRuntimeFactory>>> | undefined
    try {
      const factory = createRuntimeFactory({
        onApiAuthenticationFailed,
        environment,
        codexLauncher: '',
        configuration: () => ({
          provider: 'claude',
          access,
          baseUrl: 'https://api.deepseek.com/anthropic',
          model: 'deepseek-flash',
          hasApiKey: access === 'api',
        }),
        apiKey: () => 'fixture-key',
        tools: () =>
          startWorkspaceTools(() => ({
            documents: {
              read: async () => {
                throw new Error('No reads expected')
              },
              edit: async () => {
                throw new Error('No edits expected')
              },
            },
          })),
      })
      runtime = await factory({
        signal: new AbortController().signal,
        isActive: () => true,
        conversation: {
          id: 'fixture',
          workspaceRoot: root,
          provider: 'claude',
          title: '',
          updatedAt: Date.now(),
        },
        onEvent: () => {},
        authorize: async () => false,
      })
      await expect(runtime.prompt('Hello')).rejects.toThrow(
        access === 'native' ? 'AGENT_SIGN_IN_REQUIRED' : 'AGENT_API_AUTH_FAILED',
      )
      if (access === 'api')
        expect(onApiAuthenticationFailed).toHaveBeenCalledWith(
          expect.objectContaining({
            provider: 'claude',
            access: 'api',
            baseUrl: 'https://api.deepseek.com/anthropic',
            model: 'deepseek-flash',
          }),
          'fixture-key',
        )
      else expect(onApiAuthenticationFailed).not.toHaveBeenCalled()
    } finally {
      await runtime?.close()
      start.mockRestore()
      await rm(root, { recursive: true, force: true })
    }
  },
)

it('redacts credentials and maps authentication errors during background preparation', async () => {
  const environment = new RuntimeEnvironment('unused')
  vi.spyOn(environment, 'requireNode').mockResolvedValue(process.execPath)
  vi.spyOn(environment, 'requireProvider').mockResolvedValue('/fixture/cli')
  const onApiAuthenticationFailed = vi.fn()
  const start = vi
    .spyOn(AcpConnection, 'start')
    .mockRejectedValueOnce(new Error('Invalid fixture-key credential'))
    .mockRejectedValueOnce(new Error('AGENT_API_NETWORK_ERROR'))
    .mockRejectedValueOnce(new Error('AGENT_API_PAYMENT_REQUIRED'))
    .mockRejectedValueOnce(RequestError.authRequired())
  const factory = createRuntimeFactory({
    onApiAuthenticationFailed,
    environment,
    codexLauncher: '',
    configuration: () => ({
      provider: 'claude',
      access: 'api',
      baseUrl: 'http://127.0.0.1',
      model: 'fixture',
      hasApiKey: true,
    }),
    apiKey: () => 'fixture-key',
    tools: vi.fn(),
  })
  const conversation = {
    id: 'test',
    workspaceRoot: process.cwd(),
    provider: 'claude' as const,
    title: '',
    updatedAt: 1,
  }
  try {
    await expect(factory.prepare!(conversation)).rejects.toThrow('Invalid [redacted] credential')
    await expect(factory.prepare!(conversation)).rejects.toThrow('AGENT_API_NETWORK_ERROR')
    await expect(factory.prepare!(conversation)).rejects.toThrow('AGENT_API_PAYMENT_REQUIRED')
    expect(onApiAuthenticationFailed).not.toHaveBeenCalled()
    await expect(factory.prepare!(conversation)).rejects.toThrow('AGENT_API_AUTH_FAILED')
    expect(onApiAuthenticationFailed).toHaveBeenCalledTimes(1)
    expect(onApiAuthenticationFailed).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'fixture', baseUrl: 'http://127.0.0.1' }),
      'fixture-key',
    )
  } finally {
    await factory.close!()
    start.mockRestore()
    vi.restoreAllMocks()
  }
})
