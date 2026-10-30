import { request } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startWorkspaceTools } from './workspaceTools'
import { AGENT_TOOLS } from '../../../shared/agentCapabilities'
import type { AgentDocumentAccess } from '../workspace/workspaceTypes'

let tools: Awaited<ReturnType<typeof startWorkspaceTools>>
let client: Client
let documents: AgentDocumentAccess

beforeEach(async () => {
  documents = {
    read: vi.fn(async () => ({ content: '# Unsaved editor content', revision: 'r1' })),
    edit: vi.fn(async (_filePath, expectedRevision, content) => {
      if (expectedRevision !== 'r1') throw new Error('Document changed; read again')
      return { content, revision: 'r2' }
    }),
  }
  tools = await startWorkspaceTools(() => ({
    documents,
    actions: {
      list: async () => [],
      search: async () => ({ hits: [], total: 0 }),
      searchHistory: async () => ({ messages: [], total: 0 }),
      create: async (path) => ({ path }),
      move: async (_source, path) => ({ path }),
      trash: async (trashed) => ({ trashed }),
      readMemory: async () => ({
        user: { content: '', revision: 'r1' },
        workspace: { content: '', revision: 'r1' },
      }),
      writeMemory: async () => ({ revision: 'r2' }),
    },
  }))
  client = new Client({ name: 'melo-tool-test', version: '1' })
  await client.connect(
    new StreamableHTTPClientTransport(new URL(tools.config.url), {
      requestInit: {
        headers: Object.fromEntries(tools.config.headers.map((h) => [h.name, h.value])),
      },
    }),
  )
})

afterEach(async () => {
  await client.close()
  await tools.close()
})

describe('workspace MCP boundary', () => {
  it('advertises the exact owned tool set with consistent read-only annotations', async () => {
    const { tools } = await client.listTools()
    expect(
      tools.map((tool) => ({ name: tool.name, readOnly: tool.annotations?.readOnlyHint })),
    ).toEqual(Object.values(AGENT_TOOLS))
  })

  it('uses the document service for current content and versioned edits', async () => {
    const read = await client.callTool({
      name: 'melo_read_document',
      arguments: { path: 'note.md' },
    })
    expect(read.content).toEqual([
      {
        type: 'text',
        text: JSON.stringify({ content: '# Unsaved editor content', revision: 'r1' }),
      },
    ])
    expect(documents.read).toHaveBeenCalledWith('note.md')
    const edited = await client.callTool({
      name: 'melo_edit_document',
      arguments: { path: 'note.md', expectedRevision: 'r1', content: '# Revised' },
    })
    expect(edited.isError).not.toBe(true)
    expect(documents.edit).toHaveBeenCalledWith('note.md', 'r1', '# Revised')
    const stale = await client.callTool({
      name: 'melo_edit_document',
      arguments: { path: 'note.md', expectedRevision: 'old', content: '# Overwrite' },
    })
    expect(stale.isError).toBe(true)
  })

  it('validates tool arguments and propagates unavailable-editor errors', async () => {
    const malformed = await client.callTool({
      name: 'melo_edit_document',
      arguments: { path: 'note.md', content: 'missing revision' },
    })
    expect(malformed.isError).toBe(true)
    expect(documents.edit).not.toHaveBeenCalled()
    vi.mocked(documents.read).mockRejectedValueOnce(new Error('Editor is unavailable'))
    const result = await client.callTool({
      name: 'melo_read_document',
      arguments: { path: 'note.md' },
    })
    expect(result.isError).toBe(true)
  })

  it('waits for an active edit before releasing the workspace', async () => {
    let release: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.mocked(documents.edit).mockImplementationOnce(async () => {
      await held
      return { content: 'done', revision: 'r2' }
    })
    const edit = client
      .callTool({
        name: 'melo_edit_document',
        arguments: { path: 'note.md', expectedRevision: 'r1', content: 'done' },
      })
      .catch(() => {})
    await vi.waitFor(() => expect(documents.edit).toHaveBeenCalled())
    let closed = false
    const closing = tools.close().then(() => {
      closed = true
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(closed).toBe(false)
    release!()
    await closing
    await edit
    expect(closed).toBe(true)
  })

  it('rejects unauthenticated, browser-origin, and rebinding requests', async () => {
    const url = tools.config.url
    expect((await fetch(url, { method: 'POST', body: '{}' })).status).toBe(401)
    const headers = Object.fromEntries(tools.config.headers.map((h) => [h.name, h.value]))
    expect(
      (
        await fetch(url, {
          method: 'POST',
          headers: { ...headers, Origin: 'https://example.com' },
          body: '{}',
        })
      ).status,
    ).toBe(403)
    expect(
      await new Promise<number | undefined>((resolve, reject) => {
        const req = request(
          url,
          { method: 'POST', headers: { ...headers, Host: 'attacker.example' } },
          (res) => {
            res.resume()
            resolve(res.statusCode)
          },
        )
        req.on('error', reject)
        req.end('{}')
      }),
    ).toBe(403)
  })
})
