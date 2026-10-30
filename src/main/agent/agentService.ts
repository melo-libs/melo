import { AGENT_OPERATIONS, type AgentOperation } from '../../shared/agentCapabilities'
import { randomUUID } from 'node:crypto'
import type {
  AgentApproval,
  AgentContext,
  AgentMessage,
  AgentProvider,
  AgentView,
} from '../../shared/types/agent'
import type { AgentRuntime, RuntimeFactory, RuntimeEvent } from './agentTypes'
import { ConversationStore } from './storage/conversationStore'
import { MemoryService } from './storage/memory'
import { assembleContext } from './context'

interface LiveConversation {
  view: AgentView
  runtime: AgentRuntime | null
  turn: AbortController | null
  completion: Promise<void> | null
  permission: ((allow: boolean) => void) | null
  permissionQueue: Promise<void>
  lastPersisted: number
  dirtyMessages: Set<string>
  publication: ReturnType<typeof setTimeout> | null
  turnId: string
}

export class AgentService {
  private readonly live = new Map<string, LiveConversation>()
  constructor(
    private readonly store: ConversationStore,
    private readonly memory: MemoryService,
    private readonly createRuntime: RuntimeFactory,
    private readonly publish: (view: AgentView) => void,
    private readonly suspensions = new Set<string>(),
    private readonly undoChange?: (
      id: string,
      conversationId: string,
      root: string,
    ) => Promise<void>,
  ) {}

  create(workspaceRoot: string, provider: AgentProvider): AgentView {
    return this.open(this.store.create(workspaceRoot, provider).id)
  }

  current(workspaceRoot: string, provider: AgentProvider): AgentView {
    const existing = this.store.list(workspaceRoot)[0]
    return existing ? this.open(existing.id) : this.create(workspaceRoot, provider)
  }

  async removeHistory(messageId?: string): Promise<void> {
    if ([...this.live.values()].some((live) => live.turn || live.completion))
      throw new Error('Stop the current turn before deleting history')
    await this.suspend('history')
    try {
      if (messageId) this.store.deleteMessage(messageId)
      else this.store.clearHistory()
    } finally {
      this.resume('history')
    }
  }

  open(id: string): AgentView {
    let live = this.live.get(id)
    if (!live) {
      live = {
        view: {
          conversation: this.store.get(id),
          messages: this.store.messages(id, 60),
          status: 'idle',
          allowChanges: false,
          permission: null,
          error: null,
        },
        runtime: null,
        turn: null,
        completion: null,
        permission: null,
        permissionQueue: Promise.resolve(),
        lastPersisted: 0,
        dirtyMessages: new Set(),
        publication: null,
        turnId: '',
      }
      this.live.set(id, live)
    }
    return live.view
  }

  resume(reason = 'workspace'): void {
    this.suspensions.delete(reason)
  }

  async prepare(id: string): Promise<void> {
    if (this.suspensions.size) throw new Error('Agent workspace is closing')
    const view = this.open(id)
    if (this.live.get(id)!.turn) return
    await this.createRuntime.prepare?.(view.conversation)
  }

  async setProvider(id: string, provider: AgentProvider): Promise<AgentView> {
    this.open(id)
    const live = this.live.get(id)!
    if (live.turn || live.completion)
      throw new Error('Stop the current turn before changing providers')
    await live.runtime?.close()
    live.runtime = null
    await this.createRuntime.close?.()
    live.view.conversation.provider = provider
    this.emit(live, true)
    return live.view
  }

  send(id: string, text: string, context: AgentContext): AgentView {
    if (this.suspensions.size) throw new Error('Agent workspace is closing')
    this.open(id)
    const live = this.live.get(id)!
    if (live.turn || !['idle', 'error'].includes(live.view.status))
      throw new Error('A turn is already running in this conversation')
    const history = [...live.view.messages]
    const previousContext = history.filter((message) => message.role === 'user').at(-1)?.context
    if (!context.filePath && previousContext?.filePath)
      context = { ...context, filePath: previousContext.filePath }
    const controller = new AbortController()
    live.turn = controller
    live.turnId = randomUUID()
    live.view.error = null
    live.view.status = live.runtime ? 'running' : 'connecting'
    live.view.messages.push({
      id: randomUUID(),
      role: 'user',
      content: text,
      context: structuredClone(context),
      createdAt: Date.now(),
    })
    live.dirtyMessages.add(live.view.messages.at(-1)!.id)
    if (!live.view.conversation.title) live.view.conversation.title = text.slice(0, 60)
    live.view.conversation.updatedAt = Date.now()
    try {
      this.emit(live, true)
    } catch (error) {
      live.turn = null
      live.dirtyMessages.delete(live.view.messages.pop()!.id)
      live.view.status = 'error'
      live.view.error = 'AGENT_STORAGE_FAILED'
      throw error
    }
    live.completion = this.run(live, text, context, history, controller)
      .catch(() => {
        live.view.status = 'error'
        live.view.error = 'AGENT_STORAGE_OR_CLEANUP_FAILED'
        this.publish(structuredClone(live.view))
      })
      .finally(() => {
        live.completion = null
      })
    return live.view
  }

