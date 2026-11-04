import { AGENT_TOOLS, organizationProposalSchema } from '../../../shared/agentCapabilities'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { McpServer as AcpMcpServer } from '@agentclientprotocol/sdk'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import {
  JSONRPCMessageSchema,
  CancelledNotificationSchema,
  type RequestId,
} from '@modelcontextprotocol/sdk/types.js'

import type { WorkspaceOperations } from '../workspace/workspaceTypes'

const MAX_REQUEST_BYTES = 2 * 1024 * 1024
const DOCUMENT_PATH = z.string().min(1).max(4096)

export async function startWorkspaceTools(
  operations: (signal: AbortSignal) => WorkspaceOperations,
) {
  const token = randomBytes(32).toString('hex')
  let host = ''
  let closed = false
  let closing: Promise<void> | undefined
  const pending = new Set<Promise<void>>()
  const active = new Map<RequestId, AbortController>()

  const createTools = (signal: AbortSignal) => {
    const options = operations(signal)
    const mcp = new McpServer({ name: 'melo', version: '0.1.0' })
    mcp.registerTool(
      AGENT_TOOLS.readDocument.name,
      {
        description:
          'Read the latest Melo document content and its edit revision, including unsaved edits.',
        inputSchema: { path: DOCUMENT_PATH },
        annotations: { readOnlyHint: AGENT_TOOLS.readDocument.readOnly },
      },
      async ({ path: relativePath }) => {
        if (closed) throw new Error('Workspace tools are closed')
        const snapshot = await options.documents.read(relativePath)
        return { content: [{ type: 'text', text: JSON.stringify(snapshot) }] }
      },
    )
    mcp.registerTool(
      AGENT_TOOLS.editDocument.name,
      {
        description:
          'Replace a Melo document using the revision returned by melo_read_document. A stale revision is rejected; read again before retrying.',
        inputSchema: {
          path: DOCUMENT_PATH,
          expectedRevision: z.string().min(1).max(256),
          content: z.string().max(1024 * 1024),
        },
        annotations: { readOnlyHint: AGENT_TOOLS.editDocument.readOnly, destructiveHint: true },
      },
      async ({ path: relativePath, expectedRevision, content }) => {
        if (closed) throw new Error('Workspace tools are closed')
        const snapshot = await options.documents.edit(relativePath, expectedRevision, content)
        return { content: [{ type: 'text', text: JSON.stringify(snapshot) }] }
      },
    )
    const actions = options.actions
    if (actions) {
      if (actions.resolveAttachment)
        mcp.registerTool(
          AGENT_TOOLS.resolveAttachment.name,
          {
            description:
              'Resolve an imported attachment by stable Melo ID to its current workspace-relative path, original name, and size. Use when a historical path may have changed after filing or undo. This returns metadata only; read and parse the saved file with your native tools. Use melo_read_document for Markdown including unsaved edits. Drafts, removed files, and paths outside the workspace are unavailable.',
            inputSchema: { id: z.string().uuid() },
            annotations: { readOnlyHint: true },
          },
          async ({ id }) => {
            if (closed) throw new Error('Workspace tools are closed')
            const attachment = await actions.resolveAttachment!(id)
            return {
              content: [{ type: 'text' as const, text: JSON.stringify(attachment) }],
            }
          },
        )
      const result = async (work: () => Promise<unknown>) => {
        if (closed) throw new Error('Workspace tools are closed')
        return { content: [{ type: 'text' as const, text: JSON.stringify(await work()) }] }
      }
      if (actions.organize)
        mcp.registerTool(
          AGENT_TOOLS.organize.name,
          {
            description:
              'After reading the files and workspace, propose ONE editable filing plan. Include each imported attachment ID, reading (read, user-described, or unread), and a workspace-relative destination preserving its extension. Preserve an already informative original filename; propose a concise rename only when it improves identification or follows a user-requested convention. Do not automatically append dates, authors or other metadata to the filename: report them in facts. For readable files, detail is one brief identifying fact that adds useful information beyond the filename, or empty; never a paragraph or repeated file type. Optional facts contains up to four verified, short label/value/source items: prioritize a meaningful document date and an explicitly identified author, then useful basic information such as project, parties, version or period. Label dates precisely (e.g. signed, published, created or modified); use source=metadata to distinguish document-property times, and never substitute filesystem timestamps for document dates. Attribute document-property authors and dates to source=metadata, actual document statements to content, and user-provided facts to user. Do not guess missing values or show unknown placeholders. Keep human-facing labels and values in the user language, and avoid repeating the filename, detail or other facts. For unread files, detail explains the actual unread reason and destination is null to keep them in Inbox; metadata facts do not prove content was read. Read can come from Melo or native Harness tools; never claim a thumbnail or filename proves content understanding. Optionally propose text to append to a relevant existing Markdown note after reading it. Nothing moves until the user approves; users may edit destinations. Returns the actual final locations.',
            inputSchema: organizationProposalSchema.shape,
            annotations: { readOnlyHint: false, destructiveHint: true },
          },
          (proposal) => result(() => actions.organize!(proposal)),
        )
      mcp.registerTool(
        AGENT_TOOLS.listFiles.name,
        {
          description:
            'List files of every type in a workspace directory. Paths are workspace-relative.',
          inputSchema: { directory: z.string().max(4096).default('') },
          annotations: { readOnlyHint: AGENT_TOOLS.listFiles.readOnly },
        },
        ({ directory }) => result(() => actions.list(directory)),
      )
      mcp.registerTool(
        AGENT_TOOLS.search.name,
        {
          description:
            'Search Melo titles and Markdown text using the workspace index. Use file listing for other file types.',
          inputSchema: { query: z.string().min(1).max(1000) },
          annotations: { readOnlyHint: AGENT_TOOLS.search.readOnly },
        },
        ({ query }) => result(() => actions.search(query)),
      )
      if (actions.searchHistory)
        mcp.registerTool(
          AGENT_TOOLS.searchHistory.name,
          {
            description:
              'Find previous Melo messages by keyword. Use an empty query to see recent exchanges. Returns saved message IDs, source notes, dates and excerpts. Deleted messages are excluded. This searches conversation history, not workspace file content.',
            inputSchema: { query: z.string().max(1000).default('') },
            annotations: { readOnlyHint: AGENT_TOOLS.searchHistory.readOnly },
          },
          ({ query }) => result(() => actions.searchHistory!(query)),
        )
      mcp.registerTool(
        AGENT_TOOLS.create.name,
        {
          description:
            'Create a Markdown note or directory after user approval. Choose the appropriate existing directory using file listing. Never overwrites existing files.',
          inputSchema: {
            path: DOCUMENT_PATH,
            content: z
              .string()
              .max(1024 * 1024)
              .default(''),
            directory: z.boolean().default(false),
          },
          annotations: { readOnlyHint: AGENT_TOOLS.create.readOnly, destructiveHint: false },
        },
        ({ path, content, directory }) => result(() => actions.create(path, content, directory)),
      )
      mcp.registerTool(
        AGENT_TOOLS.move.name,
        {
          description:
            'Move or rename a file after user approval. Destination includes the new filename. No overwrite. Do not move directories in this version.',
          inputSchema: { source: DOCUMENT_PATH, destination: DOCUMENT_PATH },
          annotations: { readOnlyHint: AGENT_TOOLS.move.readOnly, destructiveHint: true },
        },
        ({ source, destination }) => result(() => actions.move(source, destination)),
      )
      mcp.registerTool(
        AGENT_TOOLS.trash.name,
        {
          description:
            'Move a file to the system Trash after user approval. Never permanently deletes a file.',
          inputSchema: { path: DOCUMENT_PATH },
          annotations: { readOnlyHint: AGENT_TOOLS.trash.readOnly, destructiveHint: true },
        },
        ({ path }) => result(() => actions.trash(path)),
      )
      mcp.registerTool(
        AGENT_TOOLS.readMemory.name,
        {
          description:
            'Read the single Melo user/workspace memory shared by every harness, with revision tokens.',
          inputSchema: {},
          annotations: { readOnlyHint: AGENT_TOOLS.readMemory.readOnly },
        },
        () => result(() => actions.readMemory()),
      )
      mcp.registerTool(
        AGENT_TOOLS.writeMemory.name,
        {
          description:
            'Update Melo memory only when the user explicitly asks to remember or forget something. Explain the proposed memory; user approval is required. Preserve existing preferences and supply the revision from melo_read_memory.',
          inputSchema: {
            scope: z.enum(['user', 'workspace']),
            expectedRevision: z.string().length(64),
            content: z.string().max(16000),
          },
          annotations: { readOnlyHint: AGENT_TOOLS.writeMemory.readOnly, destructiveHint: true },
        },
        ({ scope, expectedRevision, content }) =>
          result(() => actions.writeMemory(scope, expectedRevision, content)),
      )
    }
    return mcp
  }

  const handle = async (request: IncomingMessage, response: ServerResponse) => {
    if (closed) return respond(response, 503)
    if (request.url !== '/mcp') return respond(response, 404)
    if (request.headers.host !== host || request.headers.origin !== undefined) {
      return respond(response, 403)
    }
    const expected = Buffer.from(`Bearer ${token}`)
    const actual = Buffer.from(request.headers.authorization ?? '')
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      return respond(response, 401)
    }
    if (request.method !== 'POST') return respond(response, 405)

    let size = 0
    const chunks: Buffer[] = []
    for await (const chunk of request) {
      const buffer = Buffer.from(chunk)
      size += buffer.length
      if (size > MAX_REQUEST_BYTES) return respond(response, 413)
      chunks.push(buffer)
    }
    let body: unknown
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      return respond(response, 400)
    }
    const message = JSONRPCMessageSchema.safeParse(body)
    if (!message.success) return respond(response, 400)
    const cancelled = CancelledNotificationSchema.safeParse(message.data)
    if (cancelled.success) {
      if (cancelled.data.params.requestId !== undefined)
        active.get(cancelled.data.params.requestId)?.abort()
      return respond(response, 202)
    }
    const id = 'method' in message.data && 'id' in message.data ? message.data.id : undefined
    if (id !== undefined && active.has(id)) return respond(response, 409)
    const controller = new AbortController()
    if (id !== undefined) active.set(id, controller)
    const disconnected = () => {
      if (!response.writableFinished) controller.abort()
    }
    response.once('close', disconnected)
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    })
    const mcp = createTools(controller.signal)
    try {
      await mcp.connect(transport)
      await transport.handleRequest(request, response, body)
    } finally {
      response.off('close', disconnected)
      if (id !== undefined) active.delete(id)
      await mcp.close()
    }
  }

  const server = createServer((request, response) => {
    const operation = handle(request, response)
      .catch(() => {
        if (!response.headersSent && !response.destroyed) respond(response, 500)
        else response.destroy()
      })
      .finally(() => pending.delete(operation))
    pending.add(operation)
  })
  server.requestTimeout = 30_000
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (address === null || typeof address === 'string')
    throw new Error('MCP server has no TCP address')
  host = `127.0.0.1:${address.port}`

  return {
    config: {
      type: 'http',
      name: `melo_${randomBytes(12).toString('hex')}`,
      url: `http://${host}/mcp`,
      headers: [{ name: 'Authorization', value: `Bearer ${token}` }],
    } satisfies AcpMcpServer,
    close() {
      if (closing) return closing
      closed = true
      for (const controller of active.values()) controller.abort()
      server.closeAllConnections()
      closing = (async () => {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        )
        await Promise.all(pending)
      })()
      return closing
    },
  }
}

function respond(response: ServerResponse, status: number): void {
  response.writeHead(status, { 'Content-Type': 'text/plain' })
  response.end(status === 500 ? 'Melo tool request failed' : String(status))
}
