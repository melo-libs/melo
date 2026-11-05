import { z } from 'zod'
import { MAX_SMART_RULES, SMART_SORTS, SMART_PRESETS, type SmartRule } from './types/smart'

export const KIND_VALUES = ['Web clipping', 'PDF', 'Note', 'Image', 'Audio', 'Video', 'Code']
export const DATE_VALUES = ['Today', '3 days', 'This week', 'This month', '3 months', 'This year']

/* ---------------- rule vocabulary ---------------- */
export const RULE_META: Record<SmartRule['key'], { ops: string[]; ico: string }> = {
  Kind: { ops: ['is', 'is not'], ico: 'doc' },
  Created: { ops: ['in', 'before', 'after'], ico: 'calendar' },
  Modified: { ops: ['in', 'before', 'after'], ico: 'clock' },
  Folder: { ops: ['is'], ico: 'folder' },
  Tag: { ops: ['is', 'is not', 'is empty'], ico: 'tag' },
  Title: { ops: ['contains'], ico: 'doc' },
  Source: { ops: ['is'], ico: 'globe' },
}
export const SMART_GLYPHS = [
  'clock',
  'calendar',
  'moon',
  'bookmark',
  'star',
  'heart',
  'flag',
  'pin',
  'flame',
  'bolt',
  'spark',
  'hash',
  'tag',
  'tagOff',
  'doc',
  'book',
  'pdf',
  'image',
  'audio',
  'video',
  'code',
  'globe',
  'wave',
  'highlight',
  'pencil',
  'folder',
  'inbox',
  'archive',
  'layers',
  'briefcase',
  'home',
  'bulb',
  'target',
  'leaf',
  'coffee',
  'plane',
  'search',
  'funnel',
  'sliders',
]

export const MAX_SMART_VIEWS = 100
const ruleKeys = ['Kind', 'Created', 'Modified', 'Folder', 'Tag', 'Title', 'Source'] as const
export const smartRuleSchema = z
  .object({
    key: z.enum(ruleKeys),
    op: z.string(),
    val: z.string().max(1000),
  })
  .superRefine((rule, context) => {
    let valid = RULE_META[rule.key].ops.includes(rule.op)
    if (rule.key === 'Kind') valid &&= KIND_VALUES.includes(rule.val)
    else if (rule.key === 'Created' || rule.key === 'Modified') {
      if (rule.op === 'in') valid &&= DATE_VALUES.includes(rule.val)
      else {
        const date = new Date(rule.val + 'T00:00:00Z')
        valid &&=
          /^\d{4}-\d{2}-\d{2}$/.test(rule.val) &&
          Number.isFinite(date.getTime()) &&
          date.toISOString().startsWith(rule.val)
      }
    } else if (rule.key === 'Tag' && rule.op === 'is empty') valid &&= rule.val === ''
    else {
      valid &&= rule.val.trim().length > 0
      if (rule.key === 'Folder') valid &&= !/[\\/]/.test(rule.val)
    }
    if (!valid) context.addIssue({ code: 'custom', message: 'Unsupported Smart Folder rule' })
  })
export const smartRulesSchema = z.array(smartRuleSchema).max(MAX_SMART_RULES)
export const smartViewSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().trim().min(1).max(120),
  glyph: z
    .string()
    .refine((value) => SMART_GLYPHS.includes(value), 'Unsupported Smart Folder icon'),
  rules: smartRulesSchema,
  preset: z.enum(SMART_PRESETS).optional(),
  sort: z.enum(SMART_SORTS).optional(),
})
// Existing builder drafts may persist incomplete rules; keep them visible and editable.
export const storedSmartViewsSchema = z.array(
  smartViewSchema.extend({
    name: z.string(),
    glyph: z.string(),
    rules: z.array(z.object({ key: z.enum(ruleKeys), op: z.string(), val: z.string() })),
  }),
)
