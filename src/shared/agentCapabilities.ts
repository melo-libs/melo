import { z } from 'zod'

// Retained to render resource grants already stored in conversation history.
export const agentNativeAccessSchema = z.object({
  scope: z.enum(['task', 'operation']),
  read: z.array(z.string()),
  write: z.array(z.string()),
  network: z.boolean(),
})
export type AgentNativeAccess = z.infer<typeof agentNativeAccessSchema>

export const AGENT_TOOLS = {
  readDocument: { name: 'melo_read_document', readOnly: true },
  resolveAttachment: { name: 'melo_resolve_attachment', readOnly: true },
  organize: { name: 'melo_organize_files', readOnly: false },
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

export const organizationFactSchema = z.object({
  label: z.string().min(1).max(24),
  value: z.string().min(1).max(100),
  source: z.enum(['content', 'metadata', 'user']),
})
export type OrganizationFact = z.infer<typeof organizationFactSchema>

export const organizationProposalSchema = z.object({
  files: z
    .array(
      z.object({
        id: z.string().uuid(),
        destination: z.string().min(1).max(4096).nullable(),
        detail: z.string().max(240),
        facts: z.array(organizationFactSchema).max(4).optional(),
        reading: z.enum(['read', 'user-described', 'unread']),
      }),
    )
    .min(1)
    .max(20),
  note: z.object({ path: z.string().min(1).max(4096), content: z.string().max(32000) }).optional(),
})
export type OrganizationProposal = z.infer<typeof organizationProposalSchema>
export const organizationEditsSchema = z.object({
  destinations: z
    .array(z.object({ id: z.string().uuid(), path: z.string().min(1).max(4096).nullable() }))
    .max(20),
  includeNote: z.boolean(),
})
export type OrganizationEdits = z.infer<typeof organizationEditsSchema>

export const agentOperationSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('organize'),
    files: z
      .array(
        z.object({
          id: z.string().uuid(),
          name: z.string(),
          size: z.number(),
          source: z.string(),
          destination: z.string().nullable(),
          detail: z.string(),
          facts: z.array(organizationFactSchema).max(4).optional(),
          readable: z.boolean(),
          described: z.boolean().optional(),
        }),
      )
      .min(1)
      .max(20),
    folders: z.array(z.string()),
    locations: z.array(z.string()),
    note: z.object({ path: z.string(), content: z.string(), revision: z.string() }).optional(),
    includeNote: z.boolean(),
  }),
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
  z.object({
    kind: z.literal('native'),
    title: z.string(),
    detail: z.string(),
    access: agentNativeAccessSchema.optional(),
  }),
])
export type AgentOperation = z.infer<typeof agentOperationSchema>

export const AGENT_OPERATIONS = {
  organize: { label: 'organizeFiles', approve: 'organize', allowRun: false },
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
    case 'organize':
      return 'Inbox'
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
