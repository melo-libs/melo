import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { AcpConnection } from './acpConnection'
import { CLAUDE_ACP_VERSION, claudeSession } from './claudeSession'
import { startWorkspaceTools } from '../mcp/workspaceTools'
import {
  CLAUDE_AUTH_STATUS_METHOD,
  claudeAccessState,
  claudeApiConfiguration,
  type ClaudeAccessState,
} from './claudeAccess'

// Explicit opt-in: a normal test run must neither download a harness nor use a
// developer's model account. The live turn also requires a separate opt-in.
describe.skipIf(!process.env.MELO_CLAUDE_ACP_ENTRY || !process.env.MELO_AGENT_NODE)(
  'installed Claude ACP adapter',
  () => {
    it('initializes the adapter and optionally runs a real MCP edit', async () => {
      const home = process.env.CLAUDE_CONFIG_DIR
      if (!home || !(await realpath(home)).startsWith((await realpath(os.tmpdir())) + path.sep))
        throw new Error(
          'Use a dedicated temporary CLAUDE_CONFIG_DIR for adapter tests; never copy developer credentials.',
        )
      const entry = path.resolve(process.env.MELO_CLAUDE_ACP_ENTRY!)
      const metadata = JSON.parse(
        await readFile(path.resolve(path.dirname(entry), '../package.json'), 'utf8'),
      )
      expect(metadata.name).toBe('@agentclientprotocol/claude-agent-acp')
      expect(metadata.version).toBe(CLAUDE_ACP_VERSION)
      const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'melo-claude-check-')))
      const document = path.join(root, 'note.md')
      const diskContent = '# Saved on disk'
      await writeFile(document, diskContent)
      let content = '# Unsaved editor content'
      let revision = 1
      let reads = 0
      let edits = 0
      const tools = await startWorkspaceTools(() => ({
        documents: {
          async read() {
            reads++
            return { content, revision: String(revision) }
          },
          async edit(_filePath, expectedRevision, nextContent) {
            if (expectedRevision !== String(revision)) throw new Error('Document changed')
            content = nextContent
            edits++
            revision++
            return { content, revision: String(revision) }
          },
        },
      }))
      let connection: AcpConnection | undefined
      let access: ClaudeAccessState = { status: 'not-reported' }
      try {
        const provider = process.env.MELO_AGENT_API_BASE_URL
          ? claudeApiConfiguration({
              baseUrl: process.env.MELO_AGENT_API_BASE_URL,
              apiKey: process.env.MELO_AGENT_API_KEY,
              model: process.env.MELO_AGENT_MODEL,
            })
          : undefined
        const env: NodeJS.ProcessEnv = { ...process.env, ...provider?.environment }
        delete env.ELECTRON_RUN_AS_NODE
        connection = await AcpConnection.start({
          launch: { command: process.env.MELO_AGENT_NODE!, args: [entry], env },
          workspaceRoot: root,
          onUpdate: () => {},
          onExtensionNotification(method, params) {
            if (method === CLAUDE_AUTH_STATUS_METHOD) access = claudeAccessState(params) ?? access
          },
          // This isolated test exposes only the two fixture document tools.
          onPermission: async (request) => {
            const option = request.options.find((option) => option.kind === 'allow_once')
            return option
              ? { outcome: { outcome: 'selected', optionId: option.optionId } }
              : { outcome: { outcome: 'cancelled' } }
          },
        })
        expect(connection.initialization.agentCapabilities?.mcpCapabilities?.http).toBe(true)
        if (process.env.MELO_AGENT_LIVE !== '1') {
          expect(access.status).not.toBe('not-reported')
          return
        }
        await connection.createSession(claudeSession([tools.config], provider?.model))
        await connection.prompt([
          {
            type: 'text',
            text: 'Use melo_read_document to read note.md, then use melo_edit_document with its revision to append the exact line "ACP verified". Preserve all existing content. Do not use any other tool.',
          },
        ])
        expect(reads).toBeGreaterThan(0)
        expect(edits).toBe(1)
        expect(content).toContain('# Unsaved editor content')
        expect(content).toContain('ACP verified')
        expect(await readFile(document, 'utf8')).toBe(diskContent)
      } finally {
        await connection?.close()
        await tools.close()
        await rm(root, { recursive: true, force: true })
      }
    }, 180_000)
  },
)
