import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { smartViewSchema, storedSmartViewsSchema, MAX_SMART_VIEWS } from '../../shared/smartRules'
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

const storedRuleSchema = storedSmartViewsSchema.element.shape.rules.element
const compatibleStoredViewsSchema = z.array(
  storedSmartViewsSchema.element.extend({
    rules: z
      .array(
        storedRuleSchema.extend({
          key: z.preprocess(
            (key) => (key === 'Captured' ? 'Created' : key),
            storedRuleSchema.shape.key,
          ),
        }),
      )
      .transform((rules) =>
        rules.filter((rule) => !(rule.key === 'Created' && rule.val === 'Anytime')),
      ),
  }),
)

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
  assertConfigPath(workspaceRoot)
  const file = viewsPath(workspaceRoot)
  fs.ensureDirSync(path.dirname(file))
  const tmp = path.join(path.dirname(file), `.views-${randomUUID()}.tmp`)
  const descriptor = fs.openSync(tmp, 'wx', 0o600)
  try {
    fs.writeFileSync(descriptor, JSON.stringify(views, null, 2))
    fs.fsyncSync(descriptor)
    fs.renameSync(tmp, file)
  } finally {
    fs.closeSync(descriptor)
    fs.rmSync(tmp, { force: true })
  }
}

const listeners = new Set<(workspaceRoot: string) => void>()
export function onSmartViewsChanged(listener: (workspaceRoot: string) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function assertConfigPath(root: string): void {
  const directory = path.join(root, '.melo')
  for (const file of [directory, viewsPath(root)]) {
    try {
      if (fs.lstatSync(file).isSymbolicLink())
        throw new Error('Smart Folder configuration must not be a symbolic link')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
}

export function readSmartViewsSnapshot(root: string): { views: SmartViewDef[]; revision: string } {
  assertConfigPath(root)
  if (!fs.existsSync(viewsPath(root))) getSmartViews(root)
  if (fs.statSync(viewsPath(root)).size > 1024 * 1024)
    throw new Error('Smart Folder configuration is too large')
  const raw = fs.readFileSync(viewsPath(root), 'utf8')
  return {
    views: compatibleStoredViewsSchema.parse(JSON.parse(raw)),
    revision: createHash('sha256').update(raw).digest('hex'),
  }
}

export function updateSmartViews(
  root: string,
  views: SmartViewDef[],
  expectedRevision: string,
  restore = false,
) {
  const next = storedSmartViewsSchema.parse(views)
  const current = readSmartViewsSnapshot(root)
  if (current.revision !== expectedRevision) throw new Error('SMART_VIEWS_CONFLICT')
  if (next.length > MAX_SMART_VIEWS || new Set(next.map((view) => view.id)).size !== next.length)
    throw new Error('Too many or duplicate Smart Folders')
  for (const view of next) {
    const previous = current.views.find((item) => item.id === view.id)
    if (JSON.stringify(previous) === JSON.stringify(view)) continue
    if (!restore)
      smartViewSchema.parse({
        ...view,
        rules: view.rules.filter((rule) => rule.val.trim() || rule.op === 'is empty'),
      })
    if (
      !restore &&
      (!previous || previous.name.toLowerCase() !== view.name.toLowerCase()) &&
      next.some(
        (other) => other.id !== view.id && other.name.toLowerCase() === view.name.toLowerCase(),
      )
    )
      throw new Error('A Smart Folder with this name already exists')
  }
  saveSmartViews(root, next)
  const snapshot = readSmartViewsSnapshot(root)
  for (const listener of listeners) listener(root)
  return snapshot
}
