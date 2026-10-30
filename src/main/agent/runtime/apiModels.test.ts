import { afterEach, expect, it, vi } from 'vitest'
import { ApiModels } from './apiModels'
import { testAgentApi, validateAgentApiEndpoint } from './apiConnection'
import { agentApiService, type AgentApiServiceId } from '../../../shared/agentApi'
import type { AgentProvider } from '../../../shared/types/agent'
import { claudeApiConfiguration } from './claudeAccess'

afterEach(() => vi.unstubAllGlobals())
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const input = (provider: AgentProvider, apiService: AgentApiServiceId) => ({
  provider,
  apiService,
  baseUrl: agentApiService(provider, apiService).baseUrl,
  apiKey: 'fixture-key',
})

it('queries the official directory with bounded, redirect-free authenticated requests and caches by credential scope', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () =>
    json({
      data: [
        {
          id: 'deepseek-flash',
          context_window: 1048576,
          input_modalities: ['text', 'image'],
          effort: { supported_levels: ['low', 'high', 'max'] },
        },
        { id: 'embedding-only' },
        { id: 'chat-without-tools', supports_tool_calling: false },
      ],
    }),
  )
  vi.stubGlobal('fetch', fetch)
  const models = new ApiModels()
  const config = input('claude', 'deepseek')
  const result = await models.load(config)
  expect(result.source).toBe('remote')
  expect(result.models).toEqual([
    expect.objectContaining({
      id: 'deepseek-flash',
      tools: true,
      vision: true,
      contextWindow: 1048576,
      effortLevels: ['low', 'high', 'max'],
    }),
  ])
  expect(fetch).toHaveBeenCalledWith(
    'https://api.deepseek.com/models',
    expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer fixture-key' }),
      redirect: 'error',
      signal: expect.any(AbortSignal),
    }),
  )
  await models.load(config)
  expect(fetch).toHaveBeenCalledTimes(1)
  const ipcInput = { ...config, action: 'api-models', refresh: true }
  await models.load(ipcInput, true)
  expect(fetch).toHaveBeenCalledTimes(2)
  await models.load(config)
  expect(fetch).toHaveBeenCalledTimes(2)
  await models.load({ ...config, apiKey: 'different-key' })
  await models.load({ ...input('codex', 'openai'), baseUrl: 'https://api.openai.com/v1' })
  expect(fetch).toHaveBeenCalledTimes(4)
})

it('deduplicates concurrent loads and preserves the last catalog with a safe warning when a refresh fails', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () =>
    json({ data: [{ id: 'deepseek-flash' }] }),
  )
  vi.stubGlobal('fetch', fetch)
  const models = new ApiModels(),
    config = input('claude', 'deepseek')
  await Promise.all([models.load(config), models.load(config)])
  expect(fetch).toHaveBeenCalledTimes(1)
  fetch.mockImplementation(async () => json({ error: 'echoed fixture-key' }, 401))
  const fallback = await models.load(config, true)
  expect(fallback).toMatchObject({
    source: 'remote',
    warning: 'AGENT_API_AUTH_FAILED',
    models: [{ id: 'deepseek-flash' }],
  })
  expect(JSON.stringify(fallback)).not.toContain('fixture-key')
  expect((await new ApiModels().load(config)).source).toBe('curated')
})

it.each(['zhipu', 'zhipu-coding', 'kimi-coding'] as const)(
  'uses a dated verified %s directory rather than inventing a catalog endpoint',
  async (service) => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const catalog = await new ApiModels().load(input('claude', service))
    expect(catalog.source).toBe('curated')
    expect(catalog.verifiedAt).toBeTruthy()
    expect(catalog.models.length).toBeGreaterThan(1)
    expect(fetch).not.toHaveBeenCalled()
  },
)

it('keeps Kimi API models distinct from Kimi Code aliases and filters unverified Messages models', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof globalThis.fetch>(async () =>
      json({
        data: [
          { id: 'kimi-k3.1-pro', context_length: 1000000, supports_image_in: true },
          { id: 'kimi-for-coding' },
          { id: 'moonshot-v1-8k' },
        ],
      }),
    ),
  )
  const catalog = await new ApiModels().load(input('claude', 'kimi'))
  expect(catalog.models.map((item) => item.id)).toEqual(['kimi-k3.1-pro'])
  expect(
    (await new ApiModels().load(input('claude', 'kimi-coding'))).models.map((item) => item.id),
  ).toContain('kimi-for-coding')
})

