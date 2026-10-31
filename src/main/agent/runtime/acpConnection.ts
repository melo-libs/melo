import {
  execFile,
  spawn,
  type ChildProcessWithoutNullStreams,
  type ExecFileException,
} from 'node:child_process'
import { realpath, stat } from 'node:fs/promises'
import { Readable, Writable } from 'node:stream'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'
import {
  client,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  RequestError,
  type AuthenticateRequest,
  type ClientCapabilities,
  type ClientConnection,
  type ContentBlock,
  type InitializeResponse,
  type InitializeRequest,
  type NewSessionRequest,
  type NewSessionResponse,
  type PromptResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
  type SessionConfigOption,
} from '@agentclientprotocol/sdk'

export interface HarnessLaunch {
  command: string
  args: string[]
  env?: NodeJS.ProcessEnv
}

export interface AcpConnectionOptions {
  launch: HarnessLaunch
  workspaceRoot: string
  onUpdate: (notification: SessionNotification) => void
  onPermission?: (request: RequestPermissionRequest) => Promise<RequestPermissionResponse>
  startupTimeoutMs?: number
  clientCapabilities?: ClientCapabilities
  onExtensionNotification?: (method: string, params: unknown) => void
  signal?: AbortSignal
}

export class AcpConnection {
  private activeSessionId: string | null = null
  private running = false
  private closed = false
  private creatingSession = false
  private authenticating = false
  private closing: Promise<void> | null = null

  private constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly connection: ClientConnection,
    readonly initialization: InitializeResponse,
    readonly workspaceRoot: string,
  ) {}

  static async start(options: AcpConnectionOptions): Promise<AcpConnection> {
    options.signal?.throwIfAborted()
    if (process.platform === 'win32')
      throw new Error('ACP process ownership on Windows is not supported yet')
    const workspaceRoot = await realpath(options.workspaceRoot)
    if (!(await stat(workspaceRoot)).isDirectory()) throw new Error('Workspace is not a directory')
    const child = spawn(options.launch.command, options.launch.args, {
      cwd: workspaceRoot,
      env: options.launch.env ?? process.env,
      stdio: 'pipe',
      shell: false,
      // The entire adapter/runtime process group belongs to this connection.
      detached: true,
    })
    child.stderr.resume()
    const connection = client({ name: 'melo' })
      .onNotification(methods.client.session.update, ({ params }) => {
        if (instance?.activeSessionId === params.sessionId) options.onUpdate(params)
      })
      .onNotification('*', ({ method, params }) =>
        options.onExtensionNotification?.(method, params),
      )
      .onRequest(methods.client.session.requestPermission, ({ params }) =>
        instance?.activeSessionId === params.sessionId && options.onPermission
          ? options.onPermission(params)
          : { outcome: { outcome: 'cancelled' } },
      )
      .connect(
        ndJsonStream(
          Writable.toWeb(child.stdin),
          Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
        ),
      )
    let instance: AcpConnection | undefined
    child.once('error', (error) => connection.close(error))
    child.once('exit', () => connection.close(new Error('Agent process exited')))
    const abortStartup = () => connection.close(new Error('Agent startup cancelled'))
    options.signal?.addEventListener('abort', abortStartup, { once: true })
    const timeout = setTimeout(
      () => connection.close(new Error('Agent initialization timed out')),
      options.startupTimeoutMs ?? 60_000,
    )
    try {
      options.signal?.throwIfAborted()
      const initialization = await connection.agent.request<InitializeResponse, InitializeRequest>(
        methods.agent.initialize,
        {
          protocolVersion: PROTOCOL_VERSION,
          clientInfo: { name: 'melo', title: 'Melo', version: '0.1.0' },
          clientCapabilities: options.clientCapabilities ?? {},
        },
      )
      if (initialization.protocolVersion !== PROTOCOL_VERSION) {
        throw new Error('Agent negotiated an unsupported ACP version')
      }
      if (connection.signal.aborted) throw new Error('Agent disconnected during initialization')
      instance = new AcpConnection(child, connection, initialization, workspaceRoot)
      const owned = instance
      connection.signal.addEventListener(
        'abort',
        () => {
          void owned.close().catch((error) => console.error('Failed to stop agent process', error))
        },
        { once: true },
      )
      return instance
    } catch (error) {
      connection.close(error)
      await stopProcess(child)
      throw error
    } finally {
      options.signal?.removeEventListener('abort', abortStartup)
      clearTimeout(timeout)
    }
  }

  async authenticate(params: AuthenticateRequest): Promise<void> {
    if (this.closed || this.connection.signal.aborted) throw new Error('Agent connection is closed')
    if (this.activeSessionId !== null || this.creatingSession)
      throw new Error('Authenticate before creating a session')
    if (this.authenticating) throw new Error('Agent authentication is already running')
    const method = this.initialization.authMethods?.find((method) => method.id === params.methodId)
    if (!method || ('type' in method && method.type === 'terminal'))
      throw new Error('Unsupported agent authentication method')
    this.authenticating = true
    try {
      await this.requestWithDeadline(
        this.connection.agent.request(methods.agent.authenticate, params),
        30_000,
      )
    } finally {
      this.authenticating = false
    }
  }

  async createSession(
    options: Pick<NewSessionRequest, 'mcpServers' | '_meta'>,
    timeoutMs = 60_000,
  ): Promise<NewSessionResponse> {
    if (this.closed || this.connection.signal.aborted) throw new Error('Agent connection is closed')
    if (this.authenticating)
      throw new Error('Wait for agent authentication before creating a session')
    if (this.activeSessionId !== null || this.creatingSession)
      throw new Error('This connection already has a session')
    this.creatingSession = true
    try {
      const session = await this.requestWithDeadline(
        this.connection.agent.request(methods.agent.session.new, {
          cwd: this.workspaceRoot,
          ...options,
        }),
        timeoutMs,
      )
      this.activeSessionId = session.sessionId
      return session
    } finally {
      this.creatingSession = false
    }
  }

  async prompt(prompt: ContentBlock[], timeoutMs?: number): Promise<PromptResponse> {
    if (this.closed || this.connection.signal.aborted) throw new Error('Agent connection is closed')
    if (this.activeSessionId === null) throw new Error('Create an agent session before prompting')
    if (this.running) throw new Error('An agent turn is already running')
    this.running = true
    try {
      const request = this.connection.agent.request(methods.agent.session.prompt, {
        sessionId: this.activeSessionId,
        prompt,
      })
      return await (timeoutMs ? this.requestWithDeadline(request, timeoutMs) : request)
    } finally {
      this.running = false
    }
  }

  async setConfigOption(configId: string, value: string): Promise<SessionConfigOption[]> {
    if (this.closed || this.connection.signal.aborted) throw new Error('Agent connection is closed')
    if (this.activeSessionId === null) throw new Error('Create an agent session before configuring')
    if (this.running) throw new Error('Cannot configure a running agent turn')
    const response = await this.requestWithDeadline(
      this.connection.agent.request(methods.agent.session.setConfigOption, {
        sessionId: this.activeSessionId,
        configId,
        value,
      }),
      30_000,
    )
    return response.configOptions
  }

  async cancel(): Promise<void> {
    if (!this.running || this.activeSessionId === null) return
    await this.connection.agent.notify(methods.agent.session.cancel, {
      sessionId: this.activeSessionId,
    })
  }

  get isClosed(): boolean {
    return this.closed || this.connection.signal.aborted
  }

  async closeSession(): Promise<void> {
    if (this.running || this.creatingSession) throw new Error('Agent session is still running')
    if (this.activeSessionId === null) return
    await this.requestWithDeadline(
      this.connection.agent.request(methods.agent.session.close, {
        sessionId: this.activeSessionId,
      }),
      30_000,
    )
    this.activeSessionId = null
  }

  close(): Promise<void> {
    if (this.closing) return this.closing
    this.closed = true
    this.closing = stopProcess(this.child)
    this.connection.close()
    return this.closing
  }

  private async requestWithDeadline<T>(request: Promise<T>, timeoutMs: number): Promise<T> {
    const timeout = setTimeout(
      () => this.connection.close(new Error('Agent request timed out')),
      timeoutMs,
    )
    try {
      return await request
    } catch (error) {
      // A JSON-RPC refusal (including auth_required) leaves the transport usable
      // for authentication and retry. Timeouts and transport failures do not.
      if (!(error instanceof RequestError) || this.connection.signal.aborted) await this.close()
      throw error
    } finally {
      clearTimeout(timeout)
    }
  }
}