  private async run(
    live: LiveConversation,
    text: string,
    context: AgentContext,
    history: AgentMessage[],
    turn: AbortController,
  ): Promise<void> {
    try {
      const memory = await this.memory.read(live.view.conversation.workspaceRoot)
      if (turn.signal.aborted) return
      live.runtime ??= await this.createRuntime({
        signal: turn.signal,
        isActive: () => this.suspensions.size === 0 && !!live.turn && !live.turn.signal.aborted,
        conversation: live.view.conversation,
        onEvent: (event) => {
          if (live.turn && (!live.turn.signal.aborted || event.type === 'change'))
            this.onEvent(live, event)
        },
        authorize: (operation, signal) => this.authorize(live, operation, signal),
      })
      if (turn.signal.aborted) {
        await live.runtime.close()
        live.runtime = null
        return
      }
      live.view.status = 'running'
      this.emit(live)
      await live.runtime.prompt(assembleContext({ text, context, history, memory }))
    } catch (error) {
      if (!turn.signal.aborted) {
        live.view.error = error instanceof Error ? error.message : 'Agent request failed'
        live.view.status = 'error'
      }
      // Closing drains MCP requests, including an approval wait. Release that
      // wait first or a disconnected harness can deadlock its own cleanup.
      turn.abort()
      live.permission?.(false)
      const runtime = live.runtime
      live.runtime = null
      if (runtime) await runtime.close()
    } finally {
      live.permission?.(false)
      live.permission = null
      live.view.permission = null
      for (const message of live.view.messages) {
        if (message.toolStatus === 'pending') {
          message.toolStatus = 'failed'
          live.dirtyMessages.add(message.id)
        }
      }
      turn.abort()
      try {
        await live.runtime?.close()
      } finally {
        live.runtime = null
        live.turn = null
        live.view.allowChanges = false
        if (live.view.status !== 'error') live.view.status = 'idle'
        this.emit(live, true)
        live.view.messages = live.view.messages.slice(-100)
      }
    }
  }

  private onEvent(live: LiveConversation, event: RuntimeEvent): void {
    if (event.type === 'change' || event.type === 'plan') {
      const id = event.type === 'change' ? `change:${event.change.id}` : `plan:${live.turnId}`
      const index = live.view.messages.findIndex((item) => item.id === id)
      const message: AgentMessage = {
        id,
        role: 'tool',
        content: '',
        createdAt: index < 0 ? Date.now() : live.view.messages[index].createdAt,
        ...(event.type === 'change' ? { change: event.change } : { plan: event.entries }),
      }
      if (index === -1) live.view.messages.push(message)
      else live.view.messages[index] = message
      live.dirtyMessages.add(id)
      this.emit(live, true)
      return
    }
    if (event.type === 'text') {
      let last = live.view.messages.at(-1)
      if (last?.role !== 'assistant') {
        last = {
          id: randomUUID(),
          role: 'assistant',
          content: '',
          context: structuredClone(
            live.view.messages.filter((message) => message.role === 'user').at(-1)?.context,
          ),
          createdAt: Date.now(),
        }
        live.view.messages.push(last)
      }
      last.content += event.text
      live.dirtyMessages.add(last.id)
    } else {
      const id = `tool:${live.turnId}:${event.id}`
      const existing = live.view.messages.find((message) => message.id === id)
      live.dirtyMessages.add(id)
      if (existing) {
        existing.content = event.title
        existing.toolStatus = event.status
      } else
        live.view.messages.push({
          id,
          role: 'tool',
          content: event.title,
          toolStatus: event.status,
          createdAt: Date.now(),
        })
    }
    this.emit(live)
  }

