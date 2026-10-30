import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentService } from './agentService'
import { ConversationStore } from './storage/conversationStore'
import { MemoryService } from './storage/memory'
import type { RuntimeFactory, RuntimeRequest } from './agentTypes'

let root: string
let store: ConversationStore
let memory: MemoryService
let service: AgentService
let request: RuntimeRequest
let prompt: ReturnType<typeof vi.fn>
let factory: ReturnType<typeof vi.fn<RuntimeFactory>>
beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'melo-agent-service-')))
  await mkdir(path.join(root, 'user'))
  store = new ConversationStore(path.join(root, 'conversations.db'))
  memory = new MemoryService(path.join(root, 'user'))
  prompt = vi.fn(async () => {
    request.onEvent({ type: 'text', text: 'Answer' })
  })
  factory = vi.fn(async (value) => {
    request = value
    return { prompt, close: vi.fn() }
  })
  service = new AgentService(store, memory, factory, () => {})
})
afterEach(async () => {
  await service.suspend()
  store.close()
  await rm(root, { recursive: true, force: true })
})

describe('AgentService lifecycle', () => {
  it('keeps window suspension when a workspace refresh resumes its own scope', async () => {
    const view = service.create(root, 'codex')
    await service.suspend('window')
    service.resume('workspace')
    expect(() => service.send(view.conversation.id, 'Should not start', {})).toThrow('closing')
    service.resume('window')
    service.send(view.conversation.id, 'Allowed now', {})
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledOnce())
  })

  it('switches harnesses within a conversation without replacing its history or memory', async () => {
    await memory.write(root, 'user', 'Prefer short answers.')
    const view = service.create(root, 'claude')
    service.send(view.conversation.id, 'First question', {})
    await vi.waitFor(() => expect(view.status).toBe('idle'))
    await service.setProvider(view.conversation.id, 'codex')
    service.send(view.conversation.id, 'Continue', {})
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledTimes(2))
    expect(prompt.mock.calls[1][0]).toContain('First question')
    expect(prompt.mock.calls[1][0]).toContain('Prefer short answers.')
    expect(view.conversation.provider).toBe('codex')
  })
  it('persists one timeline while replacing the harness context between turns', async () => {
    const view = service.create(root, 'codex')
    service.send(view.conversation.id, 'First', {})
    await vi.waitFor(() => expect(service.open(view.conversation.id).status).toBe('idle'))
    service.send(view.conversation.id, 'Second', {})
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledTimes(2))
    expect(factory).toHaveBeenCalledTimes(2)
    await service.suspend()
    expect(store.messages(view.conversation.id).map((message) => message.content)).toEqual([
      'First',
      'Answer',
      'Second',
      'Answer',
    ])
  })
  it('uses the same memory for different harnesses and restores history after disposal', async () => {
    await memory.write(root, 'user', 'Prefer concise responses.')
    const view = service.create(root, 'claude')
    service.send(view.conversation.id, 'Hello', {})
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledOnce())
    expect(prompt.mock.calls[0][0]).toContain('Prefer concise responses.')
    await service.suspend()
    service.resume()
    service.send(view.conversation.id, 'Continue', {})
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledTimes(2))
    expect(prompt.mock.calls[1][0]).toContain('Previous conversation')
    const other = service.create(root, 'codex')
    service.send(other.conversation.id, 'Hello', {})
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledTimes(3))
    expect(prompt.mock.calls[2][0]).toContain('Prefer concise responses.')
  })
  it('cancels permission waits and does not delete the conversation', async () => {
    prompt.mockImplementationOnce(async () => {
      const allowed = await request.authorize({
        kind: 'native',
        title: 'Edit note',
        detail: 'note.md',
      })
      expect(allowed).toBe(false)
    })
    const view = service.create(root, 'codex')
    service.send(view.conversation.id, 'Edit', {})
    await vi.waitFor(() => expect(service.open(view.conversation.id).permission).not.toBeNull())
    await service.cancel(view.conversation.id)
    expect(service.open(view.conversation.id).status).toBe('idle')
    expect(store.list(root)).toHaveLength(1)
  })
  it('refuses overlapping turns and reports harness failures without losing messages', async () => {
    prompt.mockImplementationOnce(async () => {
      await request.authorize({ kind: 'edit', path: 'note.md', diff: '' })
      throw new Error('Harness failed')
    })
    const view = service.create(root, 'codex')
    service.send(view.conversation.id, 'Edit', {})
    expect(() => service.send(view.conversation.id, 'Again', {})).toThrow('already running')
    await vi.waitFor(() => expect(view.permission).not.toBeNull())
    service.respond(view.conversation.id, view.permission!.id, true)
    await vi.waitFor(() => expect(view.status).toBe('error'))
    expect(view.error).toBe('Harness failed')
    expect(store.messages(view.conversation.id)[0].content).toBe('Edit')
  })
})

