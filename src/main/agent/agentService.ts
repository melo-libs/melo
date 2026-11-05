import { AGENT_OPERATIONS, type AgentOperation } from '../../shared/agentCapabilities'
import { randomUUID } from 'node:crypto'
import type {
  AgentApproval,
  AgentChange,
  AgentAttachment,
  AgentConversation,
  AgentContext,
  AgentMessage,
  AgentProvider,
  AgentView,
} from '../../shared/types/agent'
import type { AgentRuntime, RuntimeFactory, RuntimeEvent } from './agentTypes'
import { ConversationStore } from './storage/conversationStore'
import { MemoryService } from './storage/memory'
import { assembleContext } from './context'
import type { AttachmentReceipt } from '../../shared/agentAttachments'

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
    private readonly receiveFile?: (
      conversation: AgentConversation,
      id: string,
      signal: AbortSignal,
    ) => Promise<AgentAttachment>,
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
    const controller = new AbortController()
    live.turn = controller
    live.turnId = randomUUID()
    live.view.completedTurn = undefined
    live.view.error = null
    live.view.status = live.runtime ? 'running' : 'connecting'
    const submittedContext = structuredClone(context)
    live.view.messages.push({
      id: randomUUID(),
      role: 'user',
      content: text,
      context: submittedContext,
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
    live.completion = this.run(live, text, submittedContext, history, controller)
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

  private async receiveAttachments(
    live: LiveConversation,
    submitted: AgentMessage,
    signal: AbortSignal,
  ): Promise<void> {
    const files = submitted.context?.attachments
    if (!files?.length) return
    const receipt: AttachmentReceipt = {
      files: files.map((file) => ({ id: file.id, name: file.name, status: 'pending' })),
    }
    const message: AgentMessage = {
      id: `receipt:${live.turnId}`,
      role: 'tool',
      content: '',
      createdAt: Date.now(),
      receipt,
    }
    live.view.messages.push(message)
    live.dirtyMessages.add(message.id)
    this.emit(live, true)
    try {
      for (const [index, file] of files.entries()) {
        const item = receipt.files[index]
        try {
          const received = await this.receiveFile!(live.view.conversation, file.id, signal)
          Object.assign(file, received)
          item.path = received.path
          item.status = 'stored'
          live.dirtyMessages.add(submitted.id)
          live.dirtyMessages.add(message.id)
          this.emit(live, true)
        } catch (error) {
          item.status = signal.aborted ? 'cancelled' : 'failed'
          live.dirtyMessages.add(message.id)
          throw error
        }
      }
    } finally {
      for (const file of receipt.files)
        if (file.status === 'pending') {
          file.status = 'cancelled'
          live.dirtyMessages.add(message.id)
        }
    }
  }

  private async run(
    live: LiveConversation,
    text: string,
    context: AgentContext,
    history: AgentMessage[],
    turn: AbortController,
  ): Promise<void> {
    try {
      const submitted = live.view.messages.at(-1)!
      await this.receiveAttachments(live, submitted, turn.signal)
      const memory = await this.memory.read(live.view.conversation.workspaceRoot)
      if (turn.signal.aborted) return
      live.runtime ??= await this.createRuntime({
        signal: turn.signal,
        isActive: () => this.suspensions.size === 0 && !!live.turn && !live.turn.signal.aborted,
        conversation: live.view.conversation,
        onEvent: (event) => {
          if (
            live.turn &&
            (!live.turn.signal.aborted || event.type === 'change' || event.type === 'filing')
          )
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
      if (!turn.signal.aborted) live.view.completedTurn = live.turnId
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

  private updateFiling(live: LiveConversation, batchId: string): void {
    const conversation = live.view.conversation
    const filing = this.store.filing(batchId, conversation.id, conversation.workspaceRoot)
    const changes = new Map(filing.changes.map((change) => [change.id, change]))
    for (const message of live.view.messages) {
      if (message.filing?.id === batchId) message.filing = filing
      if (message.change?.batchId === batchId) {
        const change = changes.get(message.change.id)
        if (change && message.change.undone !== change.undone) {
          message.change = change
          live.dirtyMessages.add(message.id)
        }
      }
    }
    const id = `filing:${batchId}`
    const message = live.view.messages.find((item) => item.id === id)
    if (message) message.filing = filing
    else
      live.view.messages.push({
        id,
        role: 'tool',
        content: '',
        filing,
        createdAt: filing.createdAt,
      })
    live.dirtyMessages.add(id)
  }

  private onEvent(live: LiveConversation, event: RuntimeEvent): void {
    if (event.type === 'filing') {
      this.updateFiling(live, event.batchId)
      this.emit(live, true)
      return
    }
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
      if (event.type === 'change' && event.change.batchId)
        this.updateFiling(live, event.change.batchId)
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
        if (event.activity) existing.toolActivity = { ...existing.toolActivity, ...event.activity }
      } else
        live.view.messages.push({
          id,
          role: 'tool',
          content: event.title,
          toolStatus: event.status,
          toolActivity: event.activity,
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
    const messages = this.store.changeMessages(id, changeIds)
    if (
      messages.length !== new Set(changeIds).size ||
      messages.some((message) => message.change?.batchId)
    )
      throw new Error('AGENT_UNDO_UNAVAILABLE')
    return this.undoChanges(
      id,
      messages.map((message) => message.change!),
    )
  }

  async undoFiling(id: string, batchId: string): Promise<AgentView> {
    const view = this.open(id)
    const filing = this.store.filing(batchId, id, view.conversation.workspaceRoot)
    if (filing.state === 'applying') throw new Error('Stop the current turn before undoing changes')
    return this.undoChanges(id, filing.changes, batchId)
  }

  private async undoChanges(
    id: string,
    changes: AgentChange[],
    batchId?: string,
  ): Promise<AgentView> {
    if (this.suspensions.size) throw new Error('Agent workspace is closing')
    this.open(id)
    const live = this.live.get(id)!
    if (live.turn || live.completion)
      throw new Error('Stop the current turn before undoing changes')
    const undo = this.undoChange
    if (!undo) throw new Error('AGENT_UNDO_UNAVAILABLE')
    live.view.status = 'running'
    this.emit(live)
    const operation = async () => {
      // The harness cached file context is stale after undo.
      await live.runtime?.close()
      live.runtime = null
      for (const change of [...changes].reverse()) {
        // Even an already committed inverse may still need registry reconciliation.
        await undo(change.id, id, live.view.conversation.workspaceRoot)
        if (change.undone) continue
        change.undone = true
        const messageId = `change:${change.id}`
        let message = live.view.messages.find((item) => item.id === messageId)
        if (!message) {
          message = this.store.changeMessages(id, [change.id])[0] ?? {
            id: messageId,
            role: 'tool',
            content: '',
            createdAt: Date.now(),
          }
          live.view.messages.push(message)
        }
        message.change = change
        live.dirtyMessages.add(messageId)
        if (change.batchId) this.updateFiling(live, change.batchId)
        this.emit(live, true)
      }
    }
    live.completion = operation().finally(() => {
      live.view.status = 'idle'
      live.completion = null
      // A failed callback can still have committed its inverse, and retries may skip every entry.
      if (batchId) this.updateFiling(live, batchId)
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
