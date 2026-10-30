import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
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
