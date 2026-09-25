import type { SmartKind } from '../fileKinds'

/* Smart folder contracts, shared by renderer UI, views.json and the
   index query layer. Rule vocabulary follows the design's builder:
   a flat AND of { key, op, val } rows. */

export type SmartRuleKey = 'Kind' | 'Created' | 'Modified' | 'Folder' | 'Tag' | 'Title' | 'Source'
export const SMART_SORTS = ['Newest first', 'Oldest first', 'Name A–Z', 'Source'] as const
export type SmartSort = (typeof SMART_SORTS)[number]
export const MAX_SMART_RULES = 20

export const SMART_PRESETS = ['recent', 'webClips', 'pdfs'] as const
export type SmartPreset = (typeof SMART_PRESETS)[number]

export interface SmartRule {
  key: SmartRuleKey
  op: string
  val: string
}

export interface SmartViewDef {
  id: string
  name: string
  glyph: string
  rules: SmartRule[]
  /** Built-in identity is separate from its editable, persisted fallback name. */
  preset?: SmartPreset
  sort?: SmartSort
}

export interface SmartHit {
  path: string
  title: string
  kind: SmartKind
  /** Hostname of the capture source, when the note has one. */
  sourceHost: string | null
  /** Full normalized source URL — "open original" in the inspector. */
  sourceUrl: string | null
  /** Top-level folder name; 'Workspace' for root-level files. */
  folderTop: string
  tags: string[]
  /** Days since captured/modified — drives time buckets in the view. */
  days: number
  /** Exact capture/creation time (ms) — sorting needs finer than days,
   *  or same-day items never reorder. */
  createdAt: number
  words: number
  excerpt: string
}

/** Values the builder can offer for each key, from the live index. */
export interface SmartVocab {
  tags: string[]
  folders: string[]
  sources: string[]
}
