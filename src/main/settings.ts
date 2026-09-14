import { BrowserWindow } from 'electron'
import { IpcChannels } from '../shared/types/ipc'
import { DEFAULT_SETTINGS, type AppSettings } from '../shared/types/settings'
import { preferences } from './preferences'

const SETTINGS_KEY = 'settings'

/** Stored partial merged over defaults — new settings get their default
 *  without a migration step. Unknown stored keys are dropped. */
export function getSettings(): AppSettings {
  const stored = preferences.get<Partial<AppSettings>>(SETTINGS_KEY) ?? {}
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS }
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof AppSettings)[]) {
    if (stored[key] !== undefined) merged[key] = stored[key]
  }
  // preferences.json is a boundary: an older build stored clipCustomDest
  // as a single string — coerce to the map shape.
  if (typeof merged.clipCustomDest !== 'object' || merged.clipCustomDest === null) {
    merged.clipCustomDest = {}
  }
  // Early builds stored treeSort without a direction.
  if (typeof merged.treeSort === 'string' && !merged.treeSort.includes('-')) {
    merged.treeSort = merged.treeSort === 'name' ? 'name-asc' : `${merged.treeSort}-desc`
  }
  return merged as unknown as AppSettings
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  const next = { ...getSettings(), ...patch }
  preferences.set(SETTINGS_KEY, next)
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IpcChannels.OnSettingsChanged, { settings: next })
  }
  return next
}
