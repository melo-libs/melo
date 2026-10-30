import { execFile } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'

it.each([false, true])(
  'keeps MCP isolation and API routing in owned-process argv (API: %s)',
  async (api) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'melo-codex-launch-'))
    try {
      const fixture = path.join(root, 'cli.cjs')
      await writeFile(fixture, 'process.stdout.write(JSON.stringify(process.argv.slice(2)))')
      const servers = ['existing', 'with.dots', 'quote"and space'].map((name) => ({
        name,
        transport: 'stdio',
      }))
      const result = await promisify(execFile)(
        process.execPath,
        [path.resolve('resources/agent/codex-launch.cjs'), 'app-server'],
        {
          env: {
            ...process.env,
            MELO_CODEX_LAUNCH: JSON.stringify({
              command: process.execPath,
              args: [fixture],
              servers,
              node: process.execPath,
              ...(api
                ? {
                    api: {
                      id: 'melo-api',
                      baseUrl: 'https://fixture.example/v1',
                      envKey: 'MELO_CODEX_API_KEY',
                    },
                  }
                : {}),
            }),
          },
        },
      )
      const args = JSON.parse(result.stdout) as string[]
      expect(args).toContain('hooks')
      expect(args).toContain('memories')
      const configuration = args.find((arg) => arg.startsWith('mcp_servers='))!
      for (const { name } of servers)
        expect(configuration).toContain(`${JSON.stringify(name)}={enabled=false,command=`)
      expect(args.at(-1)).toBe('app-server')
      const provider = args.find((arg) => arg.startsWith('model_provider='))
      expect(provider).toBe(api ? 'model_provider="melo-api"' : undefined)
      const routing = args.find((arg) => arg.startsWith('model_providers='))
      if (api) {
        expect(routing).toContain('"melo-api"={')
        expect(routing).toContain('base_url="https://fixture.example/v1"')
        expect(routing).toContain('requires_openai_auth=false')
        expect(routing).not.toContain('Bearer')
      } else expect(routing).toBeUndefined()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  },
)
