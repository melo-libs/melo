import path from 'path'
import fs from 'fs-extra'
import Database from 'better-sqlite3'
import matter from 'gray-matter'
import { normalizeUrl } from './capture/pipeline'
import { kindOfPath, type SmartKind } from '../../shared/fileKinds'
import type { SmartHit, SmartRule, SmartVocab } from '../../shared/types/smart'

/**
 * Index layer — `.melo/index.db`, the workspace's rebuildable card catalog.
 * Files are the truth, this is a cache: deleting the database and rescanning
 * must always reproduce it. Only .md content is indexed (other kinds appear
 * in the tree but carry no searchable text).
 *
 * Tokenizer is FTS5 trigram so CJK text is substring-searchable (the default
 * unicode61 tokenizer splits on spaces and misses Chinese entirely).
 */

let db: Database.Database | null = null
let root: string | null = null
// Bumped on every openIndex — an in-flight fullScan from a previous
// workspace sees the change and stops instead of writing stale rows.
let generation = 0

const MD_RE = /\.(md|markdown)$/i

/* ---------------- schema ---------------- */

// Bump when the schema changes — the index is a rebuildable cache, so
// "migration" is: drop everything and let the next scan repopulate.
const SCHEMA_VERSION = 2

function createSchema(d: Database.Database): void {
  const version = d.pragma('user_version', { simple: true }) as number
  if (version !== SCHEMA_VERSION) {
    d.exec(`
      DROP TABLE IF EXISTS files;
      DROP TABLE IF EXISTS tags;
      DROP TABLE IF EXISTS fields;
      DROP TABLE IF EXISTS links;
      DROP TABLE IF EXISTS fts;
    `)
    d.pragma(`user_version = ${SCHEMA_VERSION}`)
  }
  d.exec(`
    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY,
      path TEXT UNIQUE NOT NULL, -- workspace-relative, '/'-separated (portable)
      mtime INTEGER NOT NULL,
      btime INTEGER NOT NULL DEFAULT 0, -- file birthtime (creation time)
      size INTEGER NOT NULL,
      title TEXT NOT NULL,
      words INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS tags (
      file_id INTEGER NOT NULL,
      tag TEXT NOT NULL,
      PRIMARY KEY (file_id, tag)
    );
    CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags(tag);
    -- frontmatter custom fields; non-string values are JSON.stringify'd for
    -- now — the real serialization contract is decided with F3 field filters
    CREATE TABLE IF NOT EXISTS fields (
      file_id INTEGER NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (file_id, key)
    );
    -- target is the [[wikilink]] title string; resolving it to a file is the
    -- reader's job (F4)
    CREATE TABLE IF NOT EXISTS links (
      source_id INTEGER NOT NULL,
      target TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_links_target ON links(target);
    CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(content, tokenize='trigram');
  `)
}

/* ---------------- path mapping ----------------
   Stored paths are workspace-relative with '/' separators, so the database
   travels with the folder (copy/move the workspace, the index stays valid).
   The public API speaks absolute paths; conversion happens at the door. */

function toRel(absPath: string): string | null {
  if (!root) return null
  const rel = path.relative(root, absPath)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null
  return rel.split(path.sep).join('/')
}

function toAbs(relPath: string): string {
  return path.join(root ?? '', ...relPath.split('/'))
}

/* ---------------- lifecycle ---------------- */

export function openIndex(workspaceRoot: string): void {
  closeIndex()
  const dir = path.join(workspaceRoot, '.melo')
  fs.ensureDirSync(dir)
  db = new Database(path.join(dir, 'index.db'))
  db.pragma('journal_mode = WAL')
  // SQLite's built-in lower() folds ASCII only; queries that need
  // case-insensitive matching over arbitrary scripts use this instead.
  db.function('lower_u', { deterministic: true }, (s) => String(s ?? '').toLowerCase())
  createSchema(db)
  // Migrate: add btime column and backfill from disk stats.
  const cols = db.pragma('table_info(files)') as { name: string }[]
  if (!cols.some((c) => c.name === 'btime')) {
    db.exec('ALTER TABLE files ADD COLUMN btime INTEGER NOT NULL DEFAULT 0')
    const rows = db.prepare('SELECT id, path FROM files').all() as { id: number; path: string }[]
    const upd = db.prepare('UPDATE files SET btime = ? WHERE id = ?')
    for (const r of rows) {
      try {
        const st = fs.lstatSync(path.join(workspaceRoot, ...r.path.split('/')))
        if (st.isSymbolicLink()) continue
        upd.run(Math.floor(st.birthtimeMs), r.id)
      } catch {
        /* file gone — next scan will clean it up */
      }
    }
  }
  root = workspaceRoot
  generation += 1
}

/** Workspace the index is currently open on — IPC boundary checks. */
export function activeWorkspaceRoot(): string | null {
  return root
}

export function closeIndex(): void {
  if (db) {
    db.close()
    db = null
  }
  root = null
}

/* ---------------- markdown extraction ---------------- */

