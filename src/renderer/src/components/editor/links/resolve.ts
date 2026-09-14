import { IpcChannels } from '@shared/types/ipc'

/* ============================================================
   Wikilink resolution cache — one renderer-wide map from target
   string (case-folded) to the note it resolves to, or null for
   "no such note". Filled lazily in batches over IPC; cleared on
   workspace changes so create/rename/delete flip link state.
   ============================================================ */

export interface ResolvedLink {
  path: string
  title: string
  excerpt: string
}

const cache = new Map<string, ResolvedLink | null>()
const inflight = new Map<string, Promise<void>>()
const listeners = new Set<() => void>()
// Bumped on invalidation — an in-flight batch from before the bump must
// not repopulate the cleared cache with stale rows.
let generation = 0

function keyOf(target: string): string {
  return target.trim().toLowerCase()
}

/** Subscribe to cache updates (batch results, invalidation). */
export function onResolutionsChanged(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function emit(): void {
  for (const fn of listeners) fn()
}

/** Synchronous lookup: undefined = not resolved yet, null = missing. */
export function cachedResolution(target: string): ResolvedLink | null | undefined {
  return cache.get(keyOf(target))
}

/** Batch-resolve unknown targets; listeners fire when results land.
 *  Resolves when every requested target is settled, including ones an
 *  earlier still-running batch owns. */
export function resolveTargets(targets: string[]): Promise<void> {
  const wanted = [...new Set(targets.map((t) => t.trim()).filter(Boolean))]
  const waits: Promise<void>[] = []
  const misses: string[] = []
  for (const t of wanted) {
    const k = keyOf(t)
    if (cache.has(k)) continue
    const running = inflight.get(k)
    if (running) waits.push(running)
    else misses.push(t)
  }
  if (misses.length) {
    const gen = generation
    const batch = (async () => {
      try {
        const res = await window.api.invoke(IpcChannels.InvokeResolveWikilinks, {
          targets: misses,
        })
        if (gen === generation && res.success && res.data) {
          for (const t of misses) cache.set(keyOf(t), res.data.resolved[t] ?? null)
          emit()
        }
      } finally {
        for (const t of misses) inflight.delete(keyOf(t))
      }
    })()
    for (const t of misses) inflight.set(keyOf(t), batch)
    waits.push(batch)
  }
  return Promise.all(waits).then(() => undefined)
}

/** Resolve one target, from cache when possible. */
export async function resolveTarget(target: string): Promise<ResolvedLink | null> {
  const hit = cache.get(keyOf(target))
  if (hit !== undefined) return hit
  await resolveTargets([target])
  return cache.get(keyOf(target)) ?? null
}

/** Drop everything — the workspace changed under us. */
export function invalidateResolutions(): void {
  generation += 1
  cache.clear()
  emit()
}

/** Parent-folder display path, workspace-relative ('Workspace' at root). */
export function workspaceDisplayPath(absPath: string, workspaceRoot: string | null): string {
  if (!workspaceRoot || !absPath.startsWith(workspaceRoot)) return ''
  const rel = absPath.slice(workspaceRoot.length).replace(/\\/g, '/').replace(/^\//, '')
  const dir = rel.split('/').slice(0, -1).join(' / ')
  return dir || 'Workspace'
}
