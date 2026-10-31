import { createServer } from 'node:http'
import { mkdir, mkdtemp, realpath, rm, writeFile, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { expect, it, vi } from 'vitest'
import { RuntimeEnvironment } from './runtimeEnvironment'
import { createRuntimeFactory } from './runtime'
import { startWorkspaceTools } from '../mcp/workspaceTools'
import type { AgentRuntime } from '../agentTypes'

interface FixtureRequest {
  model: string
  input: { type?: string; output?: string }[]
  tools?: { type: string; name?: string; tools?: { type: string; name: string }[] }[]
  reasoning?: { effort?: string }
}

it.skipIf(process.env.MELO_CODEX_API_CHECK !== '1').each([
  { service: 'deepseek', model: 'deepseek-flash', effort: 'high' },
  { service: 'deepseek', model: 'deepseek-v4-pro', effort: 'high' },
  { service: 'custom', model: 'fixture-model', effort: 'medium' },
  { service: 'kimi', model: 'kimi-k3.1-pro', effort: 'high' },
  { service: 'kimi-coding', model: 'k3.1-pro', effort: 'high' },
  { service: 'zhipu', model: 'glm-5.3', effort: 'high' },
  { service: 'zhipu-coding', model: 'glm-5.3', effort: 'high' },
] as const)(
  'runs $service through Codex API and Melo MCP in two fresh sessions without native credentials',
  async ({ service, model, effort }) => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'melo-codex-api-')))
    const home = path.join(root, 'codex-home')
    const claudeHome = path.join(root, 'claude-home')
    await mkdir(home)
    await mkdir(claudeHome)
    vi.stubEnv('CODEX_HOME', home)
    vi.stubEnv('CLAUDE_CONFIG_DIR', claudeHome)
    await writeFile(path.join(home, 'config.toml'), 'model_reasoning_effort = "xhigh"\n')
    const requests: FixtureRequest[] = []
    const errors: Error[] = []
    let answer = '',
      reads = 0
    const server = createServer((request, response) => {
      void (async () => {
        expect(request.url).toBe('/v1/responses')
        expect(request.headers.authorization).toBe('Bearer fixture-key')
        const chunks: Buffer[] = []
        for await (const chunk of request) chunks.push(Buffer.from(chunk))
        const body = JSON.parse(Buffer.concat(chunks).toString()) as FixtureRequest
        requests.push(body)
        if (service === 'deepseek') {
          expect(body.tools?.some((tool) => tool.type === 'tool_search')).toBe(false)
          expect(body.tools?.some((tool) => tool.name === 'collaboration')).toBe(false)
          expect(body.tools?.some((tool) => tool.type === 'web_search')).toBe(false)
        }
        const result = body.input.find((item) => item.type === 'function_call_output')
        const namespace = body.tools?.find(
          (tool) =>
            tool.type === 'namespace' &&
            tool.tools?.some((item) => item.name === 'melo_read_document'),
        )
        const name =
          namespace?.tools?.find((item) => item.name === 'melo_read_document')?.name ??
          body.tools?.find((tool) => tool.name?.includes('melo_read_document'))?.name
        expect(
          name,
          `Request ${requests.length}: model ${body.model}, tools ${body.tools?.map((tool) => tool.name ?? tool.type).join(',')}`,
        ).toBeTruthy()
        const callArguments = JSON.stringify({ path: 'note.md' })
        const content = { type: 'output_text', text: 'Connected.', annotations: [] }
        const item = result
          ? {
              type: 'message',
              id: 'msg_fixture',
              status: 'completed',
              role: 'assistant',
              content: [content],
            }
          : {
              type: 'function_call',
              id: 'fc_fixture',
              call_id: 'call_fixture',
              name,
              ...(namespace ? { namespace: namespace.name } : {}),
              arguments: callArguments,
              status: 'completed',
            }
        const base = {
          id: `resp_${requests.length}`,
          object: 'response',
          created_at: 1,
          model: body.model,
          error: null,
          incomplete_details: null,
        }
        response.writeHead(200, { 'Content-Type': 'text/event-stream' })
        let sequence = 0
        const event = (type: string, data: object) =>
          response.write(
            `event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: sequence++, ...data })}\n\n`,
          )
        event('response.created', { response: { ...base, status: 'in_progress', output: [] } })
        event('response.output_item.added', {
          output_index: 0,
          item: {
            ...item,
            status: 'in_progress',
            ...(result ? { content: [] } : { arguments: '' }),
          },
        })
        if (result) {
          expect(JSON.stringify(result.output)).toContain('Fixture note')
          event('response.content_part.added', {
            item_id: 'msg_fixture',
            output_index: 0,
            content_index: 0,
            part: { ...content, text: '' },
          })
          event('response.output_text.delta', {
            item_id: 'msg_fixture',
            output_index: 0,
            content_index: 0,
            delta: content.text,
          })
          event('response.output_text.done', {
            item_id: 'msg_fixture',
            output_index: 0,
            content_index: 0,
            text: content.text,
          })
          event('response.content_part.done', {
            item_id: 'msg_fixture',
            output_index: 0,
            content_index: 0,
            part: content,
          })
        } else {
          event('response.function_call_arguments.delta', {
            item_id: 'fc_fixture',
            output_index: 0,
            delta: callArguments,
          })
          event('response.function_call_arguments.done', {
            item_id: 'fc_fixture',
            output_index: 0,
            arguments: callArguments,
          })
        }
        event('response.output_item.done', { output_index: 0, item })
        event('response.completed', {
          response: {
            ...base,
            status: 'completed',
            output: [item],
            usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
          },
        })
        response.end()
      })().catch((error: Error) => {
        errors.push(error)
        if (!response.headersSent) response.writeHead(400)
        response.end()
      })
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
          provider: 'codex',
          access: 'api',
          apiService: service,
          baseUrl: `http://127.0.0.1:${address.port}/v1`,
          model,
          hasApiKey: true,
        }),
        apiKey: () => 'fixture-key',
        tools: () =>
          startWorkspaceTools(() => ({
            documents: {
              read: async (file) => {
                expect(file).toBe('note.md')
                reads++
                return { content: '# Fixture note', revision: 'fixture-revision' }
              },
              edit: async () => {
                throw new Error('No edits expected')
              },
            },
          })),
      })
      for (let turn = 0; turn < 2; turn++) {
        runtime = await factory({
          signal: AbortSignal.timeout(20000),
          isActive: () => true,
          conversation: {
            id: 'fixture',
            title: '',
            workspaceRoot: root,
            provider: 'codex',
            updatedAt: Date.now(),
          },
          authorize: async () => false,
          onEvent: (event) => {
            if (event.type === 'text') answer += event.text
          },
        })
        await runtime
          .prompt('Read note.md with melo_read_document and reply Connected.')
          .catch((error) => {
            throw errors[0] ?? error
          })
        await runtime.close()
        runtime = undefined
      }
      expect(errors).toEqual([])
      expect(reads).toBe(2)
      expect(answer).toContain('Connected.')
      expect(requests.length).toBeGreaterThanOrEqual(4)
      expect(requests.every((request) => request.model === model)).toBe(true)
      expect(requests.every((request) => request.reasoning?.effort === effort)).toBe(true)
      expect(await readFile(path.join(home, 'config.toml'), 'utf8')).toBe(
        'model_reasoning_effort = "xhigh"\n',
      )
      const homeFiles = await readdir(home)
      expect(homeFiles).not.toContain('models.json')
      expect(homeFiles).not.toContain('auth.json')
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
