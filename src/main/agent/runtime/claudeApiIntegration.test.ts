import { createServer } from 'node:http'
import { mkdir, mkdtemp, realpath, rm, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { expect, it, vi } from 'vitest'
import { RuntimeEnvironment } from './runtimeEnvironment'
import { createRuntimeFactory } from './runtime'
import { startWorkspaceTools } from '../mcp/workspaceTools'
import type { AgentRuntime } from '../agentTypes'

it.skipIf(process.env.MELO_CLAUDE_API_CHECK !== '1').each([
  { service: 'deepseek', model: 'deepseek-flash', header: 'Authorization' },
  { service: 'zhipu', model: 'glm-5.3', header: 'x-api-key' },
  { service: 'zhipu-coding', model: 'glm-5.3', header: 'x-api-key' },
  { service: 'kimi', model: 'kimi-k3.1-pro', header: 'Authorization' },
  { service: 'kimi-coding', model: 'k3.1-pro', header: 'x-api-key' },
  { service: 'anthropic', model: 'fixture-claude', header: 'x-api-key' },
  { service: 'custom', model: 'fixture-model', header: 'x-api-key' },
] as const)(
  'uses the $service model and $header credential in a Claude ACP turn without login',
  async ({ service, model, header }) => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'melo-claude-gateway-')))
    const home = path.join(root, 'claude-home')
    await mkdir(home)
    const nativeSettings = JSON.stringify({ permissions: { defaultMode: 'plan' } })
    await writeFile(path.join(home, 'settings.json'), nativeSettings)
    await writeFile(path.join(root, 'attachment.txt'), 'Attachment fixture')
    vi.stubEnv('CLAUDE_CONFIG_DIR', home)
    const models: string[] = []
    let answer = ''
    const authenticated: boolean[] = []
    const inspectionResults: { is_error?: boolean; content?: unknown }[] = []
    const permissionRequests: string[] = []
    const server = createServer(async (request, response) => {
      if (!new URL(request.url!, 'http://localhost').pathname.endsWith('/messages')) {
        response.writeHead(404)
        response.end()
        return
      }
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const body = JSON.parse(Buffer.concat(chunks).toString()) as {
        model: string
        messages: {
          content:
            | string
            | { type: string; tool_use_id?: string; is_error?: boolean; content?: unknown }[]
        }[]
      }
      const inspection = body.messages
        .flatMap((message) => (typeof message.content === 'string' ? [] : message.content))
        .find((item) => item.type === 'tool_result' && item.tool_use_id === 'scope_inspection')
      if (inspection) inspectionResults.push(inspection)
      models.push(body.model)
      authenticated.push(
        header === 'Authorization'
          ? request.headers.authorization === 'Bearer fixture-key'
          : request.headers['x-api-key'] === 'fixture-key',
      )
      if (!authenticated.at(-1)) {
        response.writeHead(401, { 'Content-Type': 'application/json' })
        response.end(
          JSON.stringify({
            type: 'error',
            error: { type: 'authentication_error', message: 'Invalid fixture credential' },
          }),
        )
        return
      }
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      const event = (type: string, data: object) =>
        response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`)
      event('message_start', {
        message: {
          id: `msg_${models.length}`,
          type: 'message',
          role: 'assistant',
          model: body.model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 0 },
        },
      })
      const inspecting = service === 'custom' && !inspection
      if (inspecting) {
        const quoted = `'${root.replaceAll("'", "'\\''")}'`
        event('content_block_start', {
          index: 0,
          content_block: {
            type: 'tool_use',
            id: 'scope_inspection',
            name: 'Bash',
            input: {},
          },
        })
        event('content_block_delta', {
          index: 0,
          delta: {
            type: 'input_json_delta',
            partial_json: JSON.stringify({
              command: `(cd ${quoted}; cat attachment.txt; printf 'Parsed fixture' > "$TMPDIR/parsed.txt"; cat "$TMPDIR/parsed.txt")`,
              description: 'Inspect an attachment and create temporary analysis output',
            }),
          },
        })
      } else {
        event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
        event('content_block_delta', {
          index: 0,
          delta: { type: 'text_delta', text: 'Connected.' },
        })
      }
      event('content_block_stop', { index: 0 })
      event('message_delta', {
        delta: { stop_reason: inspecting ? 'tool_use' : 'end_turn', stop_sequence: null },
        usage: { output_tokens: 2 },
      })
      event('message_stop', {})
      response.end()
    })
    let factory: ReturnType<typeof createRuntimeFactory> | undefined
    let runtime: AgentRuntime | undefined
    try {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('No fixture endpoint')
      factory = createRuntimeFactory({
        environment: new RuntimeEnvironment(path.join(root, 'runtime')),
        codexLauncher: path.resolve('resources/agent/codex-launch.cjs'),
        configuration: () => ({
          provider: 'claude',
          access: 'api',
          apiService: service,
          baseUrl: `http://127.0.0.1:${address.port}/anthropic`,
          model,
          hasApiKey: true,
        }),
        apiKey: () => 'fixture-key',
        tools: () =>
          startWorkspaceTools(() => ({
            documents: {
              read: async () => {
                throw new Error('No document reads expected')
              },
              edit: async () => {
                throw new Error('No edits expected')
              },
            },
          })),
      })
      runtime = await factory({
        signal: AbortSignal.timeout(20000),
        isActive: () => true,
        conversation: {
          id: 'fixture',
          title: '',
          workspaceRoot: root,
          provider: 'claude',
          updatedAt: Date.now(),
        },
        authorize: async (operation) => {
          permissionRequests.push(JSON.stringify(operation))
          return false
        },
        onEvent: (event) => {
          if (event.type === 'text') answer += event.text
        },
      })
      await runtime.prompt('Reply Connected. Do not call tools.')
      expect(answer).toContain('Connected.')
      expect(models.length).toBeGreaterThan(0)
      expect(models.every((value) => value === model)).toBe(true)
      expect(authenticated.every(Boolean)).toBe(true)
      expect(await readFile(path.join(home, 'settings.json'), 'utf8')).toBe(nativeSettings)
      if (service === 'custom') {
        expect(permissionRequests).toEqual([])
        expect(inspectionResults).toHaveLength(1)
        expect(
          inspectionResults[0].is_error,
          JSON.stringify(inspectionResults[0].content),
        ).not.toBe(true)
        expect(JSON.stringify(inspectionResults[0].content)).toContain('Attachment fixture')
        expect(JSON.stringify(inspectionResults[0].content)).toContain('Parsed fixture')
      }
    } finally {
      await runtime?.close()
      await factory?.close?.()
      vi.unstubAllEnvs()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await rm(root, { recursive: true, force: true })
    }
  },
  30000,
)
