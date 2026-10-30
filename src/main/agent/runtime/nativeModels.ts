import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type {
  AgentModelControl,
  AgentNativePreferences,
  AgentProvider,
} from '../../../shared/types/agent'
import type { AgentSettings } from '../storage/agentSettings'
import type { RuntimeEnvironment } from './runtimeEnvironment'
import { openHarnessSession } from './harnessSession'
import { modelControls, nativePreferences } from './nativeConfiguration'

export class NativeModels {
  private readonly controls = new Map<AgentProvider, AgentModelControl[]>()
  private readonly tails: Partial<Record<AgentProvider, Promise<unknown>>> = {}
  private pending = new AbortController()
  constructor(
    private readonly settings: AgentSettings,
    private readonly environment: RuntimeEnvironment,
    private readonly codexLauncher: string,
  ) {}

  cached(provider: AgentProvider): AgentModelControl[] | undefined {
    return this.controls.get(provider)
  }

  async cancel(): Promise<void> {
    const tails = Object.values(this.tails)
    this.pending.abort(new Error('Model discovery cancelled'))
    this.pending = new AbortController()
    // The original caller owns any failure; suspension only drains owned work.
    await Promise.all(
      tails.map((tail) =>
        tail.then(
          () => {},
          () => {},
        ),
      ),
    )
  }

  async resolve(provider: AgentProvider, signal?: AbortSignal): Promise<AgentNativePreferences> {
    const saved = this.settings.get(provider).native
    if (saved) return saved
    await this.load(provider, undefined, signal)
    return this.settings.get(provider).native!
  }

  async load(
    provider: AgentProvider,
    change?: { category: 'model' | 'thought_level'; value: string },
    callerSignal?: AbortSignal,
  ): Promise<void> {
    const signal = AbortSignal.any([this.pending.signal, ...(callerSignal ? [callerSignal] : [])])
    signal.throwIfAborted()
    const inspect = () => this.inspect(provider, change, signal)
    const work = (this.tails[provider] ?? Promise.resolve()).then(inspect, inspect)
    this.tails[provider] = work
    let abort: () => void = () => {}
    try {
      await Promise.race([
        work,
        new Promise<never>((_resolve, reject) => {
          abort = () => reject(signal.reason)
          signal.addEventListener('abort', abort, { once: true })
          if (signal.aborted) abort()
        }),
      ])
    } finally {
      signal.removeEventListener('abort', abort)
    }
  }

  private async inspect(
    provider: AgentProvider,
    change?: { category: 'model' | 'thought_level'; value: string },
    callerSignal?: AbortSignal,
  ): Promise<void> {
    const signal = AbortSignal.any([
      AbortSignal.timeout(60_000),
      ...(callerSignal ? [callerSignal] : []),
    ])
    signal.throwIfAborted()
    const configuration = this.settings.get(provider)
    if (configuration.access !== 'native') throw new Error('Model controls require native access')
    const root = await mkdtemp(path.join(os.tmpdir(), 'melo-models-'))
    try {
      signal.throwIfAborted()
      // A neutral cwd excludes workspace/project overrides from initial inheritance.
      // No prompt or Melo tools are attached to this short-lived discovery session.
      const { connection, configOptions } = await openHarnessSession({
        environment: this.environment,
        codexLauncher: this.codexLauncher,
        configuration,
        workspaceRoot: root,
        signal,
        mcpServers: [],
        onUpdate: () => {},
      })
      try {
        let controls = modelControls(configOptions)
        if (change) {
          const control = controls.find((option) => option.category === change.category)
          if (!control?.options.some((option) => option.value === change.value))
            throw new Error('The selected model option is no longer available')
          controls = modelControls(await connection.setConfigOption(control.id, change.value))
        }
        signal.throwIfAborted()
        if (change || !configuration.native)
          this.settings.saveNative(provider, nativePreferences(controls))
        this.controls.set(provider, controls)
      } finally {
        await connection.close()
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }
}
