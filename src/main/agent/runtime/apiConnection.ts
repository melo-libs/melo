import { z } from 'zod'
import { validateAgentApiModel } from '../../../shared/agentApi'
import {
  agentApiHeaders,
  requestAgentApi,
  validateAgentApiEndpoint,
  type AgentApiEndpoint,
  type ResolvedAgentApiEndpoint,
} from './apiTransport'

export interface AgentApiInput extends AgentApiEndpoint {
  model: string
}

export function validateAgentApi(
  input: AgentApiInput,
): ResolvedAgentApiEndpoint & { model: string } {
  const endpoint = validateAgentApiEndpoint(input)
  return { ...endpoint, model: validateAgentApiModel(endpoint.apiService, input.model) }
}

export async function testAgentApi(input: AgentApiInput): Promise<void> {
  const config = validateAgentApi(input)
  const claude = config.provider === 'claude'
  const text = await requestAgentApi(`${config.baseUrl}${claude ? '/v1/messages' : '/responses'}`, {
    method: 'POST',
    headers: { ...agentApiHeaders(config), 'Content-Type': 'application/json' },
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
  try {
    const schema = claude
      ? z.object({ type: z.literal('message'), content: z.array(z.unknown()) })
      : z.object({ output: z.array(z.unknown()), error: z.null().optional() })
    schema.parse(JSON.parse(text))
  } catch {
    throw new Error('AGENT_API_PROTOCOL_ERROR')
  }
}
