import type { AgentProvider } from './types/agent'

export interface AgentApiPreset {
  id: 'anthropic' | 'deepseek' | 'openai' | 'custom'
  label: string
  baseUrl: string
  model: string
}

const PRESETS: Record<AgentProvider, AgentApiPreset[]> = {
  claude: [
    {
      id: 'deepseek',
      label: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com/anthropic',
      model: 'deepseek-flash',
    },
    { id: 'anthropic', label: 'Anthropic', baseUrl: 'https://api.anthropic.com', model: '' },
    { id: 'custom', label: '', baseUrl: '', model: '' },
  ],
  codex: [
    { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: '' },
    { id: 'custom', label: '', baseUrl: '', model: '' },
  ],
}

export const agentApiPresets = (provider: AgentProvider): readonly AgentApiPreset[] =>
  PRESETS[provider]

export function agentApiPreset(provider: AgentProvider, baseUrl: string): AgentApiPreset {
  try {
    const host = new URL(baseUrl).host
    return (
      PRESETS[provider].find((preset) => preset.baseUrl && new URL(preset.baseUrl).host === host) ??
      PRESETS[provider].at(-1)!
    )
  } catch {
    return PRESETS[provider].at(-1)!
  }
}

export function normalizeAgentApiUrl(provider: AgentProvider, value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '')
  if (provider === 'claude' && agentApiPreset(provider, trimmed).id === 'deepseek') {
    const url = new URL(trimmed)
    if (['', '/', '/v1', '/anthropic/v1'].includes(url.pathname)) {
      url.pathname = '/anthropic'
      return url.toString().replace(/\/+$/, '')
    }
  }
  return trimmed
}

export function canReuseAgentApiKey(savedUrl: string, editedUrl: string): boolean {
  try {
    return new URL(savedUrl).origin === new URL(editedUrl).origin
  } catch {
    return false
  }
}
