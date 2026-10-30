import type { AgentProvider } from './types/agent'

export const AGENT_API_SERVICES = [
  'anthropic',
  'deepseek',
  'zhipu',
  'zhipu-coding',
  'kimi',
  'kimi-coding',
  'openai',
  'custom',
] as const
export type AgentApiServiceId = (typeof AGENT_API_SERVICES)[number]

export interface AgentApiModel {
  id: string
  label: string
  tools?: boolean
  vision?: boolean
  contextWindow?: number
  effortLevels?: string[]
}
export interface AgentApiCatalog {
  models: AgentApiModel[]
  source: 'remote' | 'curated'
  verifiedAt?: string
  warning?: string
}
export interface AgentApiPreset {
  id: AgentApiServiceId
  label: string
  baseUrl: string
  model: string
  auth: 'x-api-key' | 'Authorization'
  catalogPath?: string
  models: AgentApiModel[]
  sourceUrl?: string
  verifiedAt?: string
  supported?: false
}
const VERIFIED_AT = '2026-10-30'
const deepseek: AgentApiModel[] = [
  {
    id: 'deepseek-flash',
    label: 'DeepSeek Flash',
    tools: true,
    vision: true,
    contextWindow: 1048576,
    effortLevels: ['low', 'high', 'max'],
  },
  {
    id: 'deepseek-v4-pro',
    label: 'DeepSeek V4 Pro',
    tools: true,
    vision: false,
    contextWindow: 1048576,
    effortLevels: ['low', 'high', 'max'],
  },
]
const zhipu: AgentApiModel[] = [
  { id: 'glm-5.3', label: 'GLM-5.3', tools: true, effortLevels: ['high', 'max'] },
  { id: 'glm-5.3-flash', label: 'GLM-5.3-Flash', tools: true, effortLevels: ['high', 'max'] },
  { id: 'glm-5.2', label: 'GLM-5.2', tools: true, effortLevels: ['high', 'max'] },
]
const kimi: AgentApiModel[] = [
  {
    id: 'kimi-k3.1-pro',
    label: 'Kimi K3.1 Pro',
    tools: true,
    vision: true,
    contextWindow: 1000000,
    effortLevels: ['low', 'high', 'max'],
  },
  {
    id: 'kimi-k3.1-pro-highspeed',
    label: 'Kimi K3.1 Pro Highspeed',
    tools: true,
    vision: true,
    contextWindow: 1000000,
    effortLevels: ['low', 'high', 'max'],
  },
  {
    id: 'kimi-k3',
    label: 'Kimi K3',
    tools: true,
    vision: true,
    contextWindow: 1000000,
    effortLevels: ['low', 'high', 'max'],
  },
]
const kimiCoding: AgentApiModel[] = [
  {
    id: 'k3.1-pro',
    label: 'Kimi K3.1 Pro',
    tools: true,
    vision: true,
    effortLevels: ['low', 'high', 'max'],
  },
  {
    id: 'k3.1-pro-highspeed',
    label: 'Kimi K3.1 Pro Highspeed',
    tools: true,
    vision: true,
    effortLevels: ['low', 'high', 'max'],
  },
  { id: 'k3', label: 'Kimi K3', tools: true, vision: true, effortLevels: ['low', 'high', 'max'] },
  {
    id: 'k3-256k',
    label: 'Kimi K3 256K',
    tools: true,
    vision: true,
    contextWindow: 262144,
    effortLevels: ['low', 'high', 'max'],
  },
  {
    id: 'kimi-for-coding',
    label: 'Kimi K2.8 Preview',
    tools: true,
    effortLevels: ['low', 'high', 'max'],
  },
  { id: 'kimi-for-coding-highspeed', label: 'Kimi K2.7 Code Highspeed', tools: true },
]
const common = (provider: AgentProvider): AgentApiPreset[] => [
  {
    id: 'deepseek',
    // Current Codex emits namespace tools; DeepSeek documents only flat function tools.
    ...(provider === 'codex' ? { supported: false as const } : {}),
    label: 'DeepSeek',
    baseUrl:
      provider === 'claude' ? 'https://api.deepseek.com/anthropic' : 'https://api.deepseek.com',
    model: 'deepseek-flash',
    auth: 'Authorization',
    catalogPath: '/models',
    models: deepseek,
    sourceUrl: 'https://api-docs.deepseek.com/api/list-models/',
    verifiedAt: VERIFIED_AT,
  },
  ...(['zhipu', 'zhipu-coding'] as const).map(
    (id): AgentApiPreset => ({
      id,
      label: id === 'zhipu' ? 'Zhipu · API' : 'Zhipu · Coding Plan',
      // Current official guides share protocol endpoints. Product/key identity is separate.
      baseUrl:
        provider === 'claude'
          ? 'https://open.bigmodel.cn/api/anthropic'
          : 'https://open.bigmodel.cn/api/v1',
      model: 'glm-5.3',
      auth: provider === 'claude' ? 'x-api-key' : 'Authorization',
      models: id === 'zhipu-coding' ? zhipu.slice(0, 2) : zhipu,
      sourceUrl: 'https://docs.bigmodel.cn/cn/coding-plan/latest-model',
      verifiedAt: VERIFIED_AT,
    }),
  ),
  {
    id: 'kimi',
    label: 'Kimi · API',
    baseUrl:
      provider === 'claude' ? 'https://api.moonshot.cn/anthropic' : 'https://api.moonshot.cn/v1',
    model: 'kimi-k3.1-pro',
    auth: 'Authorization',
    catalogPath: '/v1/models',
    models: kimi,
    sourceUrl: 'https://platform.kimi.com/docs/api/list-models',
    verifiedAt: VERIFIED_AT,
  },
  {
    id: 'kimi-coding',
    label: 'Kimi Code',
    baseUrl:
      provider === 'claude' ? 'https://api.kimi.com/coding' : 'https://api.kimi.com/coding/v1',
    model: 'k3.1-pro',
    auth: provider === 'claude' ? 'x-api-key' : 'Authorization',
    models: kimiCoding,
    sourceUrl: 'https://www.kimi.com/code/docs/kimi-code/models.html',
    verifiedAt: VERIFIED_AT,
  },
]
const PRESETS: Record<AgentProvider, AgentApiPreset[]> = {
  claude: [
    ...common('claude'),
    {
      id: 'anthropic',
      label: 'Anthropic',
      baseUrl: 'https://api.anthropic.com',
      model: '',
      auth: 'x-api-key',
      catalogPath: '/v1/models',
      models: [],
    },
    { id: 'custom', label: '', baseUrl: '', model: '', auth: 'x-api-key', models: [] },
  ],
  codex: [
    ...common('codex'),
    {
      id: 'openai',
      label: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      model: '',
      auth: 'Authorization',
      catalogPath: '/v1/models',
      models: [],
    },
    { id: 'custom', label: '', baseUrl: '', model: '', auth: 'Authorization', models: [] },
  ],
}
export const agentApiPresets = (provider: AgentProvider): readonly AgentApiPreset[] =>
  PRESETS[provider].filter((preset) => preset.supported !== false)
