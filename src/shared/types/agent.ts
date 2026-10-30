import type { AgentOperation } from '../agentCapabilities'
import type { AgentApiCatalog, AgentApiServiceId } from '../agentApi'

export type AgentProvider = 'claude' | 'codex'
export type AgentStatus = 'idle' | 'connecting' | 'running' | 'awaiting-permission' | 'error'

export interface AgentContext {
  filePath?: string
  selection?: string
}

export interface AgentPlanEntry {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}

export interface AgentChange {
  id: string
  kind: 'create-folder' | 'create-note' | 'edit' | 'move' | 'trash'
  path: string
  source?: string
  undone: boolean
}

export interface AgentMessage {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  context?: AgentContext
  change?: AgentChange
  plan?: AgentPlanEntry[]
  approval?: AgentApproval
  toolStatus?: 'pending' | 'completed' | 'failed'
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
}

export interface AgentSetup {
  configuration: AgentConfiguration
  connectionProfiles?: Record<AgentProvider, AgentConnectionProfile>
  nativeControls?: AgentModelControl[]
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
  | { action: 'install' }
  | { action: 'login'; provider: AgentProvider }
  | {
      action: 'api-models'
      provider: AgentProvider
      apiService?: AgentApiServiceId
      baseUrl: string
      apiKey?: string
      refresh?: boolean
    }
  | {
      action: 'test-connection'
      provider: AgentProvider
      baseUrl: string
      model: string
      apiKey?: string
      apiService?: AgentApiServiceId
    }
  | {
      action: 'configure'
      provider: AgentProvider
      access: 'native' | 'api'
      baseUrl: string
      model: string
      apiKey?: string
      apiService?: AgentApiServiceId
    }
  | { action: 'current'; workspaceRoot: string }
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

export interface AgentCommandResult {
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
  | { id: string; action: 'edit'; path: string; expectedRevision: string; content: string }
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
