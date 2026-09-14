import { app } from 'electron'
import { preferences } from './preferences'
import type { LanguagePreference, ResolvedLanguage } from '../shared/types/ipc'

export const LANGUAGE_KEY = 'language'

/** 'system' follows the OS locale; anything Chinese maps to zh-CN. */
export function resolveLanguage(pref?: LanguagePreference | null): ResolvedLanguage {
  const p = pref ?? (preferences.get(LANGUAGE_KEY) as LanguagePreference | null) ?? 'system'
  if (p === 'en' || p === 'zh-CN') return p
  return app.getLocale().toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
}
