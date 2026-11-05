import type {
  SmartRule,
  SmartViewDef,
  SmartVocab,
  SmartSort,
  SmartHit,
} from '../../../shared/types/smart'
import type {
  AgentAttachment,
  AgentDocumentSnapshot,
  AgentHistorySearch,
} from '../../../shared/types/agent'
import type { OrganizationRequest } from '../../../shared/agentCapabilities'

// Protocol-independent capabilities supplied by the workspace service.
export interface AgentDocumentAccess {
  read(filePath: string): Promise<AgentDocumentSnapshot>
  edit(
    filePath: string,
    expectedRevision: string,
    content: string,
    tagsOnly?: boolean,
  ): Promise<AgentDocumentSnapshot>
}

export interface WorkspaceDocumentAccess extends AgentDocumentAccess {
  fileOperation<T>(filePath: string, operation: () => Promise<T>): Promise<T>
}

export interface WorkspaceOperations {
  /** Paths at this boundary are workspace-relative; the service resolves them. */
  documents: AgentDocumentAccess
  actions?: {
    resolveAttachment?(id: string): Promise<AgentAttachment>
    organize?(organization: OrganizationRequest): Promise<{ files: { id: string; path: string }[] }>
    list(directory: string): Promise<{ path: string; directory: boolean }[]>
    search(
      query: string,
    ): Promise<{ hits: { path: string; title: string; snippet: string }[]; total: number }>
    searchHistory?(query: string): Promise<AgentHistorySearch>
    create(filePath: string, content: string, directory: boolean): Promise<{ path: string }>
    move(source: string, destination: string): Promise<{ path: string }>
    trash(filePath: string): Promise<{ trashed: string }>
    readTags?(
      filePath?: string,
    ): Promise<{ vocabulary: { tag: string; count: number }[]; tags?: string[]; revision?: string }>
    updateTags?(
      filePath: string,
      revision: string,
      add: string[],
      remove: string[],
    ): Promise<{ tags: string[]; revision: string }>
    readSmartFolders?(): Promise<{
      views: SmartViewDef[]
      revision: string
      vocabulary: SmartVocab
    }>
    previewSmartFolder?(
      rules: SmartRule[],
      sort?: SmartSort,
    ): Promise<{ items: SmartHit[]; total: number }>
    saveSmartFolder?(
      view: SmartViewDef,
      revision: string,
    ): Promise<{ view: SmartViewDef; revision: string }>
    readMemory(): Promise<{ user: AgentDocumentSnapshot; workspace: AgentDocumentSnapshot }>
    writeMemory(
      scope: 'user' | 'workspace',
      expectedRevision: string,
      content: string,
    ): Promise<{ revision: string }>
  }
}
