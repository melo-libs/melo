import { atom } from 'jotai'
import { IpcChannels } from '@shared/types/ipc'
import { DEFAULT_SETTINGS, type AppSettings } from '@shared/types/settings'
import { appStore } from './appStore'

/* ============================================================
   Settings mirror — the main process owns the persisted object;
   every window holds a read-only copy kept fresh over IPC.
   Writes go through setSetting → main → OnSettingsChanged →
   back into this atom (single source of truth, no local merge).
   ============================================================ */

export const settingsAtom = atom<AppSettings>(DEFAULT_SETTINGS)

/* Writes in flight from THIS window. While any are pending, broadcast
   echoes are ignored — a full-object echo for write A arriving after
   optimistic write B would briefly revert B (and a toggle read during
   that window persists the wrong value). The last response reconciles. */
let pendingWrites = 0

/** One-time hydration + subscription; called from main.tsx before render. */
export async function syncSettings(): Promise<void> {
  window.api.on(IpcChannels.OnSettingsChanged, ({ settings }) => {
    if (pendingWrites === 0) appStore.set(settingsAtom, settings)
  })
  const res = await window.api.invoke(IpcChannels.InvokeGetSettings, undefined)
  if (res.success && res.data) appStore.set(settingsAtom, res.data.settings)
}

export function setSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
  // Optimistic local update so controls feel instant.
  appStore.set(settingsAtom, { ...appStore.get(settingsAtom), [key]: value })
  pendingWrites++
  void window.api
    .invoke(IpcChannels.InvokeSetSettings, { patch: { [key]: value } })
    .then((res) => {
      pendingWrites--
      if (pendingWrites === 0 && res.success && res.data) {
        appStore.set(settingsAtom, res.data.settings)
      }
    })
    .catch(() => {
      pendingWrites--
    })
}

/** Resolved theme: 'system' follows the OS. */
export function resolveTheme(theme: AppSettings['theme']): 'light' | 'dark' {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return theme
}
