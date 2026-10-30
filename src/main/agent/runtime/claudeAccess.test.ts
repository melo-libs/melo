import { describe, expect, it } from 'vitest'
import { claudeAccessState, claudeApiConfiguration } from './claudeAccess'

describe('Claude access', () => {
  it('distinguishes an unreported identity, missing setup, and configured credentials', () => {
    expect(claudeAccessState({})).toBeUndefined()
    expect(claudeAccessState({ authStatus: { kind: 'none' } })).toEqual({ status: 'needs-setup' })
    expect(claudeAccessState({ authStatus: { kind: 'gateway' } })).toEqual({
      status: 'configured',
      source: 'gateway',
    })
    expect(
      claudeAccessState({
        authStatus: { kind: 'account', account: { email: 'private@example.com' } },
      }),
    ).toEqual({ status: 'configured', source: 'account' })
  })

  it('isolates provider credentials in the owned Claude Code environment', () => {
    const config = claudeApiConfiguration({
      baseUrl: 'https://api.example.com',
      apiKey: 'test-key',
      model: 'test-model',
    })
    expect(config).toEqual({
      baseUrl: 'https://api.example.com',
      headers: { 'x-api-key': 'test-key' },
      model: 'test-model',
      environment: {
        ANTHROPIC_BASE_URL: 'https://api.example.com',
        ANTHROPIC_API_KEY: 'test-key',
        ANTHROPIC_AUTH_TOKEN: '',
      },
    })
    expect(
      claudeApiConfiguration({
        baseUrl: 'https://api.deepseek.com/anthropic',
        apiKey: 'test-key',
        model: 'deepseek-flash',
      }).environment,
    ).toEqual({
      ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
      ANTHROPIC_API_KEY: '',
      ANTHROPIC_AUTH_TOKEN: 'test-key',
    })
  })

  it.each([
    { baseUrl: 'http://api.example.com' },
    { baseUrl: 'file:///etc/passwd' },
    { baseUrl: 'https://key:secret@example.com' },
    { baseUrl: 'https://api.example.com?key=secret' },
    { apiKey: 'key\r\nx-injected: true' },
    { model: '' },
    { protocol: 'openai' },
  ])('rejects unsafe or unsupported API configuration %j', (override) => {
    expect(() =>
      claudeApiConfiguration({
        baseUrl: 'https://api.example.com',
        apiKey: 'test-key',
        model: 'test-model',
        ...override,
      }),
    ).toThrow()
  })
})
