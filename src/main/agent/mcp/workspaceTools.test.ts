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
      organize: async (organization) => ({
        files: organization.files.map((file) => ({
          id: file.id,
          path: file.destination ?? 'Inbox/unread.bin',
        })),
      }),
      resolveAttachment: async (id) => ({
        id,
        name: 'image.png',
        size: 7,
        path: 'Travel/image.png',
      }),
      list: async () => [],
      search: async () => ({ hits: [], total: 0 }),
      searchHistory: async () => ({ messages: [], total: 0 }),
      create: async (path) => ({ path }),
      move: async (_source, path) => ({ path }),
      trash: async (trashed) => ({ trashed }),
      readTags: async () => ({ vocabulary: [], tags: ['work'], revision: 'r1' }),
      updateTags: async () => ({ tags: ['travel'], revision: 'r2' }),
      readSmartFolders: async () => ({
        views: [],
        revision: 'r1',
        vocabulary: { tags: [], folders: [], sources: [] },
      }),
      previewSmartFolder: async () => ({ items: [], total: 0 }),
      saveSmartFolder: async (view) => ({ view, revision: 'r2' }),
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
  it('returns only current attachment metadata and accepts only stable IDs', async () => {
    const read = await client.callTool({
      name: 'melo_resolve_attachment',
      arguments: { id: '00000000-0000-4000-8000-000000000001' },
    })
    expect(read.content).toEqual([
      {
        type: 'text',
        text: JSON.stringify({
          id: '00000000-0000-4000-8000-000000000001',
          name: 'image.png',
          size: 7,
          path: 'Travel/image.png',
        }),
      },
    ])
    const invalid = await client.callTool({
      name: 'melo_resolve_attachment',
      arguments: { id: '../external.png' },
    })
    expect(invalid.isError).toBe(true)
  })

  it('advertises the exact owned tool set with consistent read-only annotations', async () => {
    const { tools } = await client.listTools()
    expect(
      tools
        .map((tool) => ({ name: tool.name, readOnly: tool.annotations?.readOnlyHint }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    ).toEqual(Object.values(AGENT_TOOLS).sort((a, b) => a.name.localeCompare(b.name)))
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

it('validates metadata operations at the MCP boundary', async () => {
  const invalid = await client.callTool({
    name: 'melo_preview_smart_folder',
    arguments: { rules: [{ key: 'Kind', op: 'anything', val: 'PDF' }] },
  })
  expect(invalid.isError).toBe(true)
  const invalidTags = await client.callTool({
    name: 'melo_update_tags',
    arguments: { path: 'note.md', expectedRevision: 'r1', add: ['#'] },
  })
  expect(invalidTags.isError).toBe(true)
  const valid = await client.callTool({
    name: 'melo_save_smart_folder',
    arguments: {
      view: {
        id: 'travel',
        name: 'Travel',
        glyph: 'folder',
        rules: [{ key: 'Folder', op: 'is', val: 'Travel' }],
      },
      expectedRevision: 'r1',
    },
  })
  expect(valid.isError).not.toBe(true)
})
