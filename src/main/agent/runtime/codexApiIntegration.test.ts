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
  input: { type?: string; output?: string; call_id?: string }[]
  tools?: { type: string; name?: string; tools?: { type: string; name: string }[] }[]
  reasoning?: { effort?: string }
}

// Opt in to the real 60-second default-deadline regression; normal adapter
// coverage stays fast. This never uses the user's account or model endpoint.
const checkToolTimeout = process.env.MELO_CODEX_TIMEOUT_CHECK === '1'

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
    const workspace = path.join(root, 'workspace')
    await mkdir(home)
    await mkdir(claudeHome)
    await mkdir(workspace)
    await writeFile(path.join(workspace, 'note.md'), '# Saved fixture')
    await writeFile(path.join(root, 'outside.txt'), 'External fixture')
    vi.stubEnv('CODEX_HOME', home)
    vi.stubEnv('CLAUDE_CONFIG_DIR', claudeHome)
    const nativeConfig =
      'model_reasoning_effort = "xhigh"\n' +
      (service === 'custom' ? 'sandbox_mode = "read-only"\napproval_policy = "on-request"\n' : '')
    await writeFile(path.join(home, 'config.toml'), nativeConfig)
    const requests: FixtureRequest[] = []
    const errors: Error[] = []
    let answer = '',
      reads = 0,
      authorizations = 0
    const readConversations: string[] = []
    const executionDirectories = new Set<string>()
    const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
    const nativeSteps = [
      {
        id: 'temporary_output',
        cmd: 'printf "Parsed attachment\\n" > "$TMPDIR/intermediate.txt"; cat "$TMPDIR/intermediate.txt"; printf "execution-directory=%s\\n" "$TMPDIR"; if test -z "$MELO_CODEX_API_KEY$CODEX_CONFIG$MELO_CODEX_LAUNCH"; then printf "secrets-hidden\\n"; fi',
        check(output: string) {
          expect(output).toContain('Parsed attachment')
          expect(output).toContain('secrets-hidden')
          const directory = /execution-directory=(.+)/.exec(output)?.[1].trim()
          expect(directory).toMatch(/\/melo-[A-Za-z0-9]{6}$/)
          executionDirectories.add(directory!)
        },
      },
      {
        id: 'workspace_analysis',
        cmd: `printf 'Analysis fixture' > ${quote(path.join(workspace, 'analysis.txt'))}; cat ${quote(path.join(workspace, 'analysis.txt'))}; pwd`,
        check(output: string) {
          expect(output).toContain('Analysis fixture')
          expect(output).toContain(workspace)
        },
      },
      {
        id: 'outside_read',
        cmd: `cat ${quote(path.join(root, 'outside.txt'))}`,
        check(output: string) {
          expect(output).toContain('External fixture')
        },
      },
    ]
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
        const result = body.input.find(
          (item) => item.type === 'function_call_output' && item.call_id === 'call_fixture',
        )
        let namespace = body.tools?.find(
          (tool) =>
            tool.type === 'namespace' &&
            tool.tools?.some((item) => item.name === 'melo_read_document'),
        )
        let name =
          namespace?.tools?.find((item) => item.name === 'melo_read_document')?.name ??
          body.tools?.find((tool) => tool.name?.includes('melo_read_document'))?.name
        expect(
          name,
          `Request ${requests.length}: model ${body.model}, tools ${body.tools?.map((tool) => tool.name ?? tool.type).join(',')}`,
        ).toBeTruthy()
        let callArguments = JSON.stringify({ path: 'note.md' })
        let callId = 'call_fixture'
        if (service === 'custom' && !result) {
          for (const step of nativeSteps) {
            const completed = body.input.find(
              (item) => item.type === 'function_call_output' && item.call_id === step.id,
            )
            if (completed) {
              step.check(String(completed.output))
              continue
            }
            const nativeTool = 'exec_command'
            namespace = body.tools?.find(
              (tool) =>
                tool.type === 'namespace' && tool.tools?.some((item) => item.name === nativeTool),
            )
            name =
              namespace?.tools?.find((tool) => tool.name === nativeTool)?.name ??
              body.tools?.find((tool) => tool.name === nativeTool)?.name
            expect(name).toBe(nativeTool)
            callArguments = JSON.stringify({
              cmd: step.cmd,
              login: false,
              max_output_tokens: 1200,
            })
            callId = step.id
            break
          }
        }
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
              call_id: callId,
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
        tools: (request) =>
          startWorkspaceTools(() => ({
            documents: {
              read: async (file) => {
                expect(file).toBe('note.md')
                reads++
                readConversations.push(request.conversation.id)
                if (checkToolTimeout && service === 'custom' && reads === 2)
                  await new Promise((resolve) => setTimeout(resolve, 65_000))
                return { content: '# Fixture note', revision: 'fixture-revision' }
              },
              edit: async () => {
                throw new Error('No edits expected')
              },
            },
          })),
      })
      await factory.prepare?.({
        id: 'prewarm',
        title: '',
        workspaceRoot: workspace,
        provider: 'codex',
        updatedAt: Date.now(),
      })
      for (let turn = 0; turn < 2; turn++) {
        runtime = await factory({
          signal: AbortSignal.timeout(checkToolTimeout ? 90_000 : 20_000),
          isActive: () => true,
          conversation: {
            id: `fixture-${turn}`,
            title: '',
            workspaceRoot: workspace,
            provider: 'codex',
            updatedAt: Date.now(),
          },
          authorize: async () => {
            authorizations++
            return false
          },
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
      expect(readConversations).toEqual(['fixture-0', 'fixture-1'])
      expect(answer).toContain('Connected.')
      expect(requests.length).toBeGreaterThanOrEqual(4)
      expect(requests.every((request) => request.model === model)).toBe(true)
      expect(requests.every((request) => request.reasoning?.effort === effort)).toBe(true)
      expect(await readFile(path.join(workspace, 'note.md'), 'utf8')).toBe('# Saved fixture')
      if (service === 'custom') expect(executionDirectories.size).toBe(1)
      expect(authorizations).toBe(0)
      await factory.close?.()
      for (const directory of executionDirectories)
        await expect(readFile(path.join(directory, 'intermediate.txt'))).rejects.toMatchObject({
          code: 'ENOENT',
        })
      expect(await readFile(path.join(home, 'config.toml'), 'utf8')).toBe(nativeConfig)
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
  checkToolTimeout ? 100_000 : 30_000,
)
