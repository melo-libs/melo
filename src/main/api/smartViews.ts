import path from 'path'
import fs from 'fs-extra'
import type { SmartRule, SmartViewDef } from '../../shared/types/smart'

/**
 * Smart view definitions live with the workspace: `.melo/views.json`.
 * Files are the truth for notes; this file is the truth for views —
 * unlike the index it is NOT rebuildable, so writes go through a temp
 * file + rename to survive a crash mid-write.
 */

const SEED_VIEWS: SmartViewDef[] = [
  {
    id: 'thisweek',
    name: "This Week's Clips",
    glyph: 'clock',
    rules: [
      { key: 'Kind', op: 'is', val: 'Web clipping' },
      { key: 'Created', op: 'in', val: 'This week' },
    ],
  },
  {
    id: 'pdfs',
    name: 'PDFs to Read',
    glyph: 'book',
    rules: [{ key: 'Kind', op: 'is', val: 'PDF' }],
  },
  {
    id: 'secondbrain',
    name: '#second-brain',
    glyph: 'hash',
    rules: [{ key: 'Tag', op: 'is', val: 'second-brain' }],
  },
  {
    id: 'untagged',
    name: 'Untagged Inbox',
    glyph: 'tagOff',
    rules: [
      { key: 'Folder', op: 'is', val: 'Inbox' },
      { key: 'Tag', op: 'is empty', val: '' },
    ],
  },
]

function viewsPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.melo', 'views.json')
}

const RULE_KEYS = new Set(['Kind', 'Created', 'Modified', 'Folder', 'Tag', 'Title', 'Source'])

/** views.json is a file-read boundary — keep only structurally sound
 *  definitions and known rule keys; drop the rest instead of letting
 *  malformed rows reach the matcher. */
function sanitizeViews(parsed: unknown): SmartViewDef[] | null {
  if (!Array.isArray(parsed)) return null
  const views: SmartViewDef[] = []
  for (const v of parsed) {
    if (!v || typeof v !== 'object') continue
    const { id, name, glyph, rules } = v as Record<string, unknown>
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
    views.push({ id, name, glyph, rules: clean })
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
  const file = viewsPath(workspaceRoot)
  fs.ensureDirSync(path.dirname(file))
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(views, null, 2))
  fs.renameSync(tmp, file)
}