it('limits run approval to workspace changes and expires it at completion', async () => {
  prompt.mockImplementationOnce(async () => {
    expect(await request.authorize({ kind: 'create-folder', path: 'Reference' })).toBe(true)
    expect(
      await request.authorize({
        kind: 'move',
        source: 'note.md',
        destination: 'Reference/note.md',
      }),
    ).toBe(true)
    expect(await request.authorize({ kind: 'memory', scope: 'user', content: 'Preference' })).toBe(
      false,
    )
    expect(
      await request.authorize({ kind: 'native', title: 'Create folder', detail: 'Reference' }),
    ).toBe(false)
  })
  const view = service.create(root, 'claude')
  service.send(view.conversation.id, 'Organize', {})
  await vi.waitFor(() => expect(view.permission?.operation.kind).toBe('create-folder'))
  service.respond(view.conversation.id, view.permission!.id, true, true)
  await vi.waitFor(() => expect(view.permission?.operation.kind).toBe('memory'))
  expect(view.allowChanges).toBe(true)
  service.respond(view.conversation.id, view.permission!.id, false)
  await vi.waitFor(() => expect(view.permission?.operation.kind).toBe('native'))
  service.respond(view.conversation.id, view.permission!.id, false)
  await vi.waitFor(() => expect(view.status).toBe('idle'))
  expect(view.allowChanges).toBe(false)
  await service.suspend()
  service.resume()
  expect(service.open(view.conversation.id).allowChanges).toBe(false)
})

it('records approved changes that finish during cancellation', async () => {
  prompt.mockImplementationOnce(async () => {
    await new Promise<void>((resolve) =>
      request.signal.addEventListener(
        'abort',
        () => {
          request.onEvent({
            type: 'change',
            change: { id: 'finished', kind: 'create-folder', path: 'Reference', undone: false },
          })
          resolve()
        },
        { once: true },
      ),
    )
  })
  const view = service.create(root, 'claude')
  service.send(view.conversation.id, 'Organize', {})
  await vi.waitFor(() => expect(prompt).toHaveBeenCalledOnce())
  await service.cancel(view.conversation.id)
  expect(view.messages.some((message) => message.change?.id === 'finished')).toBe(true)
})

it('serializes undo with turns and waits for it before suspending the workspace', async () => {
  let finish: () => void = () => {}
  const undo = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
  )
  service = new AgentService(store, memory, factory, () => {}, new Set(), undo)
  prompt.mockImplementationOnce(async () => {
    request.onEvent({
      type: 'change',
      change: {
        id: 'change',
        kind: 'move',
        source: 'note.md',
        path: 'Reference/note.md',
        undone: false,
      },
    })
  })
  const view = service.create(root, 'claude')
  service.send(view.conversation.id, 'Move', {})
  await vi.waitFor(() => expect(view.status).toBe('idle'))
  const undoing = service.undo(view.conversation.id, ['change'])
  await vi.waitFor(() => expect(undo).toHaveBeenCalledOnce())
  expect(() => service.send(view.conversation.id, 'Other', {})).toThrow('already running')
  await expect(service.undo(view.conversation.id, ['change'])).rejects.toThrow('current turn')
  let suspended = false
  const suspending = service.suspend().then(() => {
    suspended = true
  })
  await Promise.resolve()
  expect(suspended).toBe(false)
  finish()
  await Promise.all([undoing, suspending])
  expect(view.messages.find((message) => message.change)?.change?.undone).toBe(true)
})

