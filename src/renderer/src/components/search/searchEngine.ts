import { IpcChannels } from '@shared/types/ipc'
import i18n from '../../i18n'
import type { FileNode } from '../sidebar/types'
import type { FileKind } from '../FileTypeIcon'

/* ============================================================
   Search engine — port of the design's corpus.jsx, re-pointed at
   real data: title fuzzy-matching runs locally over the workspace
   tree, full text and tags come from the index over IPC.
   ============================================================ */

export interface SearchFile {
  id: string // absolute path
  name: string
  kind: FileKind
  /** Folder path for display (workspace-relative, no file name). */
  path: string
  mtime?: number
}

export interface ParsedQuery {
  mode: 'all' | 'command'
  ops: { tag: string[]; path: string | null; kind: string | null; starred: boolean }
  terms: string[]
  freeText: string
  raw: string
}

export interface SnippetRanges {
  text: string
  ranges: [number, number][]
}

export type SearchItem =
  | {
      type: 'file'
      file: SearchFile
      titlePositions: number[]
      snippet: SnippetRanges | null
    }
  | {
      type: 'command'
      id: string
      title: string
      hint: string
      icon: string
      keys?: string[]
      titlePositions: number[]
    }

export interface SearchGroup {
  id: string
  label: string | null
  items: SearchItem[]
  /** Matches beyond the display cap — counted in `total`, not in `items`. */
  hidden?: number
}

/** Display cap for the title group. Bounds DOM size, not recall — the
    fuzzy match still scores every candidate; only the tail is cut. */
export const TITLE_GROUP_LIMIT = 50

export interface SearchResult {
  parsed: ParsedQuery
  total: number
  groups: SearchGroup[]
}

/* ---------------- commands (the ">" mode) ---------------- */

export interface Command {
  id: string
  title: string
  hint: string
  icon: string
  keys?: string[]
  kw: string
}

export const COMMANDS: Command[] = [
  {
    id: 'new-note',
    title: 'New note',
    icon: 'plus',
    hint: 'Create a markdown note',
    keys: ['⌘', 'N'],
    kw: 'create add',
  },
  {
    id: 'new-folder',
    title: 'New folder',
    icon: 'folder',
    hint: 'Add a folder to the workspace',
    kw: 'create add directory',
  },
  {
    id: 'theme',
    title: 'Toggle dark mode',
    icon: 'moon',
    hint: 'Switch between paper and ink',
    kw: 'theme dark light appearance',
  },
  {
    id: 'sidebar',
    title: 'Toggle sidebar',
    icon: 'panel',
    hint: 'Show or hide the file tree',
    keys: ['⌘', '\\'],
    kw: 'hide show panel',
  },
  {
    id: 'settings',
    title: 'Open settings',
    icon: 'gear',
    hint: 'Preferences and account',
    keys: ['⌘', ','],
    kw: 'preferences config options',
  },
]

/* ---------------- helpers (ported verbatim where possible) ---------------- */

/** Fuzzy subsequence scorer — command palette only. File titles go
 *  through the tiered scoreTitle below. */
export function fuzzyScore(
  query: string,
  text: string,
): { score: number; positions: number[] } | null {
  let qi = 0,
    ti = 0,
    score = 0,
    streak = 0,
    firstIdx = -1
  const positions: number[] = []
  while (qi < query.length && ti < text.length) {
    if (query[qi] === text[ti]) {
      if (firstIdx < 0) firstIdx = ti
      positions.push(ti)
      streak++
      score += 1 + streak * 1.4 // reward consecutive
      if (ti === 0 || /[\s\-—_/]/.test(text[ti - 1])) score += 3 // word boundary bonus
      qi++
    } else {
      streak = 0
    }
    ti++
  }
  if (qi < query.length) return null
  score -= firstIdx * 0.12 // earlier match = better
  score -= (text.length - query.length) * 0.015 // shorter target = tighter
  return { score, positions }
}

/* ---------------- tiered title scoring ----------------
   The fzf / VS Code Quick Open shape: hard tiers first, refinement
   within a tier second. A scattered subsequence can never outrank a
   contiguous substring, and body hits (BODY_SCORE_* zone) sit between
   the substring tiers and the fuzzy floor — a strong content match
   beats a weak title match, never a strong one. */

