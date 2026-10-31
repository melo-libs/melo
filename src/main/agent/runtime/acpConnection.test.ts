import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionNotification } from '@agentclientprotocol/sdk'
import { AcpConnection } from './acpConnection'

let root: string
const connections: AcpConnection[] = []

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'melo-acp-test-'))
})

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(connections.splice(0).map((connection) => connection.close()))
  await rm(root, { recursive: true, force: true })
})

async function start(
  onUpdate: (notification: SessionNotification) => void = () => {},
  fixture?: string,
) {
  const connection = await AcpConnection.start({
    launch: {
      command: process.execPath,
      args: [path.resolve('scripts/fixtures/agent-acp.mjs')],
      ...(fixture ? { env: { ...process.env, MELO_AGENT_FIXTURE: fixture } } : {}),
    },
    workspaceRoot: root,
    onUpdate,
    startupTimeoutMs: 5000,
  })
  connections.push(connection)
  await connection.createSession({ mcpServers: [] }, 5000)
  return connection
}

describe.skipIf(process.platform === 'win32')('ACP process connection', () => {
  it.skipIf(process.platform !== 'darwin')(
    'accepts Darwin EPERM only after the adapter exits and its group has no live members',
    async () => {
      const connection = await start()
      const pid = connection.initialization.agentInfo?._meta?.pid as number
      const kill = process.kill.bind(process)
      const denied = Object.assign(new Error('kill EPERM'), { code: 'EPERM' })
      const signal = vi.spyOn(process, 'kill').mockImplementation((target, value) => {
        if (target === -pid && value !== 0) throw denied
        return kill(target, value)
      })
      try {
        kill(pid, 'SIGTERM')
        await vi.waitFor(() => expect(connection.isClosed).toBe(true))
        await expect(connection.close()).resolves.toBeUndefined()
        expect(signal).toHaveBeenCalledWith(-pid, 'SIGKILL')
      } finally {
        signal.mockRestore()
      }
    },
  )

  it.skipIf(process.platform !== 'darwin').each(['adapter', 'descendant'] as const)(
    'preserves a genuine permission failure while the owned %s is alive',
    async (scope) => {
      const connection = await start(
        undefined,
        scope === 'descendant' ? 'runtime-child' : undefined,
      )
      const pid = connection.initialization.agentInfo?._meta?.pid as number
      const kill = process.kill.bind(process)
      const denied = Object.assign(new Error('kill EPERM'), { code: 'EPERM' })
      const signal = vi.spyOn(process, 'kill').mockImplementation((target, value) => {
        if (target === -pid && value !== 0) throw denied
        return kill(target, value)
      })
      vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        if (scope === 'descendant') {
          const runtimePid = connection.initialization.agentInfo?._meta?.runtimePid as number
          expect(kill(runtimePid, 0)).toBe(true)
          kill(pid, 'SIGTERM')
          await vi.waitFor(() => expect(connection.isClosed).toBe(true))
        }
        await expect(connection.close()).rejects.toBe(denied)
      } finally {
        signal.mockRestore()
        connections.splice(connections.indexOf(connection), 1)
        try {
          kill(-pid, 'SIGKILL')
        } catch (error) {
          expect((error as NodeJS.ErrnoException).code).toBe('ESRCH')
        }
        await vi.waitFor(() => expect(() => kill(pid, 0)).toThrow())
      }
    },
  )

  it('interrupts initialization when the caller cancels startup', async () => {
    const controller = new AbortController()
    const pending = AcpConnection.start({
      signal: controller.signal,
      launch: {
        command: process.execPath,
        args: [path.resolve('scripts/fixtures/agent-acp.mjs')],
        env: { ...process.env, MELO_AGENT_FIXTURE: 'hang-init' },
      },
      workspaceRoot: root,
      onUpdate: () => {},
    })
    setTimeout(() => controller.abort(), 100)
    await expect(pending).rejects.toThrow('cancelled')
  })
  it('recovers from missing authentication without replacing the connection', async () => {
    const connection = await AcpConnection.start({
      launch: {
        command: process.execPath,
        args: [path.resolve('scripts/fixtures/agent-acp.mjs')],
        env: { ...process.env, MELO_AGENT_FIXTURE: 'require-auth' },
      },
      workspaceRoot: root,
      onUpdate: () => {},
    })
    connections.push(connection)
    await expect(connection.createSession({ mcpServers: [] })).rejects.toThrow()
    await expect(connection.authenticate({ methodId: 'unknown' })).rejects.toThrow('Unsupported')
    await connection.authenticate({ methodId: 'gateway' })
    await connection.createSession({ mcpServers: [] })
    await expect(
      connection.prompt([{ type: 'text', text: 'authenticated' }]),
    ).resolves.toMatchObject({ stopReason: 'end_turn' })
  })

  it('stops an idle adapter when its transport closes', async () => {
    const connection = await AcpConnection.start({
      launch: {
        command: process.execPath,
        args: [path.resolve('scripts/fixtures/agent-acp.mjs')],
        env: { ...process.env, MELO_AGENT_FIXTURE: 'idle-eof' },
      },
      workspaceRoot: root,
      onUpdate: () => {},
    })
    connections.push(connection)
    const pid = connection.initialization.agentInfo?._meta?.pid as number
    expect(pid).toBeTypeOf('number')
    await connection.createSession({ mcpServers: [] })
    await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow())
    await connection.close()
  })
  it('sets a session option through ACP and rejects configuration during an active turn', async () => {
    const connection = await start()
    expect(await connection.setConfigOption('model', 'fixture-model')).toMatchObject([
      { category: 'model', currentValue: 'fixture-model' },
    ])
    await expect(connection.setConfigOption('model', 'unknown')).rejects.toThrow()
    const turn = connection.prompt([{ type: 'text', text: 'wait' }])
    await expect(connection.setConfigOption('model', 'fixture-model')).rejects.toThrow('running')
    await new Promise((resolve) => setTimeout(resolve, 50))
    await connection.cancel()
    await turn
  })

  it('streams consecutive turns through the official SDK', async () => {
    const updates: SessionNotification[] = []
    const connection = await start((update) => updates.push(update))
    expect(connection.initialization.agentCapabilities?.mcpCapabilities?.http).toBe(true)
    await expect(connection.prompt([{ type: 'text', text: 'first' }])).resolves.toMatchObject({
      stopReason: 'end_turn',
    })
    await connection.prompt([{ type: 'text', text: 'second' }])
    expect(updates.map((update) => update.update)).toEqual([
      { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'first' } },
      { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'second' } },
    ])
  })

  it('denies unexpected permission requests by default', async () => {
    const updates: SessionNotification[] = []
    const connection = await start((update) => updates.push(update))
    await connection.prompt([{ type: 'text', text: 'permission' }])
    expect(updates.at(-1)?.update).toMatchObject({ content: { text: 'cancelled' } })
  })

  it('keeps a single session per connection', async () => {
    const connection = await start()
    await expect(connection.createSession({ mcpServers: [] })).rejects.toThrow(
      'already has a session',
    )
  })

  it('closes a session and starts a fresh one in the same process', async () => {
    const updates: SessionNotification[] = []
    const connection = await start((update) => updates.push(update))
    const pid = connection.initialization.agentInfo?._meta?.pid
    await connection.prompt([{ type: 'text', text: 'first context' }])
    const first = updates.at(-1)!.sessionId
    await connection.closeSession()
    await expect(connection.prompt([{ type: 'text', text: 'no session' }])).rejects.toThrow(
      'Create an agent session',
    )
    const next = await connection.createSession({ mcpServers: [] })
    await connection.prompt([{ type: 'text', text: 'second context' }])
    expect(next.sessionId).not.toBe(first)
    expect(updates.at(-1)!.sessionId).toBe(next.sessionId)
    expect(connection.initialization.agentInfo?._meta?.pid).toBe(pid)
  })

  it('cancels a turn without losing the session and refuses overlapping turns', async () => {
    const update = vi.fn()
    const connection = await start(update)
    const running = connection.prompt([{ type: 'text', text: 'wait' }])
    await vi.waitFor(() => expect(update).toHaveBeenCalled())
    await expect(connection.prompt([{ type: 'text', text: 'overlap' }])).rejects.toThrow(
      'already running',
    )
    await connection.cancel()
    await expect(running).resolves.toMatchObject({ stopReason: 'cancelled' })
    await expect(connection.prompt([{ type: 'text', text: 'continue' }])).resolves.toMatchObject({
      stopReason: 'end_turn',
    })
  })

  it('rejects pending turns when the adapter exits', async () => {
    const connection = await start()
    await expect(connection.prompt([{ type: 'text', text: 'crash' }])).rejects.toThrow()
    await expect(connection.prompt([{ type: 'text', text: 'after exit' }])).rejects.toThrow(
      'closed',
    )
  })

  it('bounds initialization and turn timeouts and releases the process', async () => {
    await expect(
      AcpConnection.start({
        launch: {
          command: process.execPath,
          args: [path.resolve('scripts/fixtures/agent-acp.mjs')],
          env: { ...process.env, MELO_AGENT_FIXTURE: 'hang-init' },
        },
        workspaceRoot: root,
        onUpdate: () => {},
        startupTimeoutMs: 100,
      }),
    ).rejects.toThrow()
    const connection = await start()
    await expect(connection.prompt([{ type: 'text', text: 'wait' }], 100)).rejects.toThrow()
    await expect(connection.prompt([{ type: 'text', text: 'after timeout' }])).rejects.toThrow(
      'closed',
    )
  })

  it('reports missing executables instead of leaving initialization pending', async () => {
    await expect(
      AcpConnection.start({
        launch: { command: path.join(root, 'missing-agent'), args: [] },
        workspaceRoot: root,
        onUpdate: () => {},
      }),
    ).rejects.toThrow()
  })
})