it('releases pending approvals before draining a failed harness', async () => {
  let permission: Promise<boolean>
  factory.mockImplementationOnce(async (value) => {
    request = value
    return {
      prompt: async () => {
        permission = request.authorize({ kind: 'create-folder', path: 'Reference' })
        await Promise.resolve()
        throw new Error('Agent disconnected')
      },
      close: async () => {
        await permission
      },
    }
  })
  const view = service.create(root, 'claude')
  service.send(view.conversation.id, 'Create folder', {})
  await vi.waitFor(() => {
    expect(view.status).toBe('error')
    expect(view.permission).toBeNull()
  })
  await expect(service.cancel(view.conversation.id)).resolves.toBeUndefined()
})

it('keeps the referenced note for follow-ups after the composer quote is consumed', async () => {
  const view = service.create(root, 'claude')
  service.send(view.conversation.id, 'Explain this', {
    filePath: 'Travel.md',
    selection: 'A passage',
  })
  await vi.waitFor(() => expect(view.status).toBe('idle'))
  service.send(view.conversation.id, 'Make it shorter', {})
  await vi.waitFor(() => expect(view.status).toBe('idle'))
  expect(prompt.mock.calls[1][0]).toContain('Explain this')
  expect(prompt.mock.calls[1][0]).toContain('Answer')
  expect(view.messages.filter((message) => message.role === 'user').at(-1)?.context).toEqual({
    filePath: 'Travel.md',
  })
})

it('persists a burst before trimming the live message buffer', async () => {
  prompt.mockImplementationOnce(async () => {
    for (let i = 0; i < 130; i++) {
      request.onEvent({ type: 'text', text: `Answer ${i}` })
      request.onEvent({ type: 'tool', id: `tool-${i}`, title: 'Read', status: 'completed' })
    }
  })
  const view = service.create(root, 'claude')
  service.send(view.conversation.id, 'Long task', {})
  await vi.waitFor(() => expect(view.status).toBe('idle'))
  expect(store.messages(view.conversation.id)).toHaveLength(261)
  expect(view.messages).toHaveLength(100)
})

it('undoes a persisted change outside the live message window', async () => {
  const undo = vi.fn(async () => {})
  service = new AgentService(store, memory, factory, () => {}, new Set(), undo)
  const conversation = store.create(root, 'claude')
  store.save(conversation, [
    {
      id: 'change:older',
      role: 'tool',
      content: '',
      createdAt: 1,
      change: { id: 'older', kind: 'create-folder', path: 'Reference', undone: false },
    },
    ...Array.from({ length: 70 }, (_, index) => ({
      id: `later-${index}`,
      role: 'user' as const,
      content: 'Later question',
      createdAt: index + 2,
    })),
  ])
  expect(service.open(conversation.id).messages.some((message) => message.change)).toBe(false)
  const view = await service.undo(conversation.id, ['older'])
  expect(undo).toHaveBeenCalledWith('older', conversation.id, root)
  expect(view.messages.find((message) => message.change)?.change?.undone).toBe(true)
  expect(store.changeMessages(conversation.id, ['older'])[0].change?.undone).toBe(true)
})