const TIER_EXACT = 10000
const TIER_PREFIX = 9000
const TIER_WORD_START = 8000
const TIER_SUBSTRING = 7000
const TIER_ALL_TERMS = 5000
/** BM25-ranked body hits map into [BODY_SCORE_MIN, BODY_SCORE_MAX]. */
export const BODY_SCORE_MAX = 4600
export const BODY_SCORE_STEP = 24
export const BODY_SCORE_MIN = 3400
const TIER_FUZZY = 2000
/** Bonus when the same file matches both by title and in the text. */
export const BOTH_BONUS = 150

const WORD_SEP = /[\s\-—_./()[\]#]/

const range = (from: number, len: number) => Array.from({ length: len }, (_, i) => from + i)

/** Subsequence match with affine gap penalties: contiguity dominates,
    word starts help a little, opening a gap costs much more than
    extending one. Quality is clamped so the fuzzy tier never escapes
    its band. */
function fuzzySubsequence(
  q: string,
  text: string,
): { quality: number; positions: number[] } | null {
  let qi = 0,
    ti = 0,
    streak = 0,
    quality = 0,
    inGap = false
  const positions: number[] = []
  while (qi < q.length && ti < text.length) {
    if (q[qi] === text[ti]) {
      positions.push(ti)
      streak++
      quality += 4 + streak * 6
      if (ti === 0 || WORD_SEP.test(text[ti - 1])) quality += 8
      inGap = false
      qi++
    } else if (qi > 0) {
      quality -= inGap ? 0.5 : 6
      inGap = true
      streak = 0
    }
    ti++
  }
  if (qi < q.length) return null
  quality -= positions[0] * 0.5
  quality -= (text.length - q.length) * 0.05
  return { quality, positions }
}

export function scoreTitle(
  query: string,
  name: string,
): { score: number; positions: number[] } | null {
  const q = query.toLowerCase()
  if (!q) return null
  const n = name.toLowerCase()

  if (n === q) return { score: TIER_EXACT, positions: range(0, q.length) }

  if (n.startsWith(q))
    return { score: TIER_PREFIX - (n.length - q.length) * 0.05, positions: range(0, q.length) }

  const idx = n.indexOf(q)
  if (idx !== -1) {
    const base = WORD_SEP.test(n[idx - 1]) ? TIER_WORD_START : TIER_SUBSTRING
    return {
      score: base - idx * 0.5 - (n.length - q.length) * 0.02,
      positions: range(idx, q.length),
    }
  }

  // Multi-word query: every term a substring somewhere (any order).
  const terms = q.split(/\s+/).filter(Boolean)
  if (terms.length > 1) {
    const positions = new Set<number>()
    let penalty = 0
    let ok = true
    for (const t of terms) {
      const i = n.indexOf(t)
      if (i === -1) {
        ok = false
        break
      }
      penalty += i * 0.1
      for (const p of range(i, t.length)) positions.add(p)
    }
    if (ok)
      return {
        score: TIER_ALL_TERMS - penalty - (n.length - q.length) * 0.02,
        positions: [...positions].sort((a, b) => a - b),
      }
  }

  const fz = fuzzySubsequence(q.replace(/\s+/g, ''), n)
  if (!fz) return null
  return {
    score: TIER_FUZZY + Math.min(1900, Math.max(0, fz.quality)),
    positions: fz.positions,
  }
}

export function termRanges(textLower: string, terms: string[]): [number, number][] {
  const ranges: [number, number][] = []
  terms.forEach((term) => {
    if (!term) return
    let i = 0
    while ((i = textLower.indexOf(term, i)) !== -1) {
      ranges.push([i, i + term.length])
      i += term.length
    }
  })
  ranges.sort((a, b) => a[0] - b[0])
  // Merge overlaps ("cat" + "category") — renderers slice sequentially
  // and would duplicate text on overlapping ranges.
  const merged: [number, number][] = []
  for (const r of ranges) {
    const last = merged[merged.length - 1]
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1])
    else merged.push([r[0], r[1]])
  }
  return merged
}

