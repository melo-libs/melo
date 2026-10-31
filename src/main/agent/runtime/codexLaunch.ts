import { execFile } from 'node:child_process'
import { access } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { promisify } from 'node:util'
import { z } from 'zod'
import { adapterEntry } from './runtimeEnvironment'
import type { AgentApiServiceId } from '../../../shared/agentApi'

const execute = promisify(execFile)
export const CODEX_API_PROVIDER = 'melo-api'
export const CODEX_API_KEY_ENV = 'MELO_CODEX_API_KEY'
type DisabledMcpServer =
  | { enabled: false; command: string; args: string[] }
  | { enabled: false; url: string }
const MCP_SERVERS = z.array(
  z.object({
    name: z.string().min(1).max(256),
    transport: z.object({ type: z.enum(['stdio', 'streamable_http']) }),
  }),
)

/** Reuse the account, not unrelated MCP servers and executable hooks from a
 * coding workspace. Native model access remains with Codex itself. */
export async function codexLaunch(
  node: string,
  root: string,
  launcher: string,
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
  api?: { baseUrl: string; apiService: AgentApiServiceId },
): Promise<Record<string, DisabledMcpServer>> {
  const candidates = [
    path.join(path.dirname(node), 'codex'),
    ...String(env.PATH ?? '')
      .split(path.delimiter)
      .filter(Boolean)
      .map((directory) => path.join(directory, 'codex')),
  ]
  let executable: string | undefined
  for (const candidate of candidates) {
    try {
      await access(candidate)
      executable = candidate
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  env.PATH = `${path.dirname(node)}${path.delimiter}${env.PATH ?? ''}`
  const command = executable ?? node
  const args = executable
    ? []
    : [createRequire(adapterEntry('codex')).resolve('@openai/codex/bin/codex.js')]
  let servers: { name: string; transport: 'stdio' | 'streamable_http' }[]
  try {
    const listed = await execute(
      command,
      [
        ...args,
        '-c',
        `projects={${JSON.stringify(root)}={trust_level="trusted"}}`,
        'mcp',
        'list',
        '--json',
      ],
      { cwd: root, env, signal, timeout: 10000, maxBuffer: 1024 * 1024 },
    )
    servers = MCP_SERVERS.parse(JSON.parse(listed.stdout)).map((server) => ({
      name: server.name,
      transport: server.transport.type,
    }))
  } catch {
    signal.throwIfAborted()
    // execFile errors retain stdout, which may include credentials in MCP
    // configuration. Do not propagate that payload into logs or conversation data.
    throw new Error('Could not inspect Codex tool configuration. Check your Codex setup.', {
      cause: 'Codex configuration lookup failed',
    })
  }
  env.MELO_CODEX_LAUNCH = JSON.stringify({
    command,
    args,
    servers,
    node,
    ...(api
      ? {
          api: {
            id: CODEX_API_PROVIDER,
            baseUrl: api.baseUrl,
            envKey: CODEX_API_KEY_ENV,
            // Supply provider metadata without installing into the user's CLI home.
            ...(api.apiService === 'deepseek'
              ? { modelCatalog: path.join(path.dirname(launcher), 'deepseek-models.json') }
              : {}),
          },
        }
      : {}),
  })
  env.CODEX_PATH = launcher
  return Object.fromEntries(
    servers.map((server) => [
      server.name,
      server.transport === 'stdio'
        ? { enabled: false, command: node, args: ['-e', 'process.exit(1)'] }
        : { enabled: false, url: 'http://127.0.0.1:9' },
    ]),
  )
}
