import type { AgentOperation } from '../../shared/agentCapabilities'
import type { AgentChange, AgentPlanEntry, AgentConversation } from '../../shared/types/agent'

export type RuntimeEvent =
  | { type: 'text'; text: string }
  | { type: 'change'; change: AgentChange }
  | { type: 'plan'; entries: AgentPlanEntry[] }
  | { type: 'tool'; id: string; title: string; status: 'pending' | 'completed' | 'failed' }

export interface AgentRuntime {
  prompt(text: string): Promise<void>
  close(): Promise<void>
}

export interface RuntimeRequest {
  signal: AbortSignal
  isActive(): boolean
  conversation: AgentConversation
  onEvent(event: RuntimeEvent): void
  authorize(operation: AgentOperation, signal?: AbortSignal): Promise<boolean>
}

export interface RuntimeFactory {
  (request: RuntimeRequest): Promise<AgentRuntime>
  prepare?(conversation: AgentConversation): Promise<void>
  close?(): Promise<void>
}
