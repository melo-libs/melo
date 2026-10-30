import { createServer, type Server } from 'node:http'
import { afterEach, expect, it } from 'vitest'
import { testAgentApi } from './apiConnection'
import { claudeApiConfiguration } from './claudeAccess'

let server: Server | undefined
afterEach(async () => {
  server?.closeAllConnections()
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()))
})
async function endpoint(status: number, body: unknown) {
  server = createServer((_request, response) => {
    response.writeHead(status, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify(body))
  })
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No endpoint')
  return `http://127.0.0.1:${address.port}`
}

it('uses the documented DeepSeek endpoint and bearer authentication', () => {
  const config = claudeApiConfiguration({
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: 'fixture-key',
    model: 'deepseek-flash',
  })
  expect({ baseUrl: config.baseUrl, headers: config.headers }).toEqual({
    baseUrl: 'https://api.deepseek.com/anthropic',
    headers: { Authorization: 'Bearer fixture-key' },
  })
  expect(() =>
    claudeApiConfiguration({
      baseUrl: 'https://api.deepseek.com/anthropic',
      apiKey: 'fixture-key',
      model: 'deepseek',
    }),
  ).toThrow('AGENT_API_MODEL_INVALID')
})
it('requires a real Anthropic response before reporting a successful connection', async () => {
  const baseUrl = await endpoint(200, { type: 'message', content: [{ type: 'text', text: 'OK' }] })
  await expect(
    testAgentApi({ provider: 'claude', baseUrl, model: 'fixture', apiKey: 'fixture-key' }),
  ).resolves.toBeUndefined()
})
it.each([
  [401, 'AGENT_API_AUTH_FAILED'],
  [402, 'AGENT_API_PAYMENT_REQUIRED'],
  [429, 'AGENT_API_RATE_LIMITED'],
  [503, 'AGENT_API_UNAVAILABLE'],
  [400, 'AGENT_API_MODEL_INVALID'],
] as const)('classifies HTTP %s without exposing a provider payload', async (status, code) => {
  const baseUrl = await endpoint(status, {
    error: { message: 'Invalid model; echoed secret fixture-key' },
  })
  await expect(
    testAgentApi({ provider: 'claude', baseUrl, model: 'fixture', apiKey: 'fixture-key' }),
  ).rejects.toThrow(code)
})
it('does not accept a successful response from an incompatible endpoint', async () => {
  const baseUrl = await endpoint(200, {
    choices: [{ message: { content: 'Chat completions are not Anthropic messages' } }],
  })
  await expect(
    testAgentApi({ provider: 'claude', baseUrl, model: 'fixture', apiKey: 'fixture-key' }),
  ).rejects.toThrow('AGENT_API_PROTOCOL_ERROR')
})
