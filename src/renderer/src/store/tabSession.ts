import { IpcChannels } from '@shared/types/ipc'
import { appStore } from './appStore'
import { activeTabIdAtom, openFileAtom, tabsAtom } from './editor'
import { workspacePathAtom, workspaceSwitchingAtom } from './workspace'

/* ============================================================
   Tab session — reopen what was open. Stored per workspace in
   localStorage (same policy as recents: two workspaces must not
   clobber each other). Untitled buffers live only in memory and
   are excluded — their content has no file to come back from.
   ============================================================ */

const key = (root: string) => 'melo.session:' + root

function persist(): void {
  const root = appStore.get(workspacePathAtom)
  if (!root) return
  // Mid-switch the tab list empties while the OLD workspace path is still
  // current — persisting then would wipe that workspace's saved session.
  if (appStore.get(workspaceSwitchingAtom) !== null) return
  const tabs = appStore
    .get(tabsAtom)
    .filter((t) => !t.id.startsWith('untitled-'))
    .map((t) => t.id)
  const active = appStore.get(activeTabIdAtom)
  localStorage.setItem(
    key(root),
    JSON.stringify({ tabs, active: active && tabs.includes(active) ? active : null }),
  )
}

/** Explicit commit for the moment a suppressed period ends (workspace
 *  switch completed) — subscriptions only fire on future changes. */
export function persistTabSessionNow(): void {
  persist()
}

let initialized = false

/** Start mirroring tab state into localStorage. Idempotent; called once at boot. */
export function initTabSessionPersistence(): void {
  if (initialized) return
  initialized = true
  appStore.sub(tabsAtom, persist)
  appStore.sub(activeTabIdAtom, persist)
}

/** Reopen the saved tabs for `root` — files that vanished are skipped. */
export async function restoreTabSession(root: string): Promise<void> {
  let saved: { tabs?: string[]; active?: string | null } | null = null
  try {
    saved = JSON.parse(localStorage.getItem(key(root)) ?? 'null')
  } catch {
    return
  }
  const paths = saved?.tabs ?? []
  if (paths.length === 0) return
  const checks = await Promise.all(
    paths.slice(0, 20).map(async (p) => {
      const res = await window.api.invoke(IpcChannels.InvokeGetFileStats, { filePath: p })
      return { p, ok: res.success && !!res.data && !res.data.isDirectory }
    }),
  )
  for (const { p, ok } of checks) {
    if (ok) appStore.set(openFileAtom, p)
  }
  const active = saved?.active
  if (active && checks.some((c) => c.p === active && c.ok)) {
    appStore.set(activeTabIdAtom, active)
  }
}
