import { expect, it } from 'vitest'
import { agentApiPresets, canReuseAgentApiKey, savedAgentApiService } from './agentApi'

it('offers only compatible built-ins for each Harness', () => {
  expect(agentApiPresets('claude').some((service) => service.id === 'deepseek')).toBe(true)
  expect(agentApiPresets('codex').some((service) => service.id === 'deepseek')).toBe(false)
  expect(agentApiPresets('codex').map((service) => service.id)).toEqual(
    expect.arrayContaining(['openai', 'custom', 'kimi', 'zhipu']),
  )
})
it('recognizes only providers that existed in that Harness when migrating a legacy key', () => {
  expect(savedAgentApiService('claude', 'https://api.deepseek.com/anthropic')).toBe('deepseek')
  expect(savedAgentApiService('codex', 'https://api.deepseek.com')).toBe('custom')
  expect(savedAgentApiService('codex', 'https://api.openai.com/v1')).toBe('openai')
  expect(savedAgentApiService('claude', 'https://open.bigmodel.cn/api/anthropic')).toBe('custom')
  expect(
    canReuseAgentApiKey(
      'codex',
      { baseUrl: 'https://api.deepseek.com' },
      { baseUrl: 'https://api.deepseek.com', apiService: 'custom' },
    ),
  ).toBe(true)
  expect(
    canReuseAgentApiKey(
      'codex',
      { baseUrl: 'https://api.deepseek.com' },
      { baseUrl: 'https://api.deepseek.com', apiService: 'deepseek' },
    ),
  ).toBe(false)
})
