import { createHash } from 'node:crypto'
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { AgentSettings } from '../storage/agentSettings'
import { RuntimeEnvironment } from './runtimeEnvironment'
import { NativeModels } from './nativeModels'

// Explicit opt-in: queries the installed account's capabilities, without a model turn.
it.skipIf(process.env.MELO_NATIVE_MODELS_CHECK !== '1')(
  'discovers real Codex controls and isolates persisted Melo preferences',
  async () => {
    const home = process.env.CODEX_HOME
    const temporaryRoot = await realpath(os.tmpdir())
    if (!home || !(await realpath(home)).startsWith(temporaryRoot + path.sep))
      throw new Error(
        'Set CODEX_HOME to a dedicated temporary test account directory. Never copy developer credentials.',
      )
    const root = await mkdtemp(path.join(os.tmpdir(), 'melo-native-integration-'))
    const configFile = path.join(home, 'config.toml')
    const fingerprint = (value: string) => createHash('sha256').update(value).digest('hex')
    const before = fingerprint(await readFile(configFile, 'utf8'))
    const environmentBefore = fingerprint(JSON.stringify(process.env))
    try {
      const settings = new AgentSettings(root)
      const environment = new RuntimeEnvironment(path.join(root, 'runtime'))
      const models = new NativeModels(
        settings,
        environment,
        path.resolve('resources/agent/codex-launch.cjs'),
      )
      await models.resolve('codex')
      const controls = models.cached('codex')!
      const model = controls.find((control) => control.category === 'model')!
      expect(model.options.length).toBeGreaterThan(0)
      const nextModel =
        model.options.find((option) => option.value !== model.value) ?? model.options[0]
      await models.load('codex', { category: 'model', value: nextModel.value })
      expect(settings.get('codex').native?.model).toBe(nextModel.value)
      const restored = new AgentSettings(root)
      expect(restored.get('codex').native).toEqual(settings.get('codex').native)
      expect(fingerprint(JSON.stringify(process.env))).toBe(environmentBefore)
      expect(fingerprint(await readFile(configFile, 'utf8'))).toBe(before)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  },
  60_000,
)