async function stopProcess(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.pid === undefined) return
  const signal = (value: NodeJS.Signals) => {
    try {
      process.kill(-child.pid!, value)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
    }
  }
  const exited = child.exitCode !== null || child.signalCode !== null
  const closed = exited
    ? Promise.resolve()
    : new Promise<void>((resolve) => child.once('close', resolve))
  const sendSignal = async (value: NodeJS.Signals) => {
    try {
      signal(value)
    } catch (error) {
      if (process.platform !== 'darwin' || (error as NodeJS.ErrnoException).code !== 'EPERM')
        throw error
      // Darwin excludes zombies when signalling a group and reports EPERM when
      // no signalable members remain. Reaping an orphan can take longer than close.
      await Promise.race([closed, delay(100)])
      try {
        signal(value)
      } catch (retryError) {
        if (
          (retryError as NodeJS.ErrnoException).code === 'EPERM' &&
          (child.exitCode !== null || child.signalCode !== null) &&
          !(await hasLiveProcessGroup(child.pid!))
        )
          return
        throw retryError
      }
    }
  }
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    await sendSignal('SIGTERM')
    await Promise.race([
      closed,
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, 3000)
      }),
    ])
    // A runtime can outlive its adapter even after the adapter closes its pipes.
    await sendSignal('SIGKILL')
    await closed
  } finally {
    clearTimeout(timeout)
    child.stdin.destroy()
    child.stdout.destroy()
    child.stderr.destroy()
  }
}

async function hasLiveProcessGroup(pid: number): Promise<boolean> {
  try {
    const { stdout } = await promisify(execFile)('/bin/ps', ['-o', 'stat=', '-g', String(pid)], {
      timeout: 2000,
      maxBuffer: 64 * 1024,
    })
    return stdout
      .trim()
      .split('\n')
      .some((state) => state.trim() && !state.trim().startsWith('Z'))
  } catch (error) {
    const failure = error as ExecFileException & { stdout: string; stderr: string }
    // ps returns 1 with empty output when the group has already disappeared.
    if (failure.code === 1 && !failure.stdout.trim() && !failure.stderr.trim()) return false
    throw error
  }
}
