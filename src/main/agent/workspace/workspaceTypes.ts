import type { AgentDocumentSnapshot, AgentHistorySearch } from '../../../shared/types/agent'

// Protocol-independent capabilities supplied by the workspace service.
export interface AgentDocumentAccess {
  read(filePath: string): Promise<AgentDocumentSnapshot>
  edit(filePath: string, expectedRevision: string, content: string): Promise<AgentDocumentSnapshot>
}

export interface WorkspaceDocumentAccess extends AgentDocumentAccess {
  fileOperation<T>(filePath: string, operation: () => Promise<T>): Promise<T>
}

export interface WorkspaceOperations {
  /** Paths at this boundary are workspace-relative; the service resolves them. */
  documents: AgentDocumentAccess
  actions?: {
    list(directory: string): Promise<{ path: string; directory: boolean }[]>
    search(
      query: string,
    ): Promise<{ hits: { path: string; title: string; snippet: string }[]; total: number }>
    searchHistory?(query: string): Promise<AgentHistorySearch>
    create(filePath: string, content: string, directory: boolean): Promise<{ path: string }>
    move(source: string, destination: string): Promise<{ path: string }>
    trash(filePath: string): Promise<{ trashed: string }>
    readMemory(): Promise<{ user: AgentDocumentSnapshot; workspace: AgentDocumentSnapshot }>
    writeMemory(
      scope: 'user' | 'workspace',
      expectedRevision: string,
      content: string,
    ): Promise<{ revision: string }>
  }
}
