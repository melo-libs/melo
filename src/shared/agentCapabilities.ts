import { z } from 'zod'

export const AGENT_TOOLS = {
  readDocument: { name: 'melo_read_document', readOnly: true },
  editDocument: { name: 'melo_edit_document', readOnly: false },
  listFiles: { name: 'melo_list_files', readOnly: true },
  search: { name: 'melo_search', readOnly: true },
  searchHistory: { name: 'melo_search_history', readOnly: true },
  create: { name: 'melo_create', readOnly: false },
  move: { name: 'melo_move', readOnly: false },
  trash: { name: 'melo_trash', readOnly: false },
  readMemory: { name: 'melo_read_memory', readOnly: true },
  writeMemory: { name: 'melo_write_memory', readOnly: false },
} as const

export type AgentToolName = (typeof AGENT_TOOLS)[keyof typeof AGENT_TOOLS]['name']
export function agentTool(name: string) {
  return Object.values(AGENT_TOOLS).find((tool) => tool.name === name)
}

export const agentOperationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('create-folder'), path: z.string() }),
  z.object({ kind: z.literal('create-note'), path: z.string(), content: z.string() }),
  z.object({ kind: z.literal('edit'), path: z.string(), diff: z.string() }),
  z.object({ kind: z.literal('move'), source: z.string(), destination: z.string() }),
  z.object({ kind: z.literal('trash'), path: z.string() }),
  z.object({
    kind: z.literal('memory'),
    scope: z.enum(['user', 'workspace']),
    content: z.string(),
  }),
  z.object({ kind: z.literal('native'), title: z.string(), detail: z.string() }),
])
export type AgentOperation = z.infer<typeof agentOperationSchema>

export const AGENT_OPERATIONS = {
  'create-folder': { label: 'createFolder', approve: 'create', allowRun: true },
  'create-note': { label: 'createNote', approve: 'create', allowRun: true },
  edit: { label: 'editDocument', approve: 'apply', allowRun: true },
  move: { label: 'moveFile', approve: 'move', allowRun: true },
  trash: { label: 'trashFile', approve: 'trash', allowRun: true },
  memory: { label: 'updateMemory', approve: 'save', allowRun: false },
  native: { label: null, approve: null, allowRun: false },
} as const

export function operationLocation(operation: AgentOperation): string {
  switch (operation.kind) {
    case 'move':
      return operation.destination
    case 'memory':
      return operation.scope
    case 'native':
      return operation.detail
    default:
      return operation.path
  }
}
