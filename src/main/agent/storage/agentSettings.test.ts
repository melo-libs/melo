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
    settings.saveVerifiedApi({
      provider: 'claude',
      baseUrl: 'https://claude.example',
      model: 'claude',
      apiKey: 'test-claude-secret',
    })
    settings.saveVerifiedApi({
      provider: 'codex',
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

it('switches access without changing saved credentials, verification or native preferences', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'melo-agent-settings-'))
  try {
    const settings = new AgentSettings(directory)
    expect(() => settings.setAccess('claude', 'api')).toThrow('AGENT_API_KEY_REQUIRED')
    settings.saveNative('claude', { model: 'native-model' })
    settings.saveVerifiedApi({
      provider: 'claude',
      baseUrl: 'https://api.deepseek.com/anthropic',
      model: 'deepseek-flash',
      apiKey: 'fixture-key',
    })
    const profile = settings.get('claude')
    settings.setAccess('claude', 'native')
    expect(settings.get('claude')).toEqual({ ...profile, access: 'native' })
    settings.setAccess('claude', 'api')
    expect(new AgentSettings(directory).get('claude')).toEqual(profile)
    expect(settings.key('claude')).toBe('fixture-key')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

it('keeps legacy custom keys custom when a new service happens to share their address', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'melo-agent-settings-'))
  try {
    const settings = new AgentSettings(directory)
    settings.saveVerifiedApi({
      provider: 'claude',
      baseUrl: 'https://open.bigmodel.cn/api/anthropic',
      model: 'glm-5.3',
      apiKey: 'legacy-key',
    })
    const file = path.join(directory, 'settings.json')
    const legacy = JSON.parse(readFileSync(file, 'utf8'))
    delete legacy.claude.apiService
    delete legacy.claude.apiVerified
    writeFileSync(file, JSON.stringify(legacy))
    const restored = new AgentSettings(directory)
    expect(restored.get().apiService).toBe('custom')
    expect(restored.key('claude')).toBe('legacy-key')
    expect(restored.get().apiVerified).toBeUndefined()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

it('persists verification only for the validated profile and preserves it across access changes', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'melo-agent-settings-'))
  try {
    const settings = new AgentSettings(directory)
    const profile = {
      provider: 'claude' as const,
      access: 'api' as const,
      baseUrl: 'https://api.deepseek.com/anthropic',
      model: 'deepseek-flash',
      apiService: 'deepseek' as const,
    }
    settings.saveVerifiedApi({ ...profile, apiKey: 'fixture-key' })
    expect(new AgentSettings(directory).get('claude').apiVerified).toBe(true)
    expect(settings.invalidateApiVerification({ ...profile, apiKey: 'wrong-replacement' })).toBe(
      false,
    )
    expect(settings.get('claude').apiVerified).toBe(true)
    expect(settings.invalidateApiVerification({ ...profile, apiKey: 'fixture-key' })).toBe(true)
    expect(new AgentSettings(directory).get('claude').apiVerified).toBe(false)
    settings.saveVerifiedApi({ ...profile, apiKey: 'fixture-key' })

    settings.setAccess('claude', 'native')
    settings.setAccess('claude', 'api')
    expect(settings.get('claude').apiVerified).toBe(true)
    settings.saveVerifiedApi({ ...profile, model: 'another-model', apiKey: 'replacement-key' })
    const restored = new AgentSettings(directory)
    expect(restored.get('claude').apiVerified).toBe(true)
    expect(restored.get('claude').model).toBe('another-model')
    expect(restored.key('claude')).toBe('replacement-key')
    restored.invalidateApiVerification({ ...profile, apiKey: 'fixture-key' })
    expect(restored.get('claude').apiVerified).toBe(true)
    restored.saveVerifiedApi({ ...profile, apiKey: 'new-key' })
    expect(restored.invalidateApiVerification({ ...profile, apiKey: 'fixture-key' })).toBe(false)
    expect(new AgentSettings(directory).get('claude').apiVerified).toBe(true)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