/** Snippet window around the first match, highlight ranges relative to it. */
export function buildSnippet(body: string, terms: string[], max = 140): SnippetRanges {
  const lower = body.toLowerCase()
  const ranges = termRanges(lower, terms)
  if (!ranges.length) {
    const s = body.slice(0, max)
    return { text: s + (body.length > max ? '…' : ''), ranges: [] }
  }
  const first = ranges[0][0]
  let start = Math.max(0, first - 40)
  while (start > 0 && !/\s/.test(body[start - 1])) start--
  const end = Math.min(body.length, start + max)
  const pre = start > 0 ? '…' : ''
  const post = end < body.length ? '…' : ''
  const slice = body.slice(start, end)
  const local = ranges
    .filter(([a, b]) => b > start && a < end)
    .map(
      ([a, b]) =>
        [Math.max(0, a - start) + pre.length, Math.min(end - start, b - start) + pre.length] as [
          number,
          number,
        ],
    )
  return { text: pre + slice + post, ranges: local }
}

/* ---------------- query parsing ---------------- */

export function parseQuery(raw: string): ParsedQuery {
  const q = raw.trim()
  let mode: ParsedQuery['mode'] = 'all'
  let rest = q
  if (q.startsWith('>')) {
    mode = 'command'
    rest = q.slice(1).trim()
  }

  const ops: ParsedQuery['ops'] = { tag: [], path: null, kind: null, starred: false }
  const terms: string[] = []
  rest.split(/\s+/).forEach((tok) => {
    if (!tok) return
    const m = tok.match(/^(tag|path|kind|in|is):(.+)$/i)
    const hash = tok.match(/^#([\w-]+)$/)
    if (m) {
      const k = m[1].toLowerCase()
      const v = m[2].toLowerCase()
      if (k === 'tag') ops.tag.push(v)
      else if (k === 'path' || k === 'in') ops.path = v
      else if (k === 'kind') ops.kind = v
      else if (k === 'is' && v === 'starred') ops.starred = true
    } else if (hash) {
      ops.tag.push(hash[1].toLowerCase())
    } else if (tok === '#' || /^(tag|kind|path|in|is):$/i.test(tok)) {
      // bare filter prefix still being typed — not a search term
    } else {
      terms.push(tok.toLowerCase())
    }
  })
  return { mode, ops, terms, freeText: terms.join(' '), raw: q }
}

/* ---------------- the search itself (async: index IPC) ---------------- */

function flattenFiles(
  tree: FileNode[],
  crumbs: string[] = [],
  out: SearchFile[] = [],
): SearchFile[] {
  for (const n of tree) {
    if (n.kind === 'folder') flattenFiles(n.children ?? [], [...crumbs, n.name], out)
    else
      out.push({ id: n.id, name: n.name, kind: n.kind, path: crumbs.join(' / '), mtime: n.mtime })
  }
  return out
}

function passesOps(f: SearchFile, ops: ParsedQuery['ops'], tagPaths: Set<string> | null): boolean {
  if (ops.kind && f.kind !== ops.kind && !(ops.kind === 'note' && f.kind === 'md')) return false
  if (ops.path && !(f.path + '/' + f.name).toLowerCase().includes(ops.path)) return false
  if (tagPaths && !tagPaths.has(f.id)) return false
  return true
}

async function pathsForTags(tags: string[]): Promise<Set<string> | null> {
  if (!tags.length) return null
  const sets: Set<string>[] = []
  for (const t of tags) {
    const res = await window.api.invoke(IpcChannels.InvokeGetFilesByTag, { tag: t })
    sets.push(new Set((res.success && res.data?.files.map((f) => f.path)) || []))
  }
  // AND across tags
  return sets.reduce((acc, s) => new Set([...acc].filter((p) => s.has(p))))
}

export const cmdTitle = (id: string): string => i18n.t(`search.commands.${id}.title`)
export const cmdHint = (id: string): string => i18n.t(`search.commands.${id}.hint`)

function commandMatches(freeText: string): SearchItem[] {
  return COMMANDS.map((c) => {
    const title = cmdTitle(c.id)
    if (!freeText) return { c, title, score: 0, positions: [] as number[] }
    // Fuzzy-match the displayed (localized) title so highlight positions
    // line up with what's rendered; English title + kw stay as aliases.
    const hay = (title + ' ' + c.title + ' ' + c.kw).toLowerCase()
    const fs =
      fuzzyScore(freeText, title.toLowerCase()) ||
      (hay.includes(freeText) ? { score: 2, positions: [] as number[] } : null)
    return fs ? { c, title, score: fs.score, positions: fs.positions } : null
  })
    .filter((x): x is { c: Command; title: string; score: number; positions: number[] } => !!x)
    .sort((a, b) => b.score - a.score)
    .map(({ c, title, positions }) => ({
      type: 'command' as const,
      id: c.id,
      title,
      hint: cmdHint(c.id),
      icon: c.icon,
      keys: c.keys,
      titlePositions: freeText ? positions : [],
    }))
}

export async function runSearch(raw: string, tree: FileNode[]): Promise<SearchResult> {
  const parsed = parseQuery(raw)
  const { mode, ops, terms, freeText } = parsed

  if (mode === 'command') {
    const items = commandMatches(freeText)
    return {
      parsed,
      total: items.length,
      groups: items.length ? [{ id: 'cmd', label: i18n.t('search.groups.commands'), items }] : [],
    }
  }

  const files = flattenFiles(tree)

  // ---- all mode ----
  const tagPaths = await pathsForTags(ops.tag)
  const candidates = files.filter((f) => passesOps(f, ops, tagPaths))
  const hasText = terms.length > 0
  const hasOpsOnly = !hasText && (ops.tag.length > 0 || !!ops.path || !!ops.kind)

  type FileHit = Extract<SearchItem, { type: 'file' }> & { score: number }
  let results: FileHit[] = []
  let hiddenBodyMatches = 0

  if (!hasText) {
    if (hasOpsOnly) {
      results = candidates
        .sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0))
        .map((f) => ({ type: 'file', file: f, score: 0, titlePositions: [], snippet: null }))
    }
  } else {
    // One ranked list: tiered title scores and BM25-ranked body hits share
    // a score space; a file matching both ways merges into a single row.
    const merged = new Map<string, FileHit>()
    for (const f of candidates) {
      const ft = scoreTitle(freeText, f.name)
      if (ft)
        merged.set(f.id, {
          type: 'file',
          file: f,
          score: ft.score,
          titlePositions: ft.positions,
          snippet: null,
        })
    }

    const res = await window.api.invoke(IpcChannels.InvokeSearchIndex, { query: freeText })
    const hits = (res.success && res.data?.hits) || []
    hiddenBodyMatches = Math.max(0, (res.success ? (res.data?.total ?? 0) : 0) - hits.length)
    const byId = new Map(candidates.map((f) => [f.id, f]))
    hits.forEach((h, i) => {
      const f = byId.get(h.path)
      if (!f) return // filtered out by tag:/kind:/path: ops
      const bodyScore = Math.max(BODY_SCORE_MIN, BODY_SCORE_MAX - i * BODY_SCORE_STEP)
      const snippet = { text: h.snippet, ranges: termRanges(h.snippet.toLowerCase(), terms) }
      const prev = merged.get(f.id)
      if (prev) {
        prev.score = Math.max(prev.score, bodyScore) + BOTH_BONUS
        prev.snippet = snippet
      } else {
        merged.set(f.id, { type: 'file', file: f, score: bodyScore, titlePositions: [], snippet })
      }
    })

    results = [...merged.values()].sort(
      (a, b) => b.score - a.score || (b.file.mtime ?? 0) - (a.file.mtime ?? 0),
    )
  }

  let resultsHidden = Math.max(0, results.length - TITLE_GROUP_LIMIT)
  if (resultsHidden) results = results.slice(0, TITLE_GROUP_LIMIT)
  resultsHidden += hiddenBodyMatches

  const groups: SearchGroup[] = []
  if (results.length)
    groups.push({
      id: 'results',
      label: hasText ? null : i18n.t('search.groups.filtered'),
      items: results,
      hidden: resultsHidden,
    })

  let cmdFallback: SearchItem[] = []
  if (hasText && !results.length) {
    cmdFallback = commandMatches(freeText).filter(
      (c) => c.type === 'command' && c.titlePositions.length > 0,
    )
    if (cmdFallback.length)
      groups.push({ id: 'cmd', label: i18n.t('search.groups.commands'), items: cmdFallback })
  }

  return {
    parsed,
    total: groups.reduce((n, g) => n + g.items.length + (g.hidden ?? 0), 0),
    groups,
  }
}
