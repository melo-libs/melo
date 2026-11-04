import { z } from 'zod'

export const attachmentReceiptSchema = z.object({
  files: z
    .array(
      z.object({
        id: z.string().uuid(),
        name: z.string(),
        path: z.string().optional(),
        status: z.enum(['pending', 'stored', 'failed', 'cancelled']),
      }),
    )
    .max(20),
})
export type AttachmentReceipt = z.infer<typeof attachmentReceiptSchema>