it('supports Anthropic pagination and rejects malformed or oversized responses without echoing them', async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(json({ data: [{ id: 'first' }], has_more: true, last_id: 'first' }))
    .mockResolvedValueOnce(json({ data: [{ id: 'second' }], has_more: false }))
  vi.stubGlobal('fetch', fetch)
  expect(
    (await new ApiModels().load(input('claude', 'anthropic'))).models.map((item) => item.id),
  ).toEqual(['first', 'second'])
  expect(fetch.mock.calls[1][0]).toBe('https://api.anthropic.com/v1/models?after_id=first')
  fetch.mockResolvedValue(json({ data: [{ id: 'fixture-key bad id' }] }))
  await expect(new ApiModels().load(input('claude', 'anthropic'))).rejects.toThrow(
    'AGENT_API_PROTOCOL_ERROR',
  )
  fetch.mockResolvedValue(new Response('secret'.repeat(100000)))
  await expect(new ApiModels().load(input('claude', 'anthropic'))).rejects.toThrow(
    'AGENT_API_PROTOCOL_ERROR',
  )
})

it('rejects a built-in service at an unrelated endpoint before forwarding a credential', () => {
  expect(() =>
    validateAgentApiEndpoint({
      ...input('claude', 'kimi'),
      baseUrl: 'https://api.moonshot.cn/other',
    }),
  ).toThrow('AGENT_API_ENDPOINT_INVALID')
  expect(() =>
    validateAgentApiEndpoint({ ...input('codex', 'openai'), apiService: 'anthropic' }),
  ).toThrow('AGENT_API_SERVICE_INVALID')
})

const routes = [
  {
    service: 'deepseek',
    model: 'deepseek-flash',
    claude: 'https://api.deepseek.com/anthropic',
    codex: 'https://api.deepseek.com',
    claudeAuth: 'Authorization',
  },
  {
    service: 'zhipu',
    model: 'glm-5.3',
    claude: 'https://open.bigmodel.cn/api/anthropic',
    codex: 'https://open.bigmodel.cn/api/v1',
    claudeAuth: 'x-api-key',
  },
  {
    service: 'zhipu-coding',
    model: 'glm-5.3',
    claude: 'https://open.bigmodel.cn/api/anthropic',
    codex: 'https://open.bigmodel.cn/api/v1',
    claudeAuth: 'x-api-key',
  },
  {
    service: 'kimi',
    model: 'kimi-k3.1-pro',
    claude: 'https://api.moonshot.cn/anthropic',
    codex: 'https://api.moonshot.cn/v1',
    claudeAuth: 'Authorization',
  },
  {
    service: 'kimi-coding',
    model: 'k3.1-pro',
    claude: 'https://api.kimi.com/coding',
    codex: 'https://api.kimi.com/coding/v1',
    claudeAuth: 'x-api-key',
  },
] as const
it.each(
  (['claude', 'codex'] as const).flatMap((provider) =>
    routes
      .filter((route) => provider !== 'codex' || route.service !== 'deepseek')
      .map((route) => ({ provider, ...route })),
  ),
)(
  'sends a $provider protocol probe for $service with its documented endpoint and authentication',
  async ({ provider, service, model, claude, codex, claudeAuth }) => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      json(
        provider === 'claude'
          ? { type: 'message', content: [{ type: 'text', text: 'OK' }] }
          : { output: [] },
      ),
    )
    vi.stubGlobal('fetch', fetch)
    const config = input(provider, service)
    await testAgentApi({ ...config, model })
    const [url, request] = fetch.mock.calls[0]
    expect(url).toBe(provider === 'claude' ? `${claude}/v1/messages` : `${codex}/responses`)
    expect(request!.redirect).toBe('error')
    const headers =
      provider === 'codex' || claudeAuth === 'Authorization'
        ? { Authorization: 'Bearer fixture-key' }
        : { 'x-api-key': 'fixture-key' }
    expect(request!.headers).toMatchObject(headers)
    expect(JSON.parse(request!.body as string)).toMatchObject({ model })
    if (provider === 'claude') {
      const auth = claudeApiConfiguration({
        apiService: service,
        baseUrl: claude,
        apiKey: config.apiKey,
        model,
      })
      expect(auth.headers).toMatchObject(headers)
      expect(auth.environment.ANTHROPIC_AUTH_TOKEN || auth.environment.ANTHROPIC_API_KEY).toBe(
        'fixture-key',
      )
    }
  },
)

it('accepts canonical equivalents of an official URL without changing the service or credential scope', () => {
  expect(
    validateAgentApiEndpoint({
      ...input('claude', 'anthropic'),
      baseUrl: 'https://API.ANTHROPIC.COM:443/',
    }),
  ).toMatchObject({ baseUrl: 'https://api.anthropic.com', apiService: 'anthropic' })
})

it('filters an incompatible service before connecting or discovering models', () => {
  expect(() => validateAgentApiEndpoint(input('codex', 'deepseek'))).toThrow(
    'AGENT_API_HARNESS_UNSUPPORTED',
  )
})
