import type { AgentProvider } from '../../../shared/types/agent'
import {
  agentApiService,
  normalizeAgentApiUrl,
  savedAgentApiService,
  type AgentApiServiceId,
} from '../../../shared/agentApi'

export interface AgentApiEndpoint {
  provider: AgentProvider
  apiService?: AgentApiServiceId
  baseUrl: string
  apiKey: string
}
export interface ResolvedAgentApiEndpoint extends AgentApiEndpoint {
  apiService: AgentApiServiceId
}

export function validateAgentApiEndpoint(input: AgentApiEndpoint): ResolvedAgentApiEndpoint {
  const normalized = normalizeAgentApiUrl(input.provider, input.baseUrl)
  if (!URL.canParse(normalized)) throw new Error('AGENT_API_ENDPOINT_INVALID')
  const url = new URL(normalized)
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('AGENT_API_ENDPOINT_INVALID')
  const baseUrl = url.origin + url.pathname.replace(/\/+$/, '')
  const apiService = savedAgentApiService(input.provider, baseUrl, input.apiService)
  const service = agentApiService(input.provider, apiService)
  if (apiService !== 'custom' && baseUrl !== service.baseUrl)
    throw new Error('AGENT_API_ENDPOINT_INVALID')
  if (!input.apiKey || input.apiKey.length > 4096 || !/^[\x21-\x7e]+$/.test(input.apiKey))
    throw new Error('AGENT_API_KEY_REQUIRED')
  return { provider: input.provider, baseUrl, apiKey: input.apiKey, apiService }
}
export function agentApiHeaders(input: ResolvedAgentApiEndpoint): Record<string, string> {
  const service = agentApiService(input.provider, input.apiService)
  return {
    ...(service.auth === 'Authorization'
      ? { Authorization: `Bearer ${input.apiKey}` }
      : { 'x-api-key': input.apiKey }),
    ...(input.provider === 'claude' ? { 'anthropic-version': '2023-06-01' } : {}),
  }
}

/** Short requests never send workspace material, follow redirects or expose provider payloads. */
export async function requestAgentApi(
  url: string,
  init: RequestInit,
  maxBytes = 64 * 1024,
): Promise<string> {
  let response: Response
  try {
    response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(20000) })
  } catch (error) {
    // Transport errors may retain request credentials; only expose a safe code.
    // eslint-disable-next-line preserve-caught-error
    throw new Error(transportErrorCode(error))
  }
  let text: string
  try {
    text = await readReply(response, maxBytes)
  } catch (error) {
    // A valid HTTP failure stays authoritative even if its diagnostic body is
    // oversized or interrupted. Successful responses can fail during streaming.
    // eslint-disable-next-line preserve-caught-error
    throw new Error(
      !response.ok
        ? responseErrorCode(response.status)
        : error instanceof Error && error.message === 'AGENT_API_PROTOCOL_ERROR'
          ? 'AGENT_API_PROTOCOL_ERROR'
          : transportErrorCode(error),
    )
  }
  if (!response.ok) {
    throw new Error(responseErrorCode(response.status, text))
  }
  return text
}
function transportErrorCode(error: unknown): string {
  return error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)
    ? 'AGENT_API_TIMEOUT'
    : 'AGENT_API_NETWORK_ERROR'
}
function responseErrorCode(status: number, body = ''): string {
  if ([401, 403].includes(status)) return 'AGENT_API_AUTH_FAILED'
  if (status === 402) return 'AGENT_API_PAYMENT_REQUIRED'
  if (status === 429) return 'AGENT_API_RATE_LIMITED'
  if (status >= 500) return 'AGENT_API_UNAVAILABLE'
  if (/model|模型/i.test(body)) return 'AGENT_API_MODEL_INVALID'
  return status === 404 ? 'AGENT_API_ENDPOINT_INVALID' : 'AGENT_API_REQUEST_FAILED'
}
async function readReply(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      length += next.value.byteLength
      if (length > maxBytes) {
        await reader.cancel()
        throw new Error('AGENT_API_PROTOCOL_ERROR')
      }
      chunks.push(next.value)
    }
    return Buffer.concat(chunks).toString('utf8')
  } finally {
    reader.releaseLock()
  }
}
