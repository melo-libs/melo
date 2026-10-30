import type { AgentProvider } from '../../../shared/types/agent'
import { normalizeAgentApiUrl } from '../../../shared/agentApi'
import { z } from 'zod'
import { claudeApiConfiguration } from './claudeAccess'

export interface AgentApiInput {
  provider: AgentProvider
  baseUrl: string
  model: string
  apiKey: string
}

export function validateAgentApi(input: AgentApiInput): AgentApiInput {
  const baseUrl = normalizeAgentApiUrl(input.provider, input.baseUrl)
  if (!URL.canParse(baseUrl)) throw new Error('AGENT_API_ENDPOINT_INVALID')
  const url = new URL(baseUrl)
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('AGENT_API_ENDPOINT_INVALID')
  const model = input.model.trim()
  if (!model || /\s/.test(model)) throw new Error('AGENT_API_MODEL_INVALID')
  if (!input.apiKey || !/^[\x21-\x7e]+$/.test(input.apiKey))
    throw new Error('AGENT_API_KEY_REQUIRED')
  const validated = { ...input, baseUrl, model }
  if (input.provider === 'claude') claudeApiConfiguration({ baseUrl, model, apiKey: input.apiKey })
  return validated
}

/** A stateless, short request validates credentials and model access without
 * creating a conversation or sending any workspace material. */
export async function testAgentApi(input: AgentApiInput): Promise<void> {
  const config = validateAgentApi(input)
  const claude = config.provider === 'claude'
  const headers: Record<string, string> = claude
    ? {
        ...claudeApiConfiguration({
          baseUrl: config.baseUrl,
          model: config.model,
          apiKey: config.apiKey,
        }).headers,
        'anthropic-version': '2023-06-01',
      }
    : { Authorization: `Bearer ${config.apiKey}` }
  let response: Response
  try {
    response = await fetch(`${config.baseUrl}${claude ? '/v1/messages' : '/responses'}`, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(20000),
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(
        claude
          ? {
              model: config.model.replace(/\[(1m|200k)\]$/, ''),
              max_tokens: 16,
              messages: [{ role: 'user', content: 'Reply OK.' }],
            }
          : { model: config.model, input: 'Reply OK.', max_output_tokens: 16, store: false },
      ),
    })
  } catch (error) {
    // Transport errors may retain request credentials; only expose a safe code.
    // eslint-disable-next-line preserve-caught-error
    throw new Error(
      error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)
        ? 'AGENT_API_TIMEOUT'
        : 'AGENT_API_NETWORK_ERROR',
    )
  }
  // Provider payloads can echo headers or request contents. Expose a classified
  // failure, never include raw response bodies in logs or saved conversations.
  let text: string
  try {
    text = await readReply(response)
  } catch {
    throw new Error('AGENT_API_PROTOCOL_ERROR')
  }
  if (!response.ok) {
    if ([401, 403].includes(response.status)) throw new Error('AGENT_API_AUTH_FAILED')
    if (response.status === 402) throw new Error('AGENT_API_PAYMENT_REQUIRED')
    if (response.status === 429) throw new Error('AGENT_API_RATE_LIMITED')
    if (response.status >= 500) throw new Error('AGENT_API_UNAVAILABLE')
    if (/model|模型/i.test(text)) throw new Error('AGENT_API_MODEL_INVALID')
    throw new Error(
      response.status === 404 ? 'AGENT_API_ENDPOINT_INVALID' : 'AGENT_API_REQUEST_FAILED',
    )
  }
  try {
    const schema = claude
      ? z.object({ type: z.literal('message'), content: z.array(z.unknown()) })
      : z.object({ output: z.array(z.unknown()), error: z.null().optional() })
    schema.parse(JSON.parse(text))
  } catch {
    throw new Error('AGENT_API_PROTOCOL_ERROR')
  }
}

async function readReply(response: Response): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      length += next.value.byteLength
      if (length > 64 * 1024) {
        await reader.cancel()
        throw new Error('API reply is too large')
      }
      chunks.push(next.value)
    }
    return Buffer.concat(chunks).toString('utf8')
  } finally {
    reader.releaseLock()
  }
}