it('keeps interrupted confirmation in history instead of silently removing it', async () => {
  prompt.mockImplementationOnce(async () => {
    expect(await request.authorize({ kind: 'edit', path: 'Note.md', diff: '-old\n+new' })).toBe(
      false,
    )
  })
  const view = service.create(root, 'claude')
  service.send(view.conversation.id, 'Edit this', {})
  await vi.waitFor(() => expect(view.permission).not.toBeNull())
  const approvalId = view.permission!.id
  expect(view.messages.find((message) => message.approval)?.approval).toMatchObject({
    id: approvalId,
    status: 'pending',
    operation: { kind: 'edit', path: 'Note.md', diff: '-old\n+new' },
  })
  await service.cancel(view.conversation.id)
  expect(view.permission).toBeNull()
  expect(
    store.messages(view.conversation.id).find((message) => message.approval)?.approval,
  ).toMatchObject({ id: approvalId, status: 'expired' })
  await service.suspend()
  service.resume()
  expect(
    service.current(root, 'claude').messages.find((message) => message.approval)?.approval?.status,
  ).toBe('expired')
})

it('coalesces streaming snapshots and persists only changed messages', async () => {
  const published = vi.fn()
  service = new AgentService(store, memory, factory, published)
  const save = vi.spyOn(store, 'save')
  let release!: () => void
  const waiting = new Promise<void>((resolve) => {
    release = resolve
  })
  prompt.mockImplementationOnce(async () => {
    for (let i = 0; i < 100; i++) request.onEvent({ type: 'text', text: 'x' })
    await waiting
  })
  const view = service.create(root, 'claude')
  service.send(view.conversation.id, 'Stream', {})
  await vi.waitFor(() => expect(prompt).toHaveBeenCalledOnce())
  await new Promise((resolve) => setTimeout(resolve, 45))
  expect(published.mock.calls.length).toBeLessThan(5)
  release()
  await vi.waitFor(() => expect(view.status).toBe('idle'))
  expect(published.mock.calls.at(-1)![0].messages.at(-1).content).toBe('x'.repeat(100))
  const question = view.messages[0].id
  expect(
    save.mock.calls
      .slice(1)
      .flatMap((call) => call[1])
      .some((message) => message.id === question),
  ).toBe(false)
  expect(store.messages(view.conversation.id).at(-1)!.content).toBe('x'.repeat(100))
  const count = published.mock.calls.length
  await new Promise((resolve) => setTimeout(resolve, 45))
  expect(published).toHaveBeenCalledTimes(count)
})

it('recovers the confirmation queue after a failed approval checkpoint', async () => {
  const persist = store.save.bind(store)
  let fail = true
  const save = vi.spyOn(store, 'save').mockImplementation((conversation, messages) => {
    if (fail && messages.some((message) => message.approval)) {
      fail = false
      throw new Error('Checkpoint unavailable')
    }
    persist(conversation, messages)
  })
  prompt.mockImplementationOnce(async () => {
    await expect(request.authorize({ kind: 'edit', path: 'note.md', diff: '' })).rejects.toThrow(
      'Checkpoint unavailable',
    )
  })
  const view = service.create(root, 'claude')
  service.send(view.conversation.id, 'First', {})
  await vi.waitFor(() => expect(view.status).toBe('idle'))
  expect(view.permission).toBeNull()
  expect(view.messages.find((message) => message.approval)?.approval?.status).toBe('expired')
  prompt.mockImplementationOnce(async () => {
    expect(await request.authorize({ kind: 'edit', path: 'note.md', diff: '' })).toBe(true)
  })
  service.send(view.conversation.id, 'Try again', {})
  await vi.waitFor(() => expect(view.permission).not.toBeNull())
  service.respond(view.conversation.id, view.permission!.id, true)
  await vi.waitFor(() => expect(view.status).toBe('idle'))
  expect(
    store
      .messages(view.conversation.id)
      .filter((message) => message.approval)
      .map((message) => message.approval!.status),
  ).toEqual(['expired', 'allowed'])
  save.mockRestore()
})

