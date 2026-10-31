import { z } from 'zod'
import {
  AGENT_API_SERVICES,
  agentApiPreset,
  agentApiService,
  normalizeAgentApiUrl,
  validateAgentApiModel,
} from '../../../shared/agentApi'

export const CLAUDE_AUTH_STATUS_METHOD = '_auth/status_update'

export type ClaudeAccessState =
  | { status: 'not-reported' }
  | { status: 'needs-setup' }
  | { status: 'configured'; source: 'account' | 'api_key' | 'gateway' | 'external' }

const AUTH_STATUS = z.object({
  authStatus: z.object({ kind: z.enum(['none', 'account', 'api_key', 'gateway', 'external']) }),
})

// Configuration is not proof of a successful model call. Keep this separate
// from connection/turn state, and keep account details out of conversation data.
export function claudeAccessState(notification: unknown): ClaudeAccessState | undefined {
  const parsed = AUTH_STATUS.safeParse(notification)
  if (!parsed.success) return undefined
  const source = parsed.data.authStatus.kind
  return source === 'none' ? { status: 'needs-setup' } : { status: 'configured', source }
}

const API_CONFIGURATION = z
  .object({
    baseUrl: z
      .string()
      .max(2048)
      .url()
      .refine((value) => {
        if (!URL.canParse(value)) return false
        const url = new URL(value)
        const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
        return (
          !url.username &&
          !url.password &&
          !url.search &&
          !url.hash &&
          !/[\r\n]/.test(value) &&
          (url.protocol === 'https:' || (url.protocol === 'http:' && loopback))
        )
      }, 'Use HTTPS, or HTTP on loopback, without embedded credentials, query, or fragment'),
    apiKey: z
      .string()
      .min(1)
      .max(4096)
      .regex(/^[\x21-\x7e]+$/),
    authHeader: z.enum(['x-api-key', 'Authorization']).optional(),
    apiService: z.enum(AGENT_API_SERVICES).optional(),
    model: z
      .string()
      .min(1)
      .max(256)
      .regex(/^[^\s\r\n]+$/),
  })
  .strict()

// Route only this owned subprocess through the provider's documented Claude
// Code environment. ACP gateway auth replaces bearer credentials with its own
// placeholder in the installed SDK, so it cannot carry DeepSeek tokens.
export function claudeApiConfiguration(input: unknown): {
  baseUrl: string
  headers: Record<string, string>
  model: string
  environment: {
    ANTHROPIC_BASE_URL: string
    ANTHROPIC_API_KEY: string
    ANTHROPIC_AUTH_TOKEN: string
  }
} {
  const parsed = API_CONFIGURATION.parse(input)
  const baseUrl = normalizeAgentApiUrl('claude', parsed.baseUrl)
  const { apiKey } = parsed
  const service = parsed.apiService
    ? agentApiService('claude', parsed.apiService)
    : agentApiPreset('claude', baseUrl)
  const model = validateAgentApiModel(service.id, parsed.model)
  const bearer = (parsed.authHeader ?? service.auth) === 'Authorization'
  return {
    baseUrl,
    headers: bearer ? { Authorization: `Bearer ${apiKey}` } : { 'x-api-key': apiKey },
    model,
    environment: {
      ANTHROPIC_BASE_URL: baseUrl,
      ANTHROPIC_API_KEY: bearer ? '' : apiKey,
      ANTHROPIC_AUTH_TOKEN: bearer ? apiKey : '',
    },
  }
}
