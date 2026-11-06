import type { AgentOperation } from '../agentCapabilities'
import type { AgentApiCatalog, AgentApiServiceId } from '../agentApi'
import type { AttachmentReceipt } from '../agentAttachments'
import type { AgentToolActivity } from '../agentActivity'
import type { AgentChange, AgentFiling } from '../agentChanges'
export type { AgentChange, AgentFiling } from '../agentChanges'

export type AgentProvider = 'claude' | 'codex'
export type AgentStatus = 'idle' | 'connecting' | 'running' | 'awaiting-permission' | 'error'

export interface AgentAttachment {
  id: string
  name: string
  size: number
  path?: string
}

export interface AgentContext {
  /** Workspace-relative file visible when sending; null means no saved workspace file is open. */
  activeFilePath?: string | null
  /** Conversation reference or source of the quoted selection; may differ from the active tab. */
  filePath?: string
  selection?: string
  attachments?: AgentAttachment[]
}

export interface AgentPlanEntry {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}

export interface AgentMessage {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  context?: AgentContext
  change?: AgentChange
  filing?: AgentFiling
  receipt?: AttachmentReceipt
  plan?: AgentPlanEntry[]
  approval?: AgentApproval
  toolStatus?: 'pending' | 'completed' | 'failed'
  toolActivity?: AgentToolActivity
  createdAt: number
}

export interface AgentHistoryMessage extends AgentMessage {
  sequence: number
  conversationId: string
  workspaceRoot: string
}

export interface AgentHistoryPage {
  messages: AgentHistoryMessage[]
  hasOlder: boolean
  hasNewer: boolean
}

export interface AgentHistorySearch {
  messages: AgentHistoryMessage[]
  total: number
}

export interface AgentConversation {
  id: string
  title: string
  workspaceRoot: string
  provider: AgentProvider
  updatedAt: number
}

export interface AgentPermission {
  id: string
  operation: AgentOperation
}

export interface AgentApproval extends AgentPermission {
  status: 'pending' | 'allowed' | 'declined' | 'expired'
}

export interface AgentView {
  conversation: AgentConversation
  messages: AgentMessage[]
  status: AgentStatus
  allowChanges: boolean
  permission: AgentPermission | null
  error: string | null
  /** Transient successful turn identity; not restored from conversation history. */
  completedTurn?: string
}

export interface AgentNativePreferences {
  model: string
  effort?: string
  modelLabel?: string
  effortLabel?: string
}

export interface AgentModelControl {
  id: string
  category: 'model' | 'thought_level'
  value: string
  options: { value: string; label: string }[]
}

export interface AgentConfiguration {
  provider: AgentProvider
  access: 'native' | 'api'
  baseUrl: string
  model: string
  apiVerified?: boolean
  hasApiKey: boolean
  apiService?: AgentApiServiceId
  native?: AgentNativePreferences
}

export interface AgentAuthentication {
  status: 'signed-in' | 'signed-out'
  email?: string
  method?: 'chatgpt' | 'api-key'
}

export interface AgentConnectionProfile {
  access: 'native' | 'api'
  apiConfigured: boolean
  apiVerified?: boolean
}

export interface AgentComponent {
  status: 'missing' | 'downloading' | 'preparing' | 'ready' | 'paused' | 'error'
  source: 'local' | 'managed' | null
  transferred: number
  total: number
  error?: string
}
export type AgentComponents = Record<AgentProvider, AgentComponent>

export interface AgentSetup {
  configuration: AgentConfiguration
  connectionProfiles?: Record<AgentProvider, AgentConnectionProfile>
  nativeControls?: AgentModelControl[]
  components?: AgentComponents
  runtimeAvailable: boolean
  installing: boolean
}

export type AgentCommand =
  | { action: 'setup'; provider?: AgentProvider }
  | { action: 'prepare'; conversationId: string }
  | { action: 'check-sign-in'; provider: AgentProvider }
  | { action: 'select-provider'; provider: AgentProvider }
  | { action: 'native-options'; provider: AgentProvider }
  | {
      action: 'native-option'
      provider: AgentProvider
      category: 'model' | 'thought_level'
      value: string
    }
  | { action: 'install'; provider: AgentProvider }
  | { action: 'cancel-install'; provider: AgentProvider }
  | { action: 'login'; provider: AgentProvider }
  | {
      action: 'api-models'
      provider: AgentProvider
      apiService?: AgentApiServiceId
      baseUrl: string
      apiKey?: string
      refresh?: boolean
    }
  | { action: 'test-connection'; provider: AgentProvider }
  | { action: 'set-access'; provider: AgentProvider; access: 'native' | 'api' }
  | {
      action: 'configure'
      provider: AgentProvider
      access: 'api'
      baseUrl: string
      model: string
      apiKey?: string
      apiService?: AgentApiServiceId
    }
  | { action: 'current'; workspaceRoot: string }
  | { action: 'paste-attachments'; workspaceRoot: string }
  | { action: 'drop-attachments'; workspaceRoot: string; files: string[] }
  | { action: 'attachment-preview'; workspaceRoot: string; attachmentId: string }
  | { action: 'draft-attachments'; workspaceRoot: string }
  | { action: 'remove-attachment'; workspaceRoot: string; attachmentId: string }
  | { action: 'attachment'; workspaceRoot: string; attachmentId: string }
  | { action: 'history'; before?: number; after?: number; around?: string }
  | { action: 'search-history'; query: string; before?: number }
  | { action: 'delete-message'; messageId: string }
  | { action: 'clear-history' }
  | { action: 'provider'; conversationId: string; provider: AgentProvider }
  | { action: 'send'; conversationId: string; text: string; context: AgentContext }
  | { action: 'cancel'; conversationId: string }
  | {
      action: 'permission'
      conversationId: string
      permissionId: string
      allow: boolean
      conversation?: boolean
    }
  | { action: 'undo'; conversationId: string; changeIds: string[] }
  | { action: 'undo-filing'; conversationId: string; batchId: string }

export interface AgentCommandResult {
  attachmentPreview?: string
  intakeErrors?: { name: string; error: string }[]
  intakeHandled?: boolean
  intake?: { workspaceRoot: string; attachments: AgentAttachment[] }
  attachment?: AgentAttachment
  apiCatalog?: AgentApiCatalog
  authentication?: AgentAuthentication
  setup?: AgentSetup
  view?: AgentView
  history?: AgentHistoryPage
  search?: AgentHistorySearch
}

export interface AgentDocumentSnapshot {
  content: string
  revision: string
}

export type AgentDocumentRequest =
  | { id: string; action: 'cancel'; path: string }
  | { id: string; action: 'read'; path: string }
  | {
      id: string
      action: 'edit' | 'edit-tags'
      path: string
      expectedRevision: string
      content: string
    }
  | {
      id: string
      action: 'prepare-file-operation' | 'finish-file-operation' | 'abort-file-operation'
      path: string
    }

export interface AgentDocumentReply {
  id: string
  handled: boolean
  snapshot?: AgentDocumentSnapshot
  error?: string
}
