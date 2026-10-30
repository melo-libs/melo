import { randomUUID, createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import type { WebContents } from 'electron'
import type { AgentDocumentRequest, AgentDocumentReply } from '../../../shared/types/agent'
import { IpcChannels } from '../../../shared/types/ipc'
import type { WorkspaceDocumentAccess } from './workspaceTypes'

type Request = AgentDocumentRequest extends infer R
  ? R extends { id: string }
    ? Omit<R, 'id'>
    : never
  : never

/** Routes open-document operations to their existing renderer owner. A timeout
 * is a failure, never permission to fall back to overwriting disk content. */
export class DocumentAccess implements WorkspaceDocumentAccess {
  private readonly pending = new Map<
    string,
    { resolve(reply: AgentDocumentReply): void; reject(error: Error): void }
  >()
  constructor(private readonly contents: () => WebContents | null) {}

  reply(sender: WebContents, reply: AgentDocumentReply): void {
    if (sender !== this.contents()) return
    const pending = this.pending.get(reply.id)
    if (!pending) return
    this.pending.delete(reply.id)
    if (reply.error) pending.reject(new Error(reply.error))
    else pending.resolve(reply)
  }

  private async request(request: Request): Promise<AgentDocumentReply> {
    const contents = this.contents()
    if (!contents || contents.isDestroyed()) throw new Error('Editor is unavailable')
    const id = randomUUID()
    const response = new Promise<AgentDocumentReply>((resolve, reject) =>
      this.pending.set(id, { resolve, reject }),
    )
    const timeout = setTimeout(() => {
      if (!contents.isDestroyed())
        contents.send(IpcChannels.OnAgentDocumentRequest, {
          id,
          action: 'cancel',
          path: request.path,
        })
      this.pending
        .get(id)
        ?.reject(new Error('Editor response timed out. Check the document before retrying.'))
      this.pending.delete(id)
    }, 15_000)
    try {
      contents.send(IpcChannels.OnAgentDocumentRequest, { id, ...request })
      return await response
    } finally {
      clearTimeout(timeout)
      this.pending.delete(id)
    }
  }

  async read(filePath: string) {
    const reply = await this.request({ action: 'read', path: filePath })
    if (reply.handled) {
      if (!reply.snapshot) throw new Error('Editor did not provide a document snapshot')
      return reply.snapshot
    }
    if ((await stat(filePath)).size > 1024 * 1024)
      throw new Error('Document exceeds the 1 MB limit')
    const content = await readFile(filePath, 'utf8')
    return { content, revision: createHash('sha256').update(content).digest('hex') }
  }

  async edit(filePath: string, expectedRevision: string, content: string) {
    const reply = await this.request({ action: 'edit', path: filePath, expectedRevision, content })
    if (!reply.handled || !reply.snapshot) throw new Error('Editor did not apply the change')
    return reply.snapshot
  }

  async fileOperation<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
    await this.request({ action: 'prepare-file-operation', path: filePath })
    try {
      const result = await operation()
      await this.request({ action: 'finish-file-operation', path: filePath })
      return result
    } catch (error) {
      await this.request({ action: 'abort-file-operation', path: filePath })
      throw error
    }
  }
}
