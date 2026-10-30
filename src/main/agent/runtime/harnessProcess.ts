import { createHash, randomUUID } from 'node:crypto'
import type { AcpConnection } from './acpConnection'
import {
  createHarnessSession,
  startHarnessConnection,
  type HarnessSessionOptions,
} from './harnessSession'

const IDLE_TIMEOUT_MS = 5 * 60_000
type ProcessOptions = Pick<
  HarnessSessionOptions,
  'configuration' | 'apiKey' | 'workspaceRoot' | 'environment' | 'codexLauncher'
>
interface OwnedProcess {
  key: string
  controller: AbortController
  connection: Promise<AcpConnection>
  handlers: Pick<HarnessSessionOptions, 'onUpdate' | 'onPermission'> | null
  leased: boolean
}

/** Keep one owned adapter warm, while each turn gets a fresh, disposable session. */
export class HarnessProcess {
  private owned: OwnedProcess | null = null
  private idle: ReturnType<typeof setTimeout> | undefined
  private generation = 0

  constructor(private readonly idleTimeoutMs = IDLE_TIMEOUT_MS) {}

  async prepare(options: ProcessOptions): Promise<OwnedProcess> {
    const { native, ...configuration } = options.configuration
    const key = createHash('sha256')
      .update(
        JSON.stringify([
          options.workspaceRoot,
          configuration,
          native?.model,
          native?.effort,
          options.apiKey,
        ]),
      )
      .digest('hex')
    if (this.owned?.key === key) {
      const owned = this.owned
      const connection = await owned.connection
      if (this.owned !== owned) throw new Error('Harness preparation cancelled')
      if (!connection.isClosed) return owned
    }
    if (this.owned) {
      const closing = this.close()
      const generation = this.generation
      await closing
      if (generation !== this.generation) throw new Error('Harness preparation cancelled')
    }
    this.generation += 1
    const controller = new AbortController()
    const owned: OwnedProcess = {
      key,
      controller,
      handlers: null,
      leased: false,
      connection: startHarnessConnection({
        ...options,
        signal: controller.signal,
        mcpServers: [],
        onUpdate: (update) => owned.handlers?.onUpdate(update),
        onPermission: (request) =>
          owned.handlers?.onPermission?.(request) ??
          Promise.resolve({ outcome: { outcome: 'cancelled' as const } }),
      }),
    }
    this.owned = owned
    try {
      await owned.connection
      controller.signal.throwIfAborted()
      if (this.owned === owned) this.scheduleIdle()
      return owned
    } catch (error) {
      if (this.owned === owned) this.owned = null
      throw error
    }
  }

  async open(options: HarnessSessionOptions) {
    options.signal.throwIfAborted()
    if (this.owned?.leased) throw new Error('A Harness session is already active')
    const preparing = this.prepare(options)
    let owned = this.owned
    let claimed = false
    const abort = () => {
      if (owned && (claimed || !owned.leased))
        void this.discard(owned).catch((error) => console.error('Harness cleanup failed', error))
    }
    options.signal.addEventListener('abort', abort, { once: true })
    try {
      owned = await preparing
      options.signal.throwIfAborted()
      if (this.owned !== owned) throw new Error('Harness preparation cancelled')
      if (owned.leased) throw new Error('A Harness session is already active')
      const active = owned
      clearTimeout(this.idle)
      claimed = true
      active.leased = true
      active.handlers = options
      const connection = await active.connection
      // Codex caches MCP clients by name across sessions. A fresh identity
      // prevents the next turn from retaining a closed tool server's connection.
      const toolName = `melo_${randomUUID().replaceAll('-', '')}`
      const mcpServers = options.mcpServers.map((server) => ({ ...server, name: toolName }))
      await createHarnessSession(connection, { ...options, mcpServers })
      options.signal.throwIfAborted()
      return {
        connection,
        toolName,
        release: async (reusable: boolean) => {
          active.handlers = null
          if (!reusable || this.owned !== active || connection.isClosed) {
            await this.discard(active)
            return
          }
          try {
            await connection.closeSession()
            active.leased = false
            if (this.owned === active) this.scheduleIdle()
          } catch (error) {
            await this.discard(active)
            throw error
          }
        },
      }
    } catch (error) {
      if (owned && (claimed || !owned.leased)) await this.discard(owned)
      throw error
    } finally {
      options.signal.removeEventListener('abort', abort)
    }
  }

  async close(): Promise<void> {
    this.generation += 1
    clearTimeout(this.idle)
    const owned = this.owned
    this.owned = null
    if (owned) await this.discard(owned)
  }

  private async discard(owned: OwnedProcess): Promise<void> {
    if (this.owned === owned) {
      this.owned = null
      clearTimeout(this.idle)
    }
    owned.controller.abort()
    owned.handlers = null
    // Initialization owns its original failure; shutdown still drains its process.
    const connection = await owned.connection.then(
      (connection) => connection,
      () => null,
    )
    await connection?.close()
  }

  private scheduleIdle(): void {
    clearTimeout(this.idle)
    this.idle = setTimeout(() => {
      void this.close().catch((error) => console.error('Idle Harness cleanup failed', error))
    }, this.idleTimeoutMs)
    this.idle.unref()
  }
}
