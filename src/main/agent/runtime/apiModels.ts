import { createHash } from 'node:crypto'
import { z } from 'zod'
import { agentApiService, type AgentApiCatalog, type AgentApiModel } from '../../../shared/agentApi'
import {
  agentApiHeaders,
  requestAgentApi,
  validateAgentApiEndpoint,
  type AgentApiEndpoint,
} from './apiConnection'

const MODEL = z.object({
  id: z
    .string()
    .min(1)
    .max(256)
    .regex(/^[^\s]+$/),
  lifecycle: z.enum(['active', 'deprecated', 'retired']).optional(),
  max_input_tokens: z.number().int().nonnegative().nullable().optional(),
  capabilities: z
    .object({ image_input: z.object({ supported: z.boolean() }).optional() })
    .nullable()
    .optional(),
  display_name: z.string().max(256).optional(),
  name: z.string().max(256).optional(),
  context_window: z.number().int().positive().optional(),
  context_length: z.number().int().positive().optional(),
  supports_image_in: z.boolean().optional(),
  input_modalities: z.array(z.string()).optional(),
  supports_tool_calling: z.boolean().optional(),
  effort: z.object({ supported_levels: z.array(z.string().max(64)).max(16) }).optional(),
})
const CATALOG = z.object({
  data: z.array(MODEL).max(2000),
  has_more: z.boolean().optional(),
  last_id: z.string().min(1).max(256).optional(),
})

export class ApiModels {
  private readonly cache = new Map<string, AgentApiCatalog>()
  private readonly pending = new Map<string, Promise<AgentApiCatalog>>()

  load(input: AgentApiEndpoint, refresh = false): Promise<AgentApiCatalog> {
    const config = validateAgentApiEndpoint(input)
    const key = createHash('sha256').update(JSON.stringify(config)).digest('hex')
    if (!refresh && this.cache.has(key)) return Promise.resolve(this.cache.get(key)!)
    const pending = this.pending.get(key)
    if (pending) return pending
    const request = this.fetch(config)
      .then((catalog) => {
        this.cache.delete(key)
        this.cache.set(key, catalog)
        if (this.cache.size > 16) this.cache.delete(this.cache.keys().next().value!)
        return catalog
      })
      .catch((error: Error) => {
        const service = agentApiService(config.provider, config.apiService!)
        const fallback =
          this.cache.get(key) ??
          (service.models.length
            ? {
                models: service.models,
                source: 'curated' as const,
                verifiedAt: service.verifiedAt,
              }
            : undefined)
        // A fallback is a directory, never a credential check. Keep the failure
        // visible and do not cache it as a successful refresh.
        if (fallback) return { ...fallback, warning: error.message }
        throw error
      })
      .finally(() => this.pending.delete(key))
    this.pending.set(key, request)
    return request
  }

  private async fetch(config: AgentApiEndpoint): Promise<AgentApiCatalog> {
    const service = agentApiService(config.provider, config.apiService!)
    if (!service.catalogPath && service.id !== 'custom')
      return {
        models: service.models,
        source: 'curated',
        verifiedAt: service.verifiedAt,
      }
    const url = service.catalogPath
      ? new URL(service.catalogPath, config.baseUrl)
      : new URL(`${config.baseUrl}${config.provider === 'claude' ? '/v1/models' : '/models'}`)
    const models = new Map<string, AgentApiModel>()
    for (let page = 0; page < 10; page++) {
      const text = await requestAgentApi(
        url.toString(),
        { headers: agentApiHeaders(config) },
        512 * 1024,
      )
      let catalog: z.infer<typeof CATALOG>
      try {
        catalog = CATALOG.parse(JSON.parse(text))
      } catch {
        throw new Error('AGENT_API_PROTOCOL_ERROR')
      }
      for (const item of catalog.data) {
        if (
          item.lifecycle === 'retired' ||
          item.supports_tool_calling === false ||
          /embedding|moderation|whisper|tts|dall-e|image|audio|realtime|transcri|sora/i.test(
            item.id,
          )
        )
          continue
        const known = service.models.find((model) => model.id === item.id)
        // Kimi's Messages compatibility guide explicitly names this subset.
        // Other IDs remain available through manual entry and a real probe.
        if (service.id === 'kimi' && !known) continue
        models.set(item.id, {
          ...known,
          id: item.id,
          label: item.display_name ?? item.name ?? known?.label ?? item.id,
          ...(item.context_window || item.context_length || item.max_input_tokens
            ? {
                contextWindow:
                  item.context_window ?? item.context_length ?? item.max_input_tokens ?? undefined,
              }
            : {}),
          ...(item.supports_image_in !== undefined
            ? { vision: item.supports_image_in }
            : item.capabilities?.image_input
              ? { vision: item.capabilities.image_input.supported }
              : item.input_modalities
                ? { vision: item.input_modalities.includes('image') }
                : {}),
          ...(item.supports_tool_calling !== undefined
            ? { tools: item.supports_tool_calling }
            : {}),
          ...(item.effort ? { effortLevels: item.effort.supported_levels } : {}),
        })
      }
      if (!catalog.has_more) {
        if (!models.size) throw new Error('AGENT_API_MODELS_EMPTY')
        return { models: [...models.values()], source: 'remote' }
      }
      if (!catalog.last_id || catalog.last_id === url.searchParams.get('after_id')) break
      url.searchParams.set('after_id', catalog.last_id)
    }
    throw new Error('AGENT_API_PROTOCOL_ERROR')
  }
}
