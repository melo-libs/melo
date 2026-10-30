import { mkdtemp, realpath, rm, writeFile, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { RuntimeEnvironment } from './runtimeEnvironment'
import { createRuntimeFactory } from './runtime'
import { startWorkspaceTools } from '../mcp/workspaceTools'
import type { AgentRuntime } from '../agentTypes'

it.skipIf(process.env.MELO_CODEX_LIVE !== '1')(
  'uses the authorized Codex harness to read and edit through Melo MCP',
  async () => {
    const home = process.env.CODEX_HOME
    if (!home || !(await realpath(home)).startsWith((await realpath(os.tmpdir())) + path.sep))
      throw new Error(
        'Use a dedicated temporary CODEX_HOME for live tests; never copy developer credentials.',
      )
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'melo-codex-live-')))
    let content = '# Unsaved note\nA weekend in Kyoto.'
    let revision = 1
    let reads = 0
    let edits = 0
    let answer = ''
    let create: ReturnType<typeof createRuntimeFactory> | undefined
    let runtime: AgentRuntime | undefined
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      await writeFile(path.join(root, 'note.md'), '# Old disk content')
      create = createRuntimeFactory({
        environment: new RuntimeEnvironment(path.join(root, 'runtime')),
        codexLauncher: path.resolve('resources/agent/codex-launch.cjs'),
        configuration: () => ({
          provider: 'codex',
          access: 'native',
          baseUrl: '',
          model: '',
          hasApiKey: false,
        }),
        apiKey: () => undefined,
        tools: () =>
          startWorkspaceTools(() => ({
            documents: {
              read: async () => {
                reads++
                return { content, revision: String(revision) }
              },
              edit: async (_path, expected, next) => {
                if (expected !== String(revision)) throw new Error('Stale revision')
                content = next
                revision++
                edits++
                return { content, revision: String(revision) }
              },
            },
          })),
      })
      runtime = await create({
        signal: new AbortController().signal,
        isActive: () => true,
        conversation: {
          id: 'live',
          title: 'Live check',
          provider: 'codex',
          workspaceRoot: root,
          updatedAt: Date.now(),
        },
        authorize: async () => true,
        onEvent: (event) => {
          if (event.type === 'text') answer += event.text
        },
      })
      timeout = setTimeout(() => void runtime?.close(), 180_000)
      if (process.env.MELO_CODEX_SMOKE_ONLY === '1') {
        await runtime.prompt('Reply with the single word READY. Do not call tools.')
        expect(answer).toContain('READY')
        return
      }
      await runtime.prompt(
        'Use melo_read_document to read note.md, then melo_edit_document to append the exact line "Melo ACP verified" using its revision. Preserve its existing text. Do not use native file or shell tools. Then briefly confirm completion.',
      )
      expect(reads).toBeGreaterThan(0)
      expect(edits).toBe(1)
      expect(content).toContain('A weekend in Kyoto.')
      expect(content).toContain('Melo ACP verified')
      expect(answer.length).toBeGreaterThan(0)
      expect(await readFile(path.join(root, 'note.md'), 'utf8')).toBe('# Old disk content')
    } finally {
      clearTimeout(timeout)
      await runtime?.close()
      await create?.close?.()
      await rm(root, { recursive: true, force: true })
    }
  },
  210_000,
)
