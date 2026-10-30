import { afterEach, expect, it, vi } from 'vitest'
import type { AcpConnection } from './acpConnection'
import { RuntimeEnvironment } from './runtimeEnvironment'
import {
  createHarnessSession,
  startHarnessConnection,
  type HarnessSessionOptions,
} from './harnessSession'
import { HarnessProcess } from './harnessProcess'

vi.mock('./harnessSession', () => ({
  startHarnessConnection: vi.fn(),
  createHarnessSession: vi.fn(),
}))
afterEach(() => {
  vi.restoreAllMocks()
  vi.resetAllMocks()
})

function fixture() {
  const connection = {
    isClosed: false,
    close: vi.fn(async () => {
      connection.isClosed = true
    }),
    closeSession: vi.fn(async () => {}),
  }
  vi.mocked(startHarnessConnection).mockImplementation(async () => {
    connection.isClosed = false
    return connection as unknown as AcpConnection
  })
  vi.mocked(createHarnessSession).mockImplementation(async (connection) => ({
    connection,
    configOptions: [],
  }))
  const options: HarnessSessionOptions = {
    configuration: {
      provider: 'codex',
      access: 'native',
      baseUrl: '',
      model: '',
      hasApiKey: false,
    },
    workspaceRoot: '/fixture',
    environment: new RuntimeEnvironment('/fixture'),
    codexLauncher: '',
    signal: new AbortController().signal,
    mcpServers: [{ type: 'http', name: 'turn-one', url: 'http://127.0.0.1:1234', headers: [] }],
    onUpdate: vi.fn(),
  }
  return { connection, options }
}

it('coalesces prewarming and opens fresh turn sessions without restarting the process', async () => {
  const { connection, options } = fixture()
  const host = new HarnessProcess()
  try {
    await Promise.all([host.prepare(options), host.prepare(options)])
    expect(createHarnessSession).not.toHaveBeenCalled()
    const first = await host.open(options)
    const startup = vi.mocked(startHarnessConnection).mock.calls[0][0]
    startup.onUpdate({
      sessionId: 'one',
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'one' } },
    })
    expect(options.onUpdate).toHaveBeenCalledTimes(1)
    await first.release(true)
    startup.onUpdate({
      sessionId: 'one',
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'late' } },
    })
    expect(options.onUpdate).toHaveBeenCalledTimes(1)
    const second = await host.open({
      ...options,
      mcpServers: [{ ...options.mcpServers[0], name: 'turn-two', url: 'http://127.0.0.1:5678' }],
    })
    expect(second.toolName).toBe(first.toolName)
    expect(vi.mocked(createHarnessSession).mock.calls[1][1].mcpServers).toEqual([
      expect.objectContaining({ name: first.toolName, url: 'http://127.0.0.1:5678' }),
    ])
    await second.release(true)
    expect(startHarnessConnection).toHaveBeenCalledTimes(1)
    expect(createHarnessSession).toHaveBeenCalledTimes(2)
    expect(connection.closeSession).toHaveBeenCalledTimes(2)
    expect(connection.close).not.toHaveBeenCalled()
  } finally {
    await host.close()
  }
})

it('disposes idle processes, failed turns and changed connection profiles', async () => {
  const { connection, options } = fixture()
  const host = new HarnessProcess(15)
  try {
    await host.prepare(options)
    await vi.waitFor(() => expect(connection.close).toHaveBeenCalledTimes(1))
    const first = await host.open(options)
    await first.release(false)
    expect(connection.close).toHaveBeenCalledTimes(2)
    await host.prepare(options)
    await host.prepare({ ...options, apiKey: 'different-fixture-key' })
    expect(connection.close).toHaveBeenCalledTimes(3)
    expect(startHarnessConnection).toHaveBeenCalledTimes(4)
  } finally {
    await host.close()
  }
})

it('refuses a second lease without disrupting the active session', async () => {
  const { connection, options } = fixture()
  const host = new HarnessProcess()
  try {
    const first = await host.open(options)
    await expect(host.open(options)).rejects.toThrow('already active')
    expect(connection.close).not.toHaveBeenCalled()
    await first.release(true)
  } finally {
    await host.close()
  }
})

it('cancels prewarming without allowing its startup to outlive the owner', async () => {
  const { connection, options } = fixture()
  vi.mocked(startHarnessConnection).mockImplementationOnce(
    (input) =>
      new Promise((_resolve, reject) => {
        input.signal.addEventListener('abort', () => reject(new Error('startup cancelled')), {
          once: true,
        })
      }),
  )
  const controller = new AbortController()
  const host = new HarnessProcess()
  const pending = host.open({ ...options, signal: controller.signal })
  controller.abort()
  await expect(pending).rejects.toThrow('startup cancelled')
  await host.prepare(options)
  expect(startHarnessConnection).toHaveBeenCalledTimes(2)
  await host.close()
  expect(connection.close).toHaveBeenCalledTimes(1)
})

it('cancels session startup and does not retain a disconnected or cancelled process', async () => {
  const { connection, options } = fixture()
  const host = new HarnessProcess()
  const controller = new AbortController()
  vi.mocked(createHarnessSession).mockImplementationOnce(async () => {
    controller.abort()
    throw new Error('cancelled session')
  })
  try {
    await expect(host.open({ ...options, signal: controller.signal })).rejects.toThrow(
      'cancelled session',
    )
    expect(connection.close).toHaveBeenCalled()
    await host.prepare(options)
    connection.isClosed = true
    await host.prepare(options)
    expect(startHarnessConnection).toHaveBeenCalledTimes(3)
  } finally {
    await host.close()
  }
})
