import { smartViewSchema } from './smartRules'
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
  readTags: { name: 'melo_read_tags', readOnly: true },
  updateTags: { name: 'melo_update_tags', readOnly: false },
  readSmartFolders: { name: 'melo_read_smart_folders', readOnly: true },
  previewSmartFolder: { name: 'melo_preview_smart_folder', readOnly: true },
  saveSmartFolder: { name: 'melo_save_smart_folder', readOnly: false },
  readMemory: { name: 'melo_read_memory', readOnly: true },
  writeMemory: { name: 'melo_write_memory', readOnly: false },
} as const

export type AgentToolName = (typeof AGENT_TOOLS)[keyof typeof AGENT_TOOLS]['name']
export function agentTool(name: string) {
  return Object.values(AGENT_TOOLS).find((tool) => tool.name === name)
}

const organizationFactSchema = z.object({
  label: z.string().min(1).max(24),
  value: z.string().min(1).max(100),
  source: z.enum(['content', 'metadata', 'user']),
})

export const organizationRequestSchema = z.object({
  files: z
    .array(
      z.object({
        id: z.string().uuid(),
        destination: z.string().min(1).max(4096).nullable(),
        reading: z.enum(['read', 'user-described', 'unread']),
      }),
    )
    .min(1)
    .max(20),
})
export type OrganizationRequest = z.infer<typeof organizationRequestSchema>

// Existing conversations retain their old confirmation records for read-only history.
export const agentOperationSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('organize'),
    files: z
      .array(
        z.object({
          id: z.string().uuid(),
          name: z.string(),
          source: z.string(),
          destination: z.string().nullable(),
          detail: z.string(),
          facts: z.array(organizationFactSchema).max(4).optional(),
        }),
      )
      .min(1)
      .max(20),
  }),
  z.object({
    kind: z.literal('tags'),
    path: z.string(),
    before: z.array(z.string()),
    after: z.array(z.string()),
  }),
  z.object({ kind: z.literal('smart-folder'), path: z.string(), view: smartViewSchema }),
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
  organize: { label: 'organizeFiles', approve: null, allowRun: false },
  tags: { label: 'updateTags', approve: 'apply', allowRun: true },
  'smart-folder': { label: 'saveSmartFolder', approve: 'save', allowRun: true },
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