  private authorize(
    live: LiveConversation,
    operation: AgentOperation,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const result = live.permissionQueue.then(async () => {
      if (!live.turn || live.turn.signal.aborted || signal?.aborted) return false
      if (AGENT_OPERATIONS[operation.kind].allowRun && live.view.allowChanges) return true
      live.view.status = 'awaiting-permission'
      const approval: AgentApproval = {
        id: randomUUID(),
        operation,
        status: 'pending',
      }
      live.view.permission = approval
      live.view.messages.push({
        id: `approval:${approval.id}`,
        role: 'tool',
        content: '',
        approval,
        createdAt: Date.now(),
      })
      live.dirtyMessages.add(`approval:${approval.id}`)
      let cancelPermission!: () => void
      const allowed = new Promise<boolean>((resolve) => {
        live.permission = resolve
        cancelPermission = () => resolve(false)
      })
      signal?.addEventListener('abort', cancelPermission, { once: true })
      try {
        this.emit(live, true)
        const answer = await allowed
        approval.status =
          live.turn?.signal.aborted || signal?.aborted ? 'expired' : answer ? 'allowed' : 'declined'
        return approval.status === 'allowed'
      } finally {
        signal?.removeEventListener('abort', cancelPermission)
        if (approval.status === 'pending') approval.status = 'expired'
        live.dirtyMessages.add(`approval:${approval.id}`)
        live.permission?.(false)
        live.permission = null
        live.view.permission = null
        if (live.turn && !live.turn.signal.aborted) live.view.status = 'running'
        this.emit(live, true)
      }
    })
    // Reject this request to its caller, but keep the serialization queue usable.
    live.permissionQueue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  respond(id: string, permissionId: string, allow: boolean, conversation = false): void {
    const live = this.live.get(id)
    if (!live || live.view.permission?.id !== permissionId)
      throw new Error('Permission request is no longer active')
    if (allow && conversation && AGENT_OPERATIONS[live.view.permission.operation.kind].allowRun)
      live.view.allowChanges = true
    live.permission?.(allow)
  }

  async undo(id: string, changeIds: string[]): Promise<AgentView> {
    if (this.suspensions.size) throw new Error('Agent workspace is closing')
    this.open(id)
    const live = this.live.get(id)!
    if (live.turn || live.completion)
      throw new Error('Stop the current turn before undoing changes')
    const undo = this.undoChange
    if (!undo) throw new Error('AGENT_UNDO_UNAVAILABLE')
    const messages = this.store.changeMessages(id, changeIds)
    if (messages.length !== new Set(changeIds).size) throw new Error('AGENT_UNDO_UNAVAILABLE')
    live.view.status = 'running'
    this.emit(live)
    const operation = async () => {
      // The harness cached file context is stale after undo.
      await live.runtime?.close()
      live.runtime = null
      for (const message of messages.reverse()) {
        if (message.change!.undone) continue
        await undo(message.change!.id, id, live.view.conversation.workspaceRoot)
        message.change!.undone = true
        const index = live.view.messages.findIndex((item) => item.id === message.id)
        if (index >= 0) live.view.messages[index] = message
        else live.view.messages.push(message)
        live.dirtyMessages.add(message.id)
        this.emit(live, true)
      }
    }
    live.completion = operation().finally(() => {
      live.view.status = 'idle'
      live.completion = null
      this.emit(live, true)
    })
    await live.completion
    return live.view
  }

  async cancel(id: string): Promise<void> {
    const live = this.live.get(id)
    if (!live) return
    if (!live.turn) {
      await live.completion
      return
    }
    live.turn.abort()
    live.permission?.(false)
    // Interrupt the owned process rather than waiting indefinitely for an agent
    // that ignores cooperative session/cancel. Conversation data stays in Melo.
    await live.runtime?.close()
    live.runtime = null
    await live.completion
  }

  async suspend(reason = 'workspace'): Promise<void> {
    this.suspensions.add(reason)
    await Promise.all([...this.live.keys()].map((id) => this.cancel(id)))
    await Promise.all(
      [...this.live.values()].map(async (live) => {
        await live.runtime?.close()
        live.runtime = null
        this.emit(live, true)
      }),
    )
    this.live.clear()
    await this.createRuntime.close?.()
  }

  private emit(live: LiveConversation, persist = false): void {
    if (persist && live.publication) {
      clearTimeout(live.publication)
      live.publication = null
    }
    if (persist || Date.now() - live.lastPersisted > 250) {
      this.store.save(
        live.view.conversation,
        live.view.messages.filter((message) => live.dirtyMessages.has(message.id)),
      )
      live.dirtyMessages.clear()
      live.lastPersisted = Date.now()
    }
    // Approval, completion and cancellation are immediate. Coalesce streaming
    // snapshots before cloning/IPC, without delaying persistence error handling.
    if (persist) {
      this.publish(structuredClone(live.view))
    } else if (!live.publication) {
      live.publication = setTimeout(() => {
        live.publication = null
        this.publish(structuredClone(live.view))
      }, 32)
    }
  }
}
