import path from 'path'
import fs from 'fs-extra'
import {
  SMART_PRESETS,
  SMART_SORTS,
  MAX_SMART_RULES,
  type SmartPreset,
  type SmartRule,
  type SmartSort,
  type SmartViewDef,
} from '../../shared/types/smart'

/**
 * Smart view definitions live with the workspace: `.melo/views.json`.
 * Files are the truth for notes; this file is the truth for views —
 * unlike the index it is NOT rebuildable, so writes go through a temp
 * file + rename to survive a crash mid-write.
 */

const SEED_VIEWS: SmartViewDef[] = [
  {
    id: 'recent',
    name: 'Recent',
    glyph: 'clock',
    rules: [],
    preset: 'recent',
    sort: 'Newest first',
  },
  {
    id: 'web-clips',
    name: 'Web Clips',
    glyph: 'globe',
    rules: [{ key: 'Kind', op: 'is', val: 'Web clipping' }],
    preset: 'webClips',
    sort: 'Newest first',
  },
  {
    id: 'pdfs',
    name: 'PDFs',
    glyph: 'book',
    rules: [{ key: 'Kind', op: 'is', val: 'PDF' }],
    preset: 'pdfs',
    sort: 'Newest first',
  },
]

function viewsPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.melo', 'views.json')
}

const RULE_KEYS = new Set(['Kind', 'Created', 'Modified', 'Folder', 'Tag', 'Title', 'Source'])
const PRESETS = new Set<SmartPreset>(SMART_PRESETS)
const SORTS = new Set<SmartSort>(SMART_SORTS)

/** views.json is a file-read boundary — keep only structurally sound
 *  definitions and known rule keys; drop the rest instead of letting
 *  malformed rows reach the matcher. */
function sanitizeViews(parsed: unknown): SmartViewDef[] | null {
  if (!Array.isArray(parsed)) return null
  const views: SmartViewDef[] = []
  for (const v of parsed) {
    if (!v || typeof v !== 'object') continue
    const { id, name, glyph, rules, preset, sort } = v as Record<string, unknown>
    if (typeof id !== 'string' || typeof name !== 'string' || typeof glyph !== 'string') continue
    if (!Array.isArray(rules)) continue
    const clean = (rules as SmartRule[])
      .filter(
        (r) =>
          !!r && typeof r === 'object' && typeof r.op === 'string' && typeof r.val === 'string',
      )
      .map((r) => {
        if (r.key === ('Captured' as string)) return { ...r, key: 'Created' as const }
        return r
      })
      .filter((r) => RULE_KEYS.has(r.key))
      .filter((r) => !(r.key === 'Created' && r.val === 'Anytime'))
    views.push({
      id,
      name,
      glyph,
      rules: clean,
      ...(typeof preset === 'string' && PRESETS.has(preset as SmartPreset)
        ? { preset: preset as SmartPreset }
        : {}),
      ...(typeof sort === 'string' && SORTS.has(sort as SmartSort)
        ? { sort: sort as SmartSort }
        : {}),
    })
  }
  return views
}

export function getSmartViews(workspaceRoot: string): SmartViewDef[] {
  const file = viewsPath(workspaceRoot)
  if (fs.existsSync(file)) {
    try {
      const views = sanitizeViews(JSON.parse(fs.readFileSync(file, 'utf-8')))
      if (views) return views
    } catch {
      /* corrupt — preserved below */
    }
    // Unreadable definitions are user data — keep them recoverable
    // instead of silently overwriting with seeds.
    try {
      fs.moveSync(file, file + '.corrupt', { overwrite: true })
    } catch {
      return SEED_VIEWS
    }
  }
  saveSmartViews(workspaceRoot, SEED_VIEWS)
  return SEED_VIEWS
}

export function saveSmartViews(workspaceRoot: string, views: SmartViewDef[]): void {
  if (views.some((view) => view.rules.length > MAX_SMART_RULES)) {
    throw new Error(`Smart Folders support at most ${MAX_SMART_RULES} rules`)
  }
  const file = viewsPath(workspaceRoot)
  fs.ensureDirSync(path.dirname(file))
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(views, null, 2))
  fs.renameSync(tmp, file)
}