export function agentApiService(provider: AgentProvider, id: AgentApiServiceId): AgentApiPreset {
  const preset = PRESETS[provider].find((item) => item.id === id)
  if (!preset) throw new Error('AGENT_API_SERVICE_INVALID')
  return preset
}
// Older profiles knew only these built-ins. Do not silently assign an existing
// custom key to a newly introduced service or billing product.
export function savedAgentApiService(
  provider: AgentProvider,
  baseUrl: string,
  id?: AgentApiServiceId,
): AgentApiServiceId {
  if (id) return id
  const inferred = agentApiPreset(provider, baseUrl).id
  const legacy = provider === 'claude' ? ['deepseek', 'anthropic'] : ['openai']
  return legacy.includes(inferred) ? inferred : 'custom'
}
const endpoint = (value: string) => {
  const url = new URL(value)
  if (url.username || url.password || url.search || url.hash) return undefined
  return url.origin + url.pathname.replace(/\/+$/, '')
}
export function agentApiPreset(provider: AgentProvider, baseUrl: string): AgentApiPreset {
  try {
    const target = endpoint(normalizeAgentApiUrl(provider, baseUrl))
    return (
      PRESETS[provider].find((preset) => preset.baseUrl && endpoint(preset.baseUrl) === target) ??
      PRESETS[provider].at(-1)!
    )
  } catch {
    return PRESETS[provider].at(-1)!
  }
}
export function normalizeAgentApiUrl(provider: AgentProvider, value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '')
  if (provider === 'claude' && URL.canParse(trimmed)) {
    const url = new URL(trimmed)
    if (
      url.origin === 'https://api.deepseek.com' &&
      ['', '/', '/v1', '/anthropic/v1'].includes(url.pathname)
    ) {
      url.pathname = '/anthropic'
      return url.toString().replace(/\/+$/, '')
    }
  }
  return trimmed
}
export function canReuseAgentApiKey(
  provider: AgentProvider,
  saved: { baseUrl: string; apiService?: AgentApiServiceId },
  edited: { baseUrl: string; apiService?: AgentApiServiceId },
): boolean {
  try {
    const savedUrl = endpoint(normalizeAgentApiUrl(provider, saved.baseUrl))
    const editedUrl = endpoint(normalizeAgentApiUrl(provider, edited.baseUrl))
    return (
      !!savedUrl &&
      savedUrl === editedUrl &&
      savedAgentApiService(provider, saved.baseUrl, saved.apiService) ===
        savedAgentApiService(provider, edited.baseUrl, edited.apiService)
    )
  } catch {
    return false
  }
}