it('keeps plan ordering stable while updates are streamed and after history reload', async () => {
  let tick = 100
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => tick++)
  try {
    prompt.mockImplementationOnce(async () => {
      request.onEvent({ type: 'plan', entries: [{ content: 'Summarize', status: 'in_progress' }] })
      request.onEvent({ type: 'text', text: 'Summary' })
      request.onEvent({ type: 'plan', entries: [{ content: 'Summarize', status: 'completed' }] })
    })
    const view = service.create(root, 'claude')
    service.send(view.conversation.id, 'Summarize', {})
    await vi.waitFor(() => expect(view.status).toBe('idle'))
    const ordered = (messages: typeof view.messages) =>
      [...messages].sort((a, b) => a.createdAt - b.createdAt).map((message) => message.id)
    expect(ordered(view.messages)).toEqual(ordered(store.messages(view.conversation.id)))
    expect(view.messages.find((message) => message.plan)!.createdAt).toBeLessThan(
      view.messages.find((message) => message.role === 'assistant')!.createdAt,
    )
  } finally {
    clock.mockRestore()
  }
})

it('expires a cancelled MCP approval and permits the next tool call in the same turn', async () => {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const { StreamableHTTPClientTransport } = await import(
    '@modelcontextprotocol/sdk/client/streamableHttp.js'
  )
  const { startWorkspaceTools } = await import('./mcp/workspaceTools')
  const applied: string[] = []
  let timedOut = false
  let proceed!: () => void
  const resume = new Promise<void>((resolve) => {
    proceed = resolve
  })
  factory.mockImplementationOnce(async (request) => {
    const tools = await startWorkspaceTools((signal) => ({
      documents: {
        read: async () => ({ content: 'old', revision: 'r1' }),
        edit: async (_path, _revision, content) => {
          if (
            !(await request.authorize(
              { kind: 'edit', path: 'note.md', diff: `-old\n+${content}` },
              signal,
            ))
          )
            throw new Error('Change was not approved')
          signal.throwIfAborted()
          applied.push(content)
          return { content, revision: 'r2' }
        },
      },
    }))
    const client = new Client({ name: 'approval-cancel-test', version: '1' })
    await client.connect(
      new StreamableHTTPClientTransport(new URL(tools.config.url), {
        requestInit: {
          headers: Object.fromEntries(tools.config.headers.map(({ name, value }) => [name, value])),
        },
      }),
    )
    return {
      prompt: async () => {
        await client
          .callTool(
            {
              name: 'melo_edit_document',
              arguments: { path: 'note.md', expectedRevision: 'r1', content: 'timed-out' },
            },
            undefined,
            { timeout: 250 },
          )
          .catch(() => {
            timedOut = true
          })
        await resume
        if (!request.signal.aborted)
          await client.callTool({
            name: 'melo_edit_document',
            arguments: { path: 'note.md', expectedRevision: 'r1', content: 'approved' },
          })
      },
      close: async () => {
        await client.close()
        await tools.close()
      },
    }
  })
  const view = service.create(root, 'claude')
  try {
    service.send(view.conversation.id, 'Edit twice', {})
    await vi.waitFor(() => expect(view.permission).not.toBeNull())
    const expiredId = view.permission!.id
    await vi.waitFor(() => expect(timedOut).toBe(true))
    await vi.waitFor(() => expect(view.permission).toBeNull())
    expect(view.messages.find((message) => message.approval)?.approval?.status).toBe('expired')
    expect(() => service.respond(view.conversation.id, expiredId, true)).toThrow('no longer active')
    expect(applied).toEqual([])
    proceed()
    await vi.waitFor(() => expect(view.permission).not.toBeNull())
    service.respond(view.conversation.id, view.permission!.id, true)
    await vi.waitFor(() => expect(view.status).toBe('idle'))
    expect(applied).toEqual(['approved'])
    expect(
      store
        .messages(view.conversation.id)
        .filter((message) => message.approval)
        .map((message) => message.approval!.status),
    ).toEqual(['expired', 'allowed'])
  } finally {
    proceed()
  }
})