/** Strip markdown syntax down to searchable plain text. */
function plainTextOf(body: string): string {
  return (
    body
      // fenced code keeps its content, loses the fences
      .replace(/^```.*$/gm, ' ')
      // wikilinks: [[Target|alias]] → alias, [[Target]] → Target
      .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
      .replace(/\[\[([^\]]+)\]\]/g, '$1')
      // images / links: keep the label
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      // inline markers
      .replace(/[*_~`#>]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  )
}

/** CJK characters count as one word each; the rest counts by word. */
function countWords(plain: string): number {
  const cjk = plain.match(/[぀-ヿ㐀-䶿一-鿿豈-﫿]/g)?.length ?? 0
  const latin =
    plain.replace(/[぀-ヿ㐀-䶿一-鿿豈-﫿]/g, ' ').match(/[A-Za-z0-9][A-Za-z0-9'’_-]*/g)?.length ?? 0
  return cjk + latin
}

function normalizeTags(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : []
  // Tags are case-insensitive in Melo — normalize to lowercase at the door
  // so lookups (palette filters, autocomplete) compare apples to apples.
  return [
    ...new Set(list.map((t) => String(t).trim().replace(/^#/, '').toLowerCase()).filter(Boolean)),
  ]
}

function titleOf(fm: Record<string, unknown>, body: string, filePath: string): string {
  if (typeof fm.title === 'string' && fm.title.trim()) return fm.title.trim()
  const h1 = body.match(/^#\s+(.+)$/m)
  if (h1) return h1[1].trim()
  return path.basename(filePath).replace(MD_RE, '')
}

function linksOf(body: string): string[] {
  const out = new Set<string>()
  for (const m of body.matchAll(/\[\[([^\]|#]+)[^\]]*\]\]/g)) {
    const t = m[1].trim()
    if (t) out.add(t)
  }
  return [...out]
}

/* ---------------- indexing ---------------- */

export function isIndexable(filePath: string): boolean {
  return MD_RE.test(filePath)
}

/** (Re)index one file. Markdown gets the full pipeline; every other kind
 *  becomes a metadata-only files row (title/mtime/size, words 0) so smart
 *  folders can filter any file — fts/tags/links stay md-only. */
export function indexFile(filePath: string): void {
  if (!db) return
  const rel = toRel(filePath)
  if (!rel) return // outside the active workspace (stale watcher/scan)

  if (!isIndexable(filePath)) {
    let stat: fs.Stats
    try {
      stat = fs.statSync(filePath)
    } catch {
      return
    }
    const base = path.basename(filePath)
    const row = {
      path: rel,
      mtime: Math.floor(stat.mtimeMs),
      btime: Math.floor(stat.birthtimeMs),
      size: stat.size,
      title: base.replace(/\.[^.]+$/, '') || base,
      words: 0,
    }
    db.prepare(
      `INSERT INTO files (path, mtime, btime, size, title, words) VALUES (@path, @mtime, @btime, @size, @title, @words)
       ON CONFLICT(path) DO UPDATE SET mtime=@mtime, btime=@btime, size=@size, title=@title, words=@words`,
    ).run(row)
    return
  }

  let stat: fs.Stats
  let rawText: string
  try {
    stat = fs.statSync(filePath)
    rawText = fs.readFileSync(filePath, 'utf-8')
  } catch {
    return // vanished mid-flight — the unlink event will clean up
  }

  // gray-matter throws on malformed frontmatter — index body-only then.
  let fm: Record<string, unknown> = {}
  let body = rawText
  try {
    const parsed = matter(rawText)
    fm = parsed.data ?? {}
    body = parsed.content
  } catch {
    /* treat the whole file as body */
  }

  const plain = plainTextOf(body)
  const row = {
    path: rel,
    mtime: Math.floor(stat.mtimeMs),
    btime: Math.floor(stat.birthtimeMs),
    size: stat.size,
    title: titleOf(fm, body, filePath),
    words: countWords(plain),
  }

  const tx = db.transaction(() => {
    db!
      .prepare(
        `INSERT INTO files (path, mtime, btime, size, title, words) VALUES (@path, @mtime, @btime, @size, @title, @words)
         ON CONFLICT(path) DO UPDATE SET mtime=@mtime, btime=@btime, size=@size, title=@title, words=@words`,
      )
      .run(row)
    const id = (db!.prepare('SELECT id FROM files WHERE path = ?').get(rel) as { id: number }).id

    db!.prepare('DELETE FROM tags WHERE file_id = ?').run(id)
    const insTag = db!.prepare('INSERT OR IGNORE INTO tags (file_id, tag) VALUES (?, ?)')
    for (const t of normalizeTags(fm.tags)) insTag.run(id, t)

    db!.prepare('DELETE FROM fields WHERE file_id = ?').run(id)
    const insField = db!.prepare(
      'INSERT OR REPLACE INTO fields (file_id, key, value) VALUES (?, ?, ?)',
    )
    for (const [k, v] of Object.entries(fm)) {
      if (k === 'tags' || v == null) continue
      // YAML parses ISO timestamps into Date objects — store them as ISO
      // strings, not JSON (which would wrap them in quotes).
      let val = v instanceof Date ? v.toISOString() : typeof v === 'string' ? v : JSON.stringify(v)
      if (k === 'source') val = normalizeUrl(val)
      insField.run(id, k, val)
    }

    db!.prepare('DELETE FROM links WHERE source_id = ?').run(id)
    const insLink = db!.prepare('INSERT INTO links (source_id, target) VALUES (?, ?)')
    for (const t of linksOf(body)) insLink.run(id, t)

    db!.prepare('DELETE FROM fts WHERE rowid = ?').run(id)
    db!.prepare('INSERT INTO fts (rowid, content) VALUES (?, ?)').run(id, plain)
  })
  tx()
}

function removeIds(ids: number[]): void {
  if (!db || ids.length === 0) return
  const tx = db.transaction(() => {
    const del = (sql: string) => {
      const stmt = db!.prepare(sql)
      for (const id of ids) stmt.run(id)
    }
    del('DELETE FROM tags WHERE file_id = ?')
    del('DELETE FROM fields WHERE file_id = ?')
    del('DELETE FROM links WHERE source_id = ?')
    del('DELETE FROM fts WHERE rowid = ?')
    del('DELETE FROM files WHERE id = ?')
  })
  tx()
}

/** Remove a file, or (for directories) everything under the path. */
export function removeFromIndex(filePath: string): void {
  if (!db) return
  // Removing the root itself empties the whole index.
  if (root && path.resolve(filePath) === path.resolve(root)) {
    const all = db.prepare('SELECT id FROM files').all() as { id: number }[]
    removeIds(all.map((r) => r.id))
    return
  }
  const rel = toRel(filePath)
  if (!rel) return
  // Escape LIKE wildcards in the path itself (a folder named "foo_bar" must
  // not also match "fooXbar/…"); stored paths use '/' separators.
  const prefix = (rel + '/').replace(/[\\%_]/g, (c) => '\\' + c) + '%'
  const rows = db
    .prepare("SELECT id FROM files WHERE path = ? OR path LIKE ? ESCAPE '\\'")
    .all(rel, prefix) as { id: number }[]
  removeIds(rows.map((r) => r.id))
}

/** Reconcile the whole index against the disk (startup, cheap re-runs).
 *  Indexing runs in batches with event-loop yields in between, so a large
 *  workspace doesn't freeze the main process. */
export async function fullScan(): Promise<void> {
  if (!db || !root) return
  const gen = generation
  const seen = new Set<string>()
  // Async crawl — every readdir awaits, so the main process never runs the
  // whole directory tree in one synchronous burst.
  const walk = async (dir: string): Promise<void> => {
    let entries: fs.Dirent[]
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue
      const p = path.join(dir, e.name)
      if (e.isDirectory()) await walk(p)
      // Do not index symlinks, sockets or devices. In particular, following a
      // linked Markdown file could read content outside the workspace, while a
      // linked directory could make traversal escape or cycle.
      else if (e.isFile()) seen.add(p)
      else if (
        !e.isSymbolicLink() &&
        !e.isBlockDevice() &&
        !e.isCharacterDevice() &&
        !e.isFIFO() &&
        !e.isSocket()
      ) {
        // Some network and virtual filesystems return DT_UNKNOWN for ordinary
        // entries. Resolve only that uncommon case; local filesystems keep the
        // fast Dirent path above.
        try {
          const stats = await fs.promises.lstat(p)
          if (stats.isDirectory()) await walk(p)
          else if (stats.isFile()) seen.add(p)
        } catch {
          // The entry disappeared or is unreadable; the next scan reconciles it.
        }
      }
    }
  }
  await walk(root)
  if (gen !== generation) return

  const known = db.prepare('SELECT id, path, mtime, size FROM files').all() as {
    id: number
    path: string
    mtime: number
    size: number
  }[]
  const knownByRel = new Map(known.map((r) => [r.path, r]))
  const seenRel = new Set([...seen].map((p) => toRel(p)).filter(Boolean) as string[])

  // Rows are workspace-relative, so a copied/moved workspace stays valid.
  // Drop rows missing from the `seen` snapshot only after a disk re-check —
  // the watcher may have indexed a file created while the crawl was still
  // running (only delete candidates pay the existsSync).
  removeIds(
    known.filter((r) => !seenRel.has(r.path) && !fs.existsSync(toAbs(r.path))).map((r) => r.id),
  )

  // New or changed (mtime/size) → reindex, yielding every few iterations
  // (unchanged files still cost a stat, so count every pass).
  const BATCH = 20
  let n = 0
  for (const p of seen) {
    if (++n % BATCH === 0) {
      await new Promise((r) => setImmediate(r))
      if (gen !== generation) return // workspace switched mid-scan
    }
    const rel = toRel(p)
    if (!rel) continue
    const k = knownByRel.get(rel)
    if (k) {
      try {
        const st = fs.statSync(p)
        if (Math.floor(st.mtimeMs) === k.mtime && st.size === k.size) continue
      } catch {
        continue
      }
    }
    indexFile(p)
  }
}

/* ---------------- queries ---------------- */

export interface SearchHit {
  path: string
  title: string
  snippet: string
}

/** Body search only — title matching lives in the renderer, where it can
 *  run tiered scoring the index can't express. Multi-word queries AND
 *  their terms (any order, any distance); results come back ranked by
 *  BM25, best first. The trigram tokenizer needs ≥3 chars per term. */
export interface SearchIndexResult {
  hits: SearchHit[]
  /** Total matching documents — may exceed hits.length (display cap). */
  total: number
}

const EMPTY_RESULT: SearchIndexResult = { hits: [], total: 0 }

export function searchIndex(query: string, limit = 50): SearchIndexResult {
  if (!db) return EMPTY_RESULT
  const terms = query
    .trim()
    .split(/\s+/)
    .filter((t) => [...t].length >= 3)
  if (!terms.length) return EMPTY_RESULT
  const match = terms.map((t) => '"' + t.replace(/"/g, '""') + '"').join(' AND ')

  try {
    // Two statements on purpose: ranking scans index stats only (cheap for
    // thousands of matches), snippet() retokenizes a document's whole text
    // (expensive). Folding them into one query makes SQLite compute
    // snippets for every match — or re-run the ranking subquery per row —
    // which froze the main process for minutes on broad queries.
    const ids = db
      .prepare('SELECT rowid FROM fts WHERE fts MATCH ? ORDER BY bm25(fts) LIMIT ?')
      .all(match, limit) as { rowid: number }[]
    const snip = db.prepare(
      `SELECT f.path AS path, f.title AS title,
              snippet(fts, 0, '', '', '…', 40) AS snippet
       FROM fts JOIN files f ON f.id = fts.rowid
       WHERE fts MATCH ? AND fts.rowid = ?`,
    )
    const out: SearchHit[] = []
    for (const { rowid } of ids) {
      const r = snip.get(match, rowid) as SearchHit | undefined
      if (r) out.push({ ...r, path: toAbs(r.path) })
    }
    const { c: total } = db
      .prepare('SELECT count(*) AS c FROM fts WHERE fts MATCH ?')
      .get(match) as { c: number }
    return { hits: out, total }
  } catch {
    return EMPTY_RESULT // malformed MATCH input
  }
}

export interface FileMeta {
  title: string
  words: number
  tags: string[]
  /** Creation time, same chain as smart Created: frontmatter `created`
   *  → file birthtime → mtime. */
  createdAt: number
}

/** Every clip's source + capture time in one pass — the sidebar tree
 *  decorates its nodes from this (per-file IPC would be N round-trips). */
export function getClipSources(): Record<string, { url: string; capturedAt?: string }> {
  if (!db) return {}
  const rows = db
    .prepare(
      `SELECT f.path AS path, s.value AS source, c.value AS created
       FROM fields s
       JOIN files f ON f.id = s.file_id
       LEFT JOIN fields c ON c.file_id = s.file_id AND c.key = 'created'
       WHERE s.key = 'source'`,
    )
    .all() as { path: string; source: string; created: string | null }[]
  const out: Record<string, { url: string; capturedAt?: string }> = {}
  for (const r of rows) {
    const url = r.source.replace(/^"|"$/g, '')
    if (!url) continue
    out[toAbs(r.path)] = {
      url,
      capturedAt: r.created ? r.created.replace(/^"|"$/g, '') : undefined,
    }
  }
  return out
}

/** Source metadata for a watcher batch. Paths are chunked below SQLite's
 * variable limit so importing a large directory remains bounded without
 * serializing every clip in the workspace for one changed file. */
export function getClipSourcesForPaths(
  filePaths: string[],
): Record<string, { url: string; capturedAt?: string }> {
  if (!db || filePaths.length === 0) return {}
  const relativePaths = [
    ...new Set(filePaths.map((filePath) => toRel(filePath)).filter(Boolean) as string[]),
  ]
  if (relativePaths.length === 0) return {}

  const out: Record<string, { url: string; capturedAt?: string }> = {}
  const CHUNK_SIZE = 400
  for (let offset = 0; offset < relativePaths.length; offset += CHUNK_SIZE) {
    const chunk = relativePaths.slice(offset, offset + CHUNK_SIZE)
    const placeholders = chunk.map(() => '?').join(', ')
    const rows = db
      .prepare(
        `SELECT f.path AS path, s.value AS source, c.value AS created
         FROM fields s
         JOIN files f ON f.id = s.file_id
         LEFT JOIN fields c ON c.file_id = s.file_id AND c.key = 'created'
         WHERE s.key = 'source' AND f.path IN (${placeholders})`,
      )
      .all(...chunk) as { path: string; source: string; created: string | null }[]

    for (const row of rows) {
      const url = row.source.replace(/^"|"$/g, '')
      if (!url) continue
      out[toAbs(row.path)] = {
        url,
        capturedAt: row.created ? row.created.replace(/^"|"$/g, '') : undefined,
      }
    }
  }
  return out
}

export function getFileMeta(filePath: string): FileMeta | null {
  if (!db) return null
  const rel = toRel(filePath)
  if (!rel) return null
  const f = db
    .prepare('SELECT id, title, words, btime, mtime FROM files WHERE path = ?')
    .get(rel) as
    | { id: number; title: string; words: number; btime: number; mtime: number }
    | undefined
  if (!f) return null
  const tags = (
    db.prepare('SELECT tag FROM tags WHERE file_id = ? ORDER BY tag').all(f.id) as {
      tag: string
    }[]
  ).map((r) => r.tag)
  const createdRow = db
    .prepare("SELECT value FROM fields WHERE file_id = ? AND key = 'created'")
    .get(f.id) as { value: string } | undefined
  const created = createdRow ? Date.parse(createdRow.value.replace(/^"|"$/g, '')) : NaN
  const createdAt = Number.isFinite(created) ? created : f.btime > 0 ? f.btime : f.mtime
  return { title: f.title, words: f.words, tags, createdAt }
}

export function getFilesByTag(tag: string): { path: string; title: string }[] {
  if (!db) return []
  const rows = db
    .prepare(
      `SELECT f.path AS path, f.title AS title FROM files f
       JOIN tags t ON t.file_id = f.id WHERE t.tag = ? ORDER BY f.title`,
    )
    .all(tag.toLowerCase()) as { path: string; title: string }[]
  return rows.map((r) => ({ ...r, path: toAbs(r.path) }))
}

export function findBySource(
  sourceUrl: string,
): { path: string; title: string; savedAt: number } | null {
  if (!db) return null
  const normalized = normalizeUrl(sourceUrl)
  const row = db
    .prepare(
      `SELECT f.path AS path, f.title AS title, f.mtime AS mtime FROM files f
       JOIN fields d ON d.file_id = f.id
       WHERE d.key = 'source' AND d.value = ?
       LIMIT 1`,
    )
    .get(normalized) as { path: string; title: string; mtime: number } | undefined
  return row ? { path: toAbs(row.path), title: row.title, savedAt: row.mtime } : null
}

/* ---------------- wikilink resolution (F4) ----------------
   Targets are matched against note titles first (frontmatter > H1 >
   filename, as indexed), then filename stems — both case-insensitive.
   Duplicate matches resolve to the most recently modified note. */

export interface LinkTargetHit {
  path: string
  title: string
}

/** Notes offered by the link picker; empty query = most recent notes. */
export function listLinkTargets(
  query: string,
  excludePath: string | null,
  limit = 8,
): LinkTargetHit[] {
  if (!db) return []
  const q = query.trim().toLowerCase()
  const excludeRel = excludePath ? toRel(excludePath) : null
  const rows = (
    q
      ? db
          .prepare(
            `SELECT path, title FROM files
             WHERE instr(lower_u(title), ?) > 0 AND path != COALESCE(?, '')
             ORDER BY (lower_u(title) = ?) DESC, (instr(lower_u(title), ?) = 1) DESC, mtime DESC
             LIMIT ?`,
          )
          .all(q, excludeRel, q, q, limit)
      : db
          .prepare(
            `SELECT path, title FROM files WHERE path != COALESCE(?, '')
             ORDER BY mtime DESC LIMIT ?`,
          )
          .all(excludeRel, limit)
  ) as LinkTargetHit[]
  return rows.map((r) => ({ path: toAbs(r.path), title: r.title }))
}

export interface ResolvedLink {
  path: string
  title: string
  excerpt: string
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => '\\' + c)
}

/** Resolve wikilink targets to notes. Unresolved targets map to null. */
export function resolveWikilinks(targets: string[]): Record<string, ResolvedLink | null> {
  const out: Record<string, ResolvedLink | null> = {}
  if (!db) {
    for (const t of targets) out[t] = null
    return out
  }
  const byTitle = db.prepare(
    'SELECT id, path, title FROM files WHERE lower_u(title) = ? ORDER BY mtime DESC LIMIT 1',
  )
  const byName = db.prepare(
    `SELECT id, path, title FROM files
     WHERE lower_u(path) = ? OR lower_u(path) LIKE ? ESCAPE '\\'
        OR lower_u(path) = ? OR lower_u(path) LIKE ? ESCAPE '\\'
     ORDER BY mtime DESC LIMIT 1`,
  )
  const excerptOf = db.prepare('SELECT substr(content, 1, 300) AS c FROM fts WHERE rowid = ?')
  type Row = { id: number; path: string; title: string }
  for (const raw of targets) {
    const t = raw.trim().toLowerCase()
    if (!t) {
      out[raw] = null
      continue
    }
    const esc = escapeLike(t)
    const row = (byTitle.get(t) ??
      byName.get(`${t}.md`, `%/${esc}.md`, `${t}.markdown`, `%/${esc}.markdown`)) as Row | undefined
    if (!row) {
      out[raw] = null
      continue
    }
    const excerpt = ((excerptOf.get(row.id) as { c: string } | undefined)?.c ?? '').trim()
    out[raw] = { path: toAbs(row.path), title: row.title, excerpt }
  }
  return out
}

/* ---------------- note links panel (F4) ----------------
   Everything the backlinks panel and the Links tab need for one note,
   in a single call: linked references with paragraph context, unlinked
   mentions from full text, outgoing targets (pre-resolved), and the
   links among those neighbors for the local graph. */

export interface BacklinkRef {
  heading: string | null
  context: string
}

export interface BacklinkSource {
  path: string
  title: string
  refs: BacklinkRef[]
}

export interface UnlinkedMention {
  path: string
  title: string
  context: string
}

export interface OutgoingTarget {
  target: string
  path: string | null
  title: string | null
}

export interface NoteLinksData {
  /** Indexed title of the note itself (mention term, snippet highlight). */
  selfTitle: string
  backlinks: BacklinkSource[]
  mentions: UnlinkedMention[]
  outgoing: OutgoingTarget[]
  /** Absolute-path pairs among {self ∪ neighbors}, for the local graph. */
  edges: [string, string][]
}

const EMPTY_NOTE_LINKS: NoteLinksData = {
  selfTitle: '',
  backlinks: [],
  mentions: [],
  outgoing: [],
  edges: [],
}

const MAX_BACKLINK_SOURCES = 30
const MAX_REFS_PER_SOURCE = 4
const MAX_MENTIONS = 20
const CONTEXT_CHARS = 280

/** The wikilink spellings that resolve to this note: title and file stem. */
function targetVariantsOf(relPath: string, title: string): string[] {
  const stem = (relPath.split('/').pop() ?? '').replace(MD_RE, '')
  const relStem = relPath.replace(MD_RE, '')
  return [
    ...new Set([title.trim().toLowerCase(), stem.trim().toLowerCase(), relStem.toLowerCase()]),
  ].filter(Boolean)
}

function maskRange(chars: string[], source: string, start: number, end: number): void {
  for (let i = start; i < end; i += 1) chars[i] = source[i] === '\n' ? '\n' : ' '
}

function maskMatches(chars: string[], source: string, pattern: RegExp): void {
  const visible = chars.join('')
  pattern.lastIndex = 0
  for (const match of visible.matchAll(pattern)) {
    const start = match.index
    maskRange(chars, source, start, start + match[0].length)
  }
}

/** Mask fenced code without changing offsets. A closing fence may be longer
 *  than its opener, as allowed by CommonMark. */
function maskFencedCode(chars: string[], source: string): void {
  let fence: { char: string; length: number; start: number } | null = null
  let offset = 0
  while (offset < source.length) {
    const newline = source.indexOf('\n', offset)
    const contentEnd = newline === -1 ? source.length : newline
    const lineEnd = newline === -1 ? source.length : newline + 1
    const line = source.slice(offset, contentEnd).replace(/\r$/, '')

    if (!fence) {
      const opening = /^ {0,3}(`{3,}|~{3,})/.exec(line)
      if (opening) {
        fence = { char: opening[1][0], length: opening[1].length, start: offset }
      }
    } else {
      const closing = /^ {0,3}(`+|~+)[ \t]*$/.exec(line)
      if (closing && closing[1][0] === fence.char && closing[1].length >= fence.length) {
        maskRange(chars, source, fence.start, lineEnd)
        fence = null
      }
    }
    offset = lineEnd
  }
  if (fence) maskRange(chars, source, fence.start, source.length)
}

/** Build an offset-preserving view containing prose only. Link suggestions
 *  must never target syntax that cannot safely become an internal link. */
function proseOnlyMarkdown(body: string): string {
  const chars = body.split('')
  maskFencedCode(chars, body)

  // Mask large constructs before their smaller delimiters can be mistaken
  // for prose. Every replacement preserves newlines and UTF-16 offsets.
  maskMatches(chars, body, /<!--[\s\S]*?-->/g)
  maskMatches(chars, body, /<(script|style|pre|code)\b[^>]*>[\s\S]*?<\/\1\s*>/gi)
  maskMatches(chars, body, /(`+)[\s\S]*?\1/g)
  maskMatches(chars, body, /!?\[\[[^\]\n]+\]\]/g)
  maskMatches(chars, body, /!?\[(?:\\.|[^\]\\\n])*\]\((?:\\.|[^()\\\n]|\((?:\\.|[^()\\\n])*\))*\)/g)
  maskMatches(chars, body, /!?\[(?:\\.|[^\]\\\n])*\][ \t]*\[(?:\\.|[^\]\\\n])*\]/g)
  maskMatches(chars, body, /^ {0,3}\[(?:\\.|[^\]\\\n])+\]:[^\n]*/gm)
  maskMatches(chars, body, /!?\[(?:\\.|[^\]\\\n])+\]/g)
  maskMatches(chars, body, /<(?:https?:\/\/|mailto:)[^<>\n]+>/gi)
  maskMatches(chars, body, /\b(?:https?:\/\/|ftp:\/\/|www\.)[^\s<>"']+/gi)
  maskMatches(chars, body, /<\/?[A-Za-z][^>\n]*>/g)

  return chars.join('')
}

/** Index of the first occurrence of `title` in prose that is not glued into
 *  a longer latin word ("Art" must not hit "Cartography"). Whitespace in the
 *  title matches spaces/tabs but never a newline. */
function findBareMention(body: string, title: string): { index: number; text: string } | null {
  const t = title.trim()
  if (!t) return null
  const prose = proseOnlyMarkdown(body)
  const re = new RegExp(
    '(?<![A-Za-z0-9])' +
      t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[^\\S\\n]+') +
      '(?![A-Za-z0-9])',
    'gi',
  )
  const match = re.exec(prose)
  if (match)
    return { index: match.index, text: body.slice(match.index, match.index + match[0].length) }
  return null
}

function wikilinkRefRegex(variants: string[]): RegExp {
  const alts = variants.map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  return new RegExp(`\\[\\[\\s*(?:${alts})\\s*(?:\\||\\]\\])`, 'i')
}

/** Trim a paragraph to a window around the first regex match. */
function contextAround(block: string, re: RegExp): string {
  const flat = block.replace(/\s+/g, ' ').trim()
  if (flat.length <= CONTEXT_CHARS) return flat
  const at = flat.search(re)
  const start = Math.max(0, (at < 0 ? 0 : at) - Math.floor(CONTEXT_CHARS / 3))
  const slice = flat.slice(start, start + CONTEXT_CHARS)
  return (start > 0 ? '…' : '') + slice + (start + CONTEXT_CHARS < flat.length ? '…' : '')
}

/** Walk a markdown body; yield paragraph blocks with their last heading. */
function blocksWithHeadings(body: string): { heading: string | null; block: string }[] {
  const out: { heading: string | null; block: string }[] = []
  let heading: string | null = null
  let current: string[] = []
  const flush = () => {
    if (current.length) out.push({ heading, block: current.join('\n') })
    current = []
  }
  for (const line of body.split('\n')) {
    const h = line.match(/^#{1,6}\s+(.*)$/)
    if (h) {
      flush()
      heading = h[1].trim() || null
      continue
    }
    if (!line.trim()) flush()
    else current.push(line)
  }
  flush()
  return out
}

export function getNoteLinks(filePath: string): NoteLinksData {
  if (!db) return EMPTY_NOTE_LINKS
  const rel = toRel(filePath)
  if (!rel) return EMPTY_NOTE_LINKS
  const cur = db.prepare('SELECT id, path, title FROM files WHERE path = ?').get(rel) as
    | { id: number; path: string; title: string }
    | undefined
  if (!cur) return EMPTY_NOTE_LINKS

  const variants = targetVariantsOf(cur.path, cur.title)
  const marks = variants.map(() => '?').join(',')

  /* -- linked references, with paragraph context read from the sources -- */
  const sources = db
    .prepare(
      `SELECT DISTINCT f.id, f.path, f.title FROM links l
       JOIN files f ON f.id = l.source_id
       WHERE lower_u(l.target) IN (${marks}) AND f.id != ?
       ORDER BY f.mtime DESC LIMIT ?`,
    )
    .all(...variants, cur.id, MAX_BACKLINK_SOURCES) as { id: number; path: string; title: string }[]

  const refRe = wikilinkRefRegex(variants)
  const backlinks: BacklinkSource[] = []
  for (const s of sources) {
    let body: string
    try {
      const raw = fs.readFileSync(toAbs(s.path), 'utf-8')
      body = matter(raw).content
    } catch {
      continue // unreadable or malformed frontmatter — skip context, not the app
    }
    const refs: BacklinkRef[] = []
    for (const { heading, block } of blocksWithHeadings(body)) {
      if (!refRe.test(block)) continue
      refs.push({ heading, context: contextAround(block, refRe) })
      if (refs.length >= MAX_REFS_PER_SOURCE) break
    }
    // The index said this file links here; an empty refs list means the
    // file changed since indexing — show the source row without context.
    backlinks.push({ path: toAbs(s.path), title: s.title, refs })
  }

  /* -- unlinked mentions: full-text hits, then verified against the raw
        markdown. fts content flattens [[Other|label]] to its label, so an
        FTS hit alone can't distinguish a bare mention from an aliased
        link — findBareMention on the source file is the arbiter. -- */
  const mentions: UnlinkedMention[] = []
  const mentionTerm = cur.title.trim()
  if ([...mentionTerm].length >= 3) {
    const linkedIds = new Set(sources.map((s) => s.id))
    try {
      const hits = db
        .prepare(
          `SELECT f.id, f.path, f.title
           FROM fts JOIN files f ON f.id = fts.rowid
           WHERE fts MATCH ? AND fts.rowid != ?
           ORDER BY bm25(fts) LIMIT ?`,
        )
        .all(
          '"' + mentionTerm.replace(/"/g, '""') + '"',
          cur.id,
          MAX_MENTIONS + sources.length,
        ) as {
        id: number
        path: string
        title: string
      }[]
      for (const h of hits) {
        if (linkedIds.has(h.id) || mentions.length >= MAX_MENTIONS) continue
        let body: string
        try {
          body = matter(fs.readFileSync(toAbs(h.path), 'utf-8')).content
        } catch {
          continue
        }
        const hit = findBareMention(body, mentionTerm)
        if (!hit) continue
        const mentionRe = new RegExp(
          mentionTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'),
          'i',
        )
        mentions.push({
          path: toAbs(h.path),
          title: h.title,
          context: contextAround(plainTextOf(body.slice(Math.max(0, hit.index - 400))), mentionRe),
        })
      }
    } catch {
      /* malformed MATCH input — no mentions */
    }
  }

  /* -- outgoing links, resolved here so the tab needs no second pass -- */
  const outgoingRows = db
    .prepare('SELECT DISTINCT target FROM links WHERE source_id = ? ORDER BY rowid')
    .all(cur.id) as { target: string }[]
  const resolved = resolveWikilinks(outgoingRows.map((r) => r.target))
  const outgoing: OutgoingTarget[] = outgoingRows.map((r) => {
    const hit = resolved[r.target]
    return { target: r.target, path: hit?.path ?? null, title: hit?.title ?? null }
  })

  /* -- edges among self ∪ neighbors, for the local graph -- */
  const selfAbs = toAbs(cur.path)
  // rel path → { id, title, abs } for every on-screen neighbor (backlink
  // sources carry their row; outgoing-only neighbors are looked up).
  const rowByPath = db.prepare('SELECT id, title FROM files WHERE path = ?')
  const neighbors = new Map<string, { id: number; title: string; abs: string }>()
  for (const s of sources) neighbors.set(s.path, { id: s.id, title: s.title, abs: toAbs(s.path) })
  for (const o of outgoing) {
    if (!o.path) continue
    const r = toRel(o.path)
    if (!r || neighbors.has(r)) continue
    const row = rowByPath.get(r) as { id: number; title: string } | undefined
    if (row) neighbors.set(r, { id: row.id, title: row.title, abs: o.path })
  }
  const edges = new Set<string>()
  for (const s of sources) edges.add(JSON.stringify([toAbs(s.path), selfAbs]))
  for (const o of outgoing) if (o.path) edges.add(JSON.stringify([selfAbs, o.path]))
  // Cross-links among neighbors (both endpoints already on screen).
  if (neighbors.size) {
    const ids = [...neighbors.values()].map((n) => n.id)
    const idMarks = ids.map(() => '?').join(',')
    const crossRows = db
      .prepare(`SELECT source_id, target FROM links WHERE source_id IN (${idMarks})`)
      .all(...ids) as { source_id: number; target: string }[]
    const targetToAbs = new Map<string, string>()
    const idToAbs = new Map<number, string>()
    for (const [relPath, n] of neighbors) {
      idToAbs.set(n.id, n.abs)
      for (const v of targetVariantsOf(relPath, n.title)) targetToAbs.set(v, n.abs)
    }
    for (const r of crossRows) {
      const from = idToAbs.get(r.source_id)
      const to = targetToAbs.get(r.target.trim().toLowerCase())
      if (from && to && from !== to) edges.add(JSON.stringify([from, to]))
    }
  }

  return {
    selfTitle: cur.title,
    backlinks,
    mentions,
    outgoing,
    edges: [...edges].map((e) => JSON.parse(e) as [string, string]),
  }
}

/** Turn the first prose mention of `targetTitle` in `sourcePath` into a
 *  wikilink, preserving the matched text's casing via the alias form. */
export function linkMention(sourcePath: string, targetTitle: string): boolean {
  // IPC boundary: only files really inside the open workspace may be
  // rewritten — realpath so an in-workspace symlink can't smuggle the
  // write outside.
  if (!root || !toRel(sourcePath) || !isIndexable(sourcePath)) return false
  try {
    const realRoot = fs.realpathSync(root)
    const real = fs.realpathSync(sourcePath)
    if (path.relative(realRoot, real).startsWith('..')) return false
  } catch {
    return false
  }
  const raw = fs.readFileSync(sourcePath, 'utf-8')
  const parsed = matter(raw)
  const fmLength = raw.length - parsed.content.length
  const hit = findBareMention(parsed.content, targetTitle)
  if (!hit) return false
  const replacement =
    hit.text === targetTitle ? `[[${targetTitle}]]` : `[[${targetTitle}|${hit.text}]]`
  const next =
    raw.slice(0, fmLength + hit.index) +
    replacement +
    raw.slice(fmLength + hit.index + hit.text.length)
  fs.writeFileSync(sourcePath, next, 'utf-8')
  indexFile(sourcePath)
  return true
}

/* ---------------- smart folders (F3) ----------------
   Rules evaluate over one in-memory snapshot of the files table plus
   tag/field maps — simpler than SQL generation per rule, and cheap at
   the scale a personal workspace reaches. */

const DAY_MS = 86_400_000

/** Resolve a row's creation moment for time-sorting: frontmatter
 *  `created` (the capture pipeline writes a full instant) > filesystem
 *  birthtime > mtime (filesystems that can't report birth). */
export function preciseCreatedAt(
  createdField: string | undefined,
  btime: number,
  mtime: number,
): number {
  const createdRaw = createdField?.replace(/^"|"$/g, '')
  const created = createdRaw ? Date.parse(createdRaw) : NaN
  return Number.isFinite(created) ? created : btime > 0 ? btime : mtime
}

interface SmartRow {
  id: number
  path: string
  title: string
  kind: SmartKind
  sourceHost: string | null
  sourceUrl: string | null
  folderTop: string
  tags: string[]
  days: number
  modifiedDays: number
  createdAt: number
  words: number
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '') || null
  } catch {
    return null
  }
}

function smartSnapshot(): SmartRow[] {
  if (!db) return []
  const files = db.prepare('SELECT id, path, title, mtime, btime, words FROM files').all() as {
    id: number
    path: string
    title: string
    mtime: number
    btime: number
    words: number
  }[]
  const tagRows = db.prepare('SELECT file_id, tag FROM tags').all() as {
    file_id: number
    tag: string
  }[]
  const fieldRows = db
    .prepare("SELECT file_id, key, value FROM fields WHERE key IN ('source', 'created')")
    .all() as { file_id: number; key: string; value: string }[]

  const tagsBy = new Map<number, string[]>()
  for (const r of tagRows) {
    const list = tagsBy.get(r.file_id)
    if (list) list.push(r.tag)
    else tagsBy.set(r.file_id, [r.tag])
  }
  const fieldBy = new Map<number, { source?: string; created?: string }>()
  for (const r of fieldRows) {
    const f = fieldBy.get(r.file_id) ?? {}
    f[r.key as 'source' | 'created'] = r.value
    fieldBy.set(r.file_id, f)
  }

  const today = new Date()
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  // Local calendar-day difference — "Today" must track the user's clock,
  // not a rolling 24h window (a 23:00 capture is still today at 08:00).
  const daysAgo = (ts: number): number => {
    const d = new Date(ts)
    const startOfThat = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
    return Math.max(0, Math.round((startOfToday - startOfThat) / DAY_MS))
  }
  return files.map((f) => {
    const fields = fieldBy.get(f.id) ?? {}
    const createdAt = preciseCreatedAt(fields.created, f.btime, f.mtime)
    const baseKind = kindOfPath(f.path)
    return {
      id: f.id,
      path: f.path,
      title: f.title,
      kind: baseKind === 'note' && fields.source ? 'clip' : baseKind,
      sourceHost: fields.source ? hostOf(fields.source) : null,
      sourceUrl: fields.source ?? null,
      folderTop: f.path.includes('/') ? f.path.split('/')[0] : 'Workspace',
      tags: tagsBy.get(f.id) ?? [],
      days: daysAgo(createdAt),
      modifiedDays: daysAgo(f.mtime),
      createdAt,
      words: f.words,
    }
  })
}

const DATE_DAYS: Record<string, number> = {
  Today: 0,
  '3 days': 3,
  'This week': 7,
  'This month': 30,
  '3 months': 90,
  'This year': 365,
}

const KIND_VAL: Record<string, SmartKind> = {
  'Web clipping': 'clip',
  PDF: 'pdf',
  Note: 'note',
  Image: 'image',
  Audio: 'audio',
  Video: 'video',
  Code: 'code',
}

function matchDateRule(days: number, op: string, val: string): boolean {
  if (op === 'in') return days <= (DATE_DAYS[val] ?? Number.MAX_SAFE_INTEGER)
  if (op === 'before' || op === 'after') {
    const parts = val.split('-').map(Number)
    if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return true
    const target = new Date(parts[0], parts[1] - 1, parts[2]).getTime()
    const today = new Date()
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
    const targetDays = Math.max(0, Math.round((startOfToday - target) / DAY_MS))
    return op === 'before' ? days > targetDays : days <= targetDays
  }
  return true
}

function matchSmartRule(row: SmartRow, rule: SmartRule): boolean {
  switch (rule.key) {
    case 'Kind': {
      const is = row.kind === KIND_VAL[rule.val]
      return rule.op === 'is not' ? !is : is
    }
    case 'Created':
      return matchDateRule(row.days, rule.op, rule.val)
    case 'Modified':
      return matchDateRule(row.modifiedDays, rule.op, rule.val)
    case 'Folder':
      return rule.val === 'Anywhere' ? true : row.folderTop === rule.val
    case 'Tag': {
      if (rule.op === 'is empty') return row.tags.length === 0
      const has = row.tags.includes(rule.val.toLowerCase())
      return rule.op === 'is not' ? !has : has
    }
    case 'Title':
      return rule.val ? row.title.toLowerCase().includes(rule.val.toLowerCase()) : true
    case 'Source':
      return row.sourceHost === rule.val
    default:
      return true
  }
}

export type SmartSort = 'Newest first' | 'Oldest first' | 'Name A–Z' | 'Source'

/** Sort BEFORE the limit — "Oldest first" over a 500-match view must
 *  surface the actual oldest rows, not the oldest of the newest 200. */
function smartComparator(sort: SmartSort) {
  if (sort === 'Oldest first') return (a: SmartRow, b: SmartRow) => a.createdAt - b.createdAt
  if (sort === 'Name A–Z') return (a: SmartRow, b: SmartRow) => a.title.localeCompare(b.title)
  if (sort === 'Source')
    return (a: SmartRow, b: SmartRow) =>
      (a.sourceHost || 'zzz').localeCompare(b.sourceHost || 'zzz')
  return (a: SmartRow, b: SmartRow) => b.createdAt - a.createdAt
}

export function querySmartRules(
  rules: SmartRule[],
  limit = 200,
  sort: SmartSort = 'Newest first',
): SmartHit[] {
  if (!db) return []
  const rows = smartSnapshot()
    .filter((row) => rules.every((r) => matchSmartRule(row, r)))
    .sort(smartComparator(sort))
    .slice(0, limit)
  const excerptOf = db.prepare('SELECT substr(content, 1, 220) AS c FROM fts WHERE rowid = ?')
  // fts content flattens the H1 into plain text, so an excerpt usually
  // opens with the title — strip it rather than reading it twice.
  const stripTitle = (excerpt: string, title: string): string =>
    excerpt.startsWith(title) ? excerpt.slice(title.length).trim() : excerpt
  return rows.map((r) => ({
    path: toAbs(r.path),
    title: r.title,
    kind: r.kind,
    sourceHost: r.sourceHost,
    sourceUrl: r.sourceUrl,
    folderTop: r.folderTop,
    tags: r.tags,
    days: r.days,
    createdAt: r.createdAt,
    words: r.words,
    excerpt: stripTitle(
      ((excerptOf.get(r.id) as { c: string } | undefined)?.c ?? '').trim(),
      r.title,
    ),
  }))
}

/** Counts for many views in one snapshot pass (sidebar badges). */
export function countSmartViews(
  views: { id: string; rules: SmartRule[] }[],
): Record<string, number> {
  const rows = smartSnapshot()
  const out: Record<string, number> = {}
  for (const v of views) {
    out[v.id] = rows.filter((row) => v.rules.every((r) => matchSmartRule(row, r))).length
  }
  return out
}

export function getSmartVocab(): SmartVocab {
  if (!db) return { tags: [], folders: [], sources: [] }
  const tags = getAllTags().map((t) => t.tag)
  const folders = [
    ...new Set(
      (db.prepare('SELECT DISTINCT path FROM files').all() as { path: string }[])
        .filter((r) => r.path.includes('/'))
        .map((r) => r.path.split('/')[0]),
    ),
  ].sort((a, b) => a.localeCompare(b))
  const sources = [
    ...new Set(
      (
        db.prepare("SELECT DISTINCT value FROM fields WHERE key = 'source'").all() as {
          value: string
        }[]
      )
        .map((r) => hostOf(r.value))
        .filter((h): h is string => !!h),
    ),
  ].sort((a, b) => a.localeCompare(b))
  return { tags, folders, sources }
}

export function getAllTags(): { tag: string; count: number }[] {
  if (!db) return []
  return db
    .prepare('SELECT tag, COUNT(*) AS count FROM tags GROUP BY tag ORDER BY count DESC, tag')
    .all() as { tag: string; count: number }[]
}
