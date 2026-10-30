import { safeStorage } from 'electron'
import { readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { z } from 'zod'
import { canReuseAgentApiKey } from '../../../shared/agentApi'
import type {
  AgentConfiguration,
  AgentNativePreferences,
  AgentProvider,
} from '../../../shared/types/agent'

const PROFILE = z.object({
  access: z.enum(['native', 'api']),
  baseUrl: z.string(),
  model: z.string(),
  encryptedKey: z.string().optional(),
  native: z
    .object({
      model: z.string(),
      effort: z.string().optional(),
      modelLabel: z.string().optional(),
      effortLabel: z.string().optional(),
    })
    .optional(),
})
const CONFIG = z.object({ provider: z.enum(['claude', 'codex']), claude: PROFILE, codex: PROFILE })

export class AgentSettings {
  private value: z.infer<typeof CONFIG> = {
    provider: 'claude',
    claude: { access: 'native', baseUrl: '', model: '' },
    codex: { access: 'native', baseUrl: '', model: '' },
  }
  private readonly file: string
  constructor(directory: string) {
    this.file = path.join(directory, 'settings.json')
    try {
      this.value = CONFIG.parse(JSON.parse(readFileSync(this.file, 'utf8')))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  get(provider = this.value.provider): AgentConfiguration {
    const { encryptedKey, ...value } = this.value[provider]
    return { provider, ...value, hasApiKey: !!encryptedKey }
  }
  saveNative(provider: AgentProvider, native: AgentNativePreferences): void {
    this.persist({ ...this.value, [provider]: { ...this.value[provider], native } })
  }
  select(provider: AgentProvider): void {
    const next = { ...this.value, provider }
    this.persist(next)
  }
  key(provider: AgentProvider): string | undefined {
    const encryptedKey = this.value[provider].encryptedKey
    return encryptedKey ? safeStorage.decryptString(Buffer.from(encryptedKey, 'base64')) : undefined
  }
  save(value: {
    provider: AgentProvider
    access: 'native' | 'api'
    baseUrl: string
    model: string
    apiKey?: string
  }): void {
    const saved = this.value[value.provider]
    let encryptedKey = canReuseAgentApiKey(saved.baseUrl, value.baseUrl)
      ? saved.encryptedKey
      : undefined
    if (value.apiKey) {
      if (
        !safeStorage.isEncryptionAvailable() ||
        (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
      )
        throw new Error('Secure credential storage is unavailable')
      encryptedKey = safeStorage.encryptString(value.apiKey).toString('base64')
    }
    const next = {
      ...this.value,
      provider: value.provider,
      [value.provider]: {
        native: saved.native,
        access: value.access,
        baseUrl: value.baseUrl,
        model: value.model,
        encryptedKey,
      },
    }
    this.persist(next)
  }
  private persist(next: z.infer<typeof CONFIG>): void {
    const temporary = `${this.file}.${randomUUID()}.tmp`
    try {
      writeFileSync(temporary, JSON.stringify(next), { mode: 0o600, flag: 'wx' })
      renameSync(temporary, this.file)
      this.value = next
    } finally {
      rmSync(temporary, { force: true })
    }
  }
}
