import { z } from 'zod'

export const agentChangeSchema = z.object({
  id: z.string(),
  kind: z.enum([
    'create-folder',
    'create-note',
    'import',
    'edit',
    'move',
    'trash',
    'tags',
    'smart-folder',
  ]),
  path: z.string(),
  source: z.string().optional(),
  undone: z.boolean(),
  batchId: z.string().uuid().optional(),
})
export type AgentChange = z.infer<typeof agentChangeSchema>

export const filingStateSchema = z.enum(['applying', 'completed', 'failed'])
export interface AgentFiling {
  id: string
  version: number
  state: z.infer<typeof filingStateSchema>
  fileCount: number
  createdAt: number
  changes: AgentChange[]
  unresolved: AgentChange[]
}
