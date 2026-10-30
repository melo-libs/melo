import { mkdtemp, mkdir, writeFile, access, rm, realpath } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import os from 'node:os'
import { expect, it, vi } from 'vitest'
import { createRuntimeFactory } from './runtime'
import { RuntimeEnvironment } from './runtimeEnvironment'
import { startWorkspaceTools } from '../mcp/workspaceTools'
import type { AgentRuntime } from '../agentTypes'

// Real adapter + native Codex, but no account, external endpoint or model turn.
it.skipIf(process.env.MELO_CODEX_POLICY_CHECK !== '1')(
  'keeps inherited MCP servers disabled when the adapter adds Melo tools',
  async () => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'melo-codex-policy-')))
    const home = path.join(root, 'codex-home')
    const marker = path.join(root, 'foreign-started')
    const endpoint = createServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ object: 'list', data: [{ id: 'fixture', object: 'model' }] }))
    })
    let factory: ReturnType<typeof createRuntimeFactory> | undefined
    let runtime: AgentRuntime | undefined
    try {
      await mkdir(home)
      const environment = new RuntimeEnvironment(path.join(root, 'runtime'))
      const node = await environment.requireNode()
      const script = `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'started');setInterval(()=>{},1000)`
      await writeFile(
        path.join(home, 'config.toml'),
        `[mcp_servers.foreign]\ncommand=${JSON.stringify(node)}\nargs=["-e",${JSON.stringify(script)}]\n`,
      )
      vi.stubEnv('CODEX_HOME', home)
      await new Promise<void>((resolve) => endpoint.listen(0, '127.0.0.1', resolve))
      const address = endpoint.address()
      if (!address || typeof address === 'string') throw new Error('No fixture endpoint')
      factory = createRuntimeFactory({
        environment,
        codexLauncher: path.resolve('resources/agent/codex-launch.cjs'),
        configuration: () => ({
          provider: 'codex',
          access: 'api',
          baseUrl: `http://127.0.0.1:${address.port}/v1`,
          model: 'fixture',
          hasApiKey: true,
        }),
        apiKey: () => 'fixture-key',
        tools: () =>
          startWorkspaceTools(() => ({
            documents: {
              read: async () => ({ content: '', revision: 'fixture' }),
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
          id: 'policy',
          title: '',
          provider: 'codex',
          workspaceRoot: root,
          updatedAt: Date.now(),
        },
        authorize: async () => false,
        onEvent: () => {},
      })
      await new Promise((resolve) => setTimeout(resolve, 300))
      await expect(access(marker)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await runtime?.close()
      await factory?.close?.()
      endpoint.closeAllConnections()
      await new Promise<void>((resolve) => endpoint.close(() => resolve()))
      vi.unstubAllEnvs()
      await rm(root, { recursive: true, force: true })
    }
  },
  30000,
)
