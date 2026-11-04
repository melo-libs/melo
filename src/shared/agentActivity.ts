import { z } from 'zod'

export const agentToolActivitySchema = z.object({
  kind: z.enum([
    'read',
    'edit',
    'delete',
    'move',
    'search',
    'execute',
    'think',
    'fetch',
    'switch_mode',
    'other',
  ]),
  target: z.string().optional(),
})

export type AgentToolActivity = z.infer<typeof agentToolActivitySchema>
