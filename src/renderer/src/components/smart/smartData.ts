import type { SmartKind } from '@shared/fileKinds'
import type { SmartRule, SmartVocab } from '@shared/types/smart'
import i18n from '../../i18n'

/** Display label for an identity string (rule keys/ops/values, sorts,
 *  bucket names). The VALUE stays English everywhere — it's persisted
 *  in views.json and compared by identity — only the rendering
 *  translates. Unknown values (user tags, folder names) pass through. */
export const smartLabel = (value: string): string => {
  const key = `smartVals.${value}`
  return i18n.exists(key) ? i18n.t(key) : value
}

/* ============================================================
   Smart Folders — rule vocabulary, time buckets, and glyphs.
   Values for Tag / Folder / Source come from the live index
   (SmartVocab); Kind and date presets are fixed. Status and
   Starred were dropped from the design's vocabulary: nothing
   writes those fields yet.
   ============================================================ */

export type Rule = SmartRule

/* ---------------- kind meta ---------------- */
export const KIND: Record<SmartKind, { ico: string; label: string }> = {
  clip: { ico: 'globe', label: 'Web clipping' },
  pdf: { ico: 'pdf', label: 'PDF' },
  note: { ico: 'doc', label: 'Note' },
  image: { ico: 'image', label: 'Image' },
  audio: { ico: 'audio', label: 'Audio' },
  video: { ico: 'video', label: 'Video' },
  code: { ico: 'code', label: 'Code' },
  other: { ico: 'doc', label: 'File' },
}

const KIND_VALUES = ['Web clipping', 'PDF', 'Note', 'Image', 'Audio', 'Video', 'Code']
const DATE_VALUES = ['Today', '3 days', 'This week', 'This month', '3 months', 'This year']

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
export const RULE_KEY_LIST = Object.keys(RULE_META) as SmartRule['key'][]

/** Whether a rule value is free text (text input) vs. a fixed list (dropdown). */
export const isTextRule = (key: SmartRule['key'], op: string): boolean =>
  key === 'Title' ||
  ((key === 'Created' || key === 'Modified') && (op === 'before' || op === 'after'))

/** The value options a rule key offers, given the live vocabulary. */
export function ruleValues(key: SmartRule['key'], vocab: SmartVocab): string[] {
  switch (key) {
    case 'Kind':
      return KIND_VALUES
    case 'Created':
    case 'Modified':
      return DATE_VALUES
    case 'Folder':
      return [...vocab.folders, 'Workspace', 'Anywhere']
    case 'Tag':
      return vocab.tags
    case 'Title':
      return []
    case 'Source':
      return vocab.sources
  }
}

export const newRule = (key: SmartRule['key'], vocab: SmartVocab): Rule => {
  const op = RULE_META[key].ops[0]
  if (key === 'Title') return { key, op, val: '' }
  return { key, op, val: op === 'is empty' ? '' : (ruleValues(key, vocab)[0] ?? '') }
}

/* ---------------- date bucketing ----------------
   Timeline-style group labels (Apple Notes convention): recent items
   get relative buckets, the current year breaks down by month, and
   older years collapse to the year. Labels are emitted in the order
   the (already time-sorted) results arrive, so no fixed order list. */
export function bucketOf(days: number): string {
  if (days <= 0) return smartLabel('Today')
  if (days === 1) return smartLabel('Yesterday')
  if (days <= 7) return smartLabel('Earlier this week')
  const d = new Date()
  d.setDate(d.getDate() - days)
  const now = new Date()
  if (d.getFullYear() === now.getFullYear()) {
    if (d.getMonth() === now.getMonth()) return smartLabel('Earlier this month')
    return d.toLocaleDateString(i18n.language, { month: 'long' })
  }
  return String(d.getFullYear())
}

/* ---------------- curated glyph palette (icon picker) ----------------
   Loosely grouped: time, marks, tags, content kinds, places, themes. */
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
