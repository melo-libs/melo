import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { expect, it, vi } from 'vitest'
import { AgentSettings } from './agentSettings'

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'keychain',
    encryptString: (s: string) => Buffer.from(s.split('').reverse().join('')),
    decryptString: (b: Buffer) => b.toString().split('').reverse().join(''),
  },
}))

it('keeps separate encrypted API profiles while changing the selected harness', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'melo-agent-settings-'))
  try {
    const settings = new AgentSettings(directory)
    settings.save({
      provider: 'claude',
      access: 'api',
      baseUrl: 'https://claude.example',
      model: 'claude',
      apiKey: 'test-claude-secret',
    })
    settings.save({
      provider: 'codex',
      access: 'api',
      baseUrl: 'https://codex.example/v1',
      model: 'codex',
      apiKey: 'test-codex-secret',
    })
    settings.select('claude')
    const restored = new AgentSettings(directory)
    expect(restored.get().provider).toBe('claude')
    expect(restored.key('claude')).toBe('test-claude-secret')
    expect(restored.key('codex')).toBe('test-codex-secret')
    const raw = readFileSync(path.join(directory, 'settings.json'), 'utf8')
    expect(raw).not.toContain('test-claude-secret')
    expect(raw).not.toContain('test-codex-secret')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

it('retains a key across access changes, but never rebinds it to a different origin', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'melo-agent-settings-'))
  try {
    const settings = new AgentSettings(directory)
    const profile = {
      provider: 'claude' as const,
      baseUrl: 'https://api.deepseek.com/anthropic',
      model: 'deepseek-flash',
    }
    settings.save({ ...profile, access: 'api', apiKey: 'fixture-key' })
    settings.save({ ...profile, access: 'native' })
    expect(settings.key('claude')).toBe('fixture-key')
    settings.save({ ...profile, access: 'api' })
    expect(settings.key('claude')).toBe('fixture-key')
    settings.save({ ...profile, access: 'native', baseUrl: 'https://another.example/anthropic' })
    expect(settings.get('claude').hasApiKey).toBe(false)
    expect(settings.key('claude')).toBeUndefined()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

it('never reuses a key for a different path or billing product, even on the same host', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'melo-agent-settings-'))
  try {
    const settings = new AgentSettings(directory)
    const profile = {
      provider: 'claude' as const,
      access: 'api' as const,
      baseUrl: 'https://open.bigmodel.cn/api/anthropic',
      model: 'glm-5.3',
    }
    settings.save({ ...profile, apiService: 'zhipu', apiKey: 'ordinary-key' })
    settings.save({ ...profile, apiService: 'zhipu-coding' })
    expect(settings.key('claude')).toBeUndefined()
    settings.save({ ...profile, apiService: 'zhipu-coding', apiKey: 'coding-key' })
    settings.save({ ...profile, apiService: 'zhipu-coding', access: 'native' })
    const restored = new AgentSettings(directory)
    expect(restored.get().apiService).toBe('zhipu-coding')
    expect(restored.key('claude')).toBe('coding-key')
    restored.save({ ...profile, apiService: 'custom', baseUrl: 'https://open.bigmodel.cn/other' })
    expect(restored.key('claude')).toBeUndefined()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

it('keeps legacy custom keys custom when a new service happens to share their address', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'melo-agent-settings-'))
  try {
    const settings = new AgentSettings(directory)
    settings.save({
      provider: 'claude',
      access: 'api',
      baseUrl: 'https://open.bigmodel.cn/api/anthropic',
      model: 'glm-5.3',
      apiKey: 'legacy-key',
    })
    const file = path.join(directory, 'settings.json')
    const legacy = JSON.parse(readFileSync(file, 'utf8'))
    delete legacy.claude.apiService
    writeFileSync(file, JSON.stringify(legacy))
    const restored = new AgentSettings(directory)
    expect(restored.get().apiService).toBe('custom')
    expect(restored.key('claude')).toBe('legacy-key')
    restored.save({
      provider: 'claude',
      access: 'api',
      apiService: 'zhipu',
      baseUrl: 'https://open.bigmodel.cn/api/anthropic',
      model: 'glm-5.3',
    })
    expect(restored.key('claude')).toBeUndefined()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
